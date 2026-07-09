import { describe, expect, test } from "bun:test";

import type { ToolCallOutputPayload } from "../../src/contracts/actor-output";
import type { ToolDefinition } from "../../src/contracts/tool";
import {
  ToolExecutor,
  ToolRegistry,
  buildToolResult,
  decideToolPolicy,
  mapMcpToolToDefinition,
  normalizeToolOutput,
  registerLocalTools,
  type ActionReviewPort,
  type McpToolLike,
  type ToolHandler,
  type ToolPolicyContext,
} from "../../src/tools";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function makeDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "test.tool",
    source: "local",
    description: "A test tool.",
    riskLevel: "safe_read",
    approvalMode: "auto_if_safe",
    executionMode: "local",
    enabled: true,
    ...overrides,
  };
}

function makeCall(
  overrides: Partial<ToolCallOutputPayload> = {},
): ToolCallOutputPayload {
  return {
    toolCallId: "tc-1",
    toolName: "test.tool",
    input: {},
    reason: "because the test says so",
    ...overrides,
  };
}

const trustedCtx: ToolPolicyContext = {
  safeAutoRunTools: [],
  requesterIsTrusted: true,
};

/* -------------------------------------------------------------------------- */
/* 1. ToolRegistry                                                            */
/* -------------------------------------------------------------------------- */

describe("ToolRegistry", () => {
  test("register/get/has/list round-trips", () => {
    const registry = new ToolRegistry();
    const def = makeDef({ name: "a.tool" });
    registry.register(def);

    expect(registry.has("a.tool")).toBe(true);
    expect(registry.get("a.tool")?.name).toBe("a.tool");
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.has("missing")).toBe(false);
  });

  test("listForActor returns compact metadata only", () => {
    const registry = new ToolRegistry();
    registry.register(
      makeDef({ name: "a.tool", riskLevel: "write", approvalMode: "review" }),
    );

    const meta = registry.listForActor();
    expect(meta).toEqual([
      {
        name: "a.tool",
        description: "A test tool.",
        riskLevel: "write",
        approvalMode: "review",
      },
    ]);
  });

  test("duplicate name throws validationError", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef({ name: "dup" }));
    expect(() => registry.register(makeDef({ name: "dup" }))).toThrow(
      /already registered/i,
    );
  });

  test("registerLocalTools registers built-in safe tools", () => {
    const registry = new ToolRegistry();
    const handlers = new Map<string, ToolHandler>();
    registerLocalTools(registry, handlers);

    expect(registry.has("system.health")).toBe(true);
    expect(registry.has("system.time")).toBe(true);
    expect(handlers.has("system.health")).toBe(true);
    expect(handlers.has("system.time")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. decideToolPolicy                                                        */
/* -------------------------------------------------------------------------- */

describe("decideToolPolicy", () => {
  test("safe_read + auto_if_safe -> auto_allow (trusted)", () => {
    const decision = decideToolPolicy(makeDef(), makeCall(), trustedCtx);
    expect(decision.decision).toBe("auto_allow");
  });

  test("safe_read in safeAutoRunTools -> auto_allow", () => {
    const def = makeDef({ name: "safe.read", approvalMode: "review" });
    const decision = decideToolPolicy(def, makeCall({ toolName: "safe.read" }), {
      safeAutoRunTools: ["safe.read"],
      requesterIsTrusted: true,
    });
    expect(decision.decision).toBe("auto_allow");
  });

  test("auto-runnable but untrusted requester -> needs_approval", () => {
    const decision = decideToolPolicy(makeDef(), makeCall(), {
      safeAutoRunTools: [],
      requesterIsTrusted: false,
    });
    expect(decision.decision).toBe("needs_approval");
  });

  test.each(["write", "server", "external_send", "private_data"] as const)(
    "consequential risk %s -> needs_approval",
    (riskLevel) => {
      const def = makeDef({ riskLevel, approvalMode: "review" });
      const decision = decideToolPolicy(def, makeCall(), trustedCtx);
      expect(decision.decision).toBe("needs_approval");
    },
  );

  test("approvalMode manual -> needs_approval (even if safe_read + allowlisted)", () => {
    const def = makeDef({ name: "manual.tool", approvalMode: "manual" });
    const decision = decideToolPolicy(
      def,
      makeCall({ toolName: "manual.tool" }),
      { safeAutoRunTools: ["manual.tool"], requesterIsTrusted: true },
    );
    expect(decision.decision).toBe("needs_approval");
  });

  test("disabled -> deny", () => {
    const def = makeDef({ enabled: false });
    const decision = decideToolPolicy(def, makeCall(), trustedCtx);
    expect(decision.decision).toBe("deny");
  });

  test("riskHint on the call is ignored; def.riskLevel is trusted", () => {
    const def = makeDef({ riskLevel: "write", approvalMode: "review" });
    // Actor lies and claims the call is safe_read.
    const decision = decideToolPolicy(
      def,
      makeCall({ riskHint: "safe_read" }),
      trustedCtx,
    );
    expect(decision.decision).toBe("needs_approval");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. ToolExecutor                                                            */
/* -------------------------------------------------------------------------- */

class SpyHandler implements ToolHandler {
  called = false;
  constructor(private readonly result: unknown = { ok: true }) {}
  async execute(): Promise<unknown> {
    this.called = true;
    return this.result;
  }
}

function makeExecutor(
  def: ToolDefinition,
  handler: ToolHandler,
  actionReview: ActionReviewPort,
  ctx: ToolPolicyContext = trustedCtx,
): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register(def);
  const handlers = new Map<string, ToolHandler>([[def.name, handler]]);
  return new ToolExecutor(registry, handlers, actionReview, ctx);
}

const denyingReview: ActionReviewPort = {
  async authorize() {
    return { allowed: false, reason: "denied by test reviewer" };
  },
};

const allowingReview: ActionReviewPort = {
  async authorize() {
    return { allowed: true, reason: "approved by test reviewer" };
  },
};

describe("ToolExecutor", () => {
  test("consequential + DENYING review -> blocked and handler NOT called", async () => {
    const def = makeDef({
      name: "danger.write",
      riskLevel: "write",
      approvalMode: "review",
    });
    const handler = new SpyHandler();
    const executor = makeExecutor(def, handler, denyingReview);

    const result = await executor.run(makeCall({ toolName: "danger.write" }));

    expect(result.status).toBe("blocked");
    expect(handler.called).toBe(false);
    expect(result.error?.message).toMatch(/denied/i);
  });

  test("consequential + ALLOWING review -> executes and succeeds", async () => {
    const def = makeDef({
      name: "danger.write",
      riskLevel: "write",
      approvalMode: "review",
    });
    const handler = new SpyHandler({ wrote: 1 });
    const executor = makeExecutor(def, handler, allowingReview);

    const result = await executor.run(makeCall({ toolName: "danger.write" }));

    expect(result.status).toBe("succeeded");
    expect(handler.called).toBe(true);
    expect(result.output).toEqual({ wrote: 1 });
  });

  test("safe_read auto-run tool executes WITHOUT calling authorize", async () => {
    const def = makeDef({ name: "safe.read" });
    const handler = new SpyHandler({ read: true });
    let authorizeCalls = 0;
    const review: ActionReviewPort = {
      async authorize() {
        authorizeCalls += 1;
        return { allowed: true, reason: "should not be reached" };
      },
    };
    const executor = makeExecutor(def, handler, review);

    const result = await executor.run(makeCall({ toolName: "safe.read" }));

    expect(result.status).toBe("succeeded");
    expect(handler.called).toBe(true);
    expect(authorizeCalls).toBe(0);
  });

  test("unknown tool -> blocked", async () => {
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(
      registry,
      new Map(),
      allowingReview,
      trustedCtx,
    );
    const result = await executor.run(makeCall({ toolName: "does.not.exist" }));
    expect(result.status).toBe("blocked");
    expect(result.error?.code).toBe("not_found");
  });

  test("disabled tool -> blocked and handler NOT called", async () => {
    const def = makeDef({ name: "off.tool", enabled: false });
    const handler = new SpyHandler();
    const executor = makeExecutor(def, handler, allowingReview);
    const result = await executor.run(makeCall({ toolName: "off.tool" }));
    expect(result.status).toBe("blocked");
    expect(handler.called).toBe(false);
  });

  test("handler that throws -> failed result with error", async () => {
    const def = makeDef({ name: "boom.tool" });
    const throwingHandler: ToolHandler = {
      async execute() {
        throw new Error("kaboom");
      },
    };
    const executor = makeExecutor(def, throwingHandler, allowingReview);
    const result = await executor.run(makeCall({ toolName: "boom.tool" }));
    expect(result.status).toBe("failed");
    expect(result.error?.message).toMatch(/kaboom/);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. buildToolResult / normalizeToolOutput                                   */
/* -------------------------------------------------------------------------- */

describe("buildToolResult / normalizeToolOutput", () => {
  test("buildToolResult produces a validated payload", () => {
    const result = buildToolResult({
      toolCallId: "tc-9",
      toolName: "x.y",
      status: "succeeded",
      output: { a: 1 },
      textPreview: "ok",
    });
    expect(result).toEqual({
      toolCallId: "tc-9",
      toolName: "x.y",
      status: "succeeded",
      output: { a: 1 },
      textPreview: "ok",
      error: undefined,
    });
  });

  test("normalizeToolOutput keeps plain objects as output", () => {
    const { output, textPreview } = normalizeToolOutput({ hello: "world" });
    expect(output).toEqual({ hello: "world" });
    expect(textPreview).toBe(JSON.stringify({ hello: "world" }));
  });

  test("normalizeToolOutput wraps arrays and primitives", () => {
    expect(normalizeToolOutput([1, 2, 3]).output).toEqual({ items: [1, 2, 3] });
    expect(normalizeToolOutput("hi").output).toEqual({ value: "hi" });
    expect(normalizeToolOutput(42).output).toEqual({ value: 42 });
  });

  test("normalizeToolOutput returns empty for null/undefined", () => {
    expect(normalizeToolOutput(null)).toEqual({});
    expect(normalizeToolOutput(undefined)).toEqual({});
  });

  test("normalizeToolOutput truncates the text preview to ~500 chars", () => {
    const long = "x".repeat(2000);
    const { textPreview } = normalizeToolOutput(long);
    expect(textPreview).toBeDefined();
    expect(textPreview!.length).toBeLessThanOrEqual(500);
    expect(textPreview!.endsWith("…")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. mapMcpToolToDefinition                                                  */
/* -------------------------------------------------------------------------- */

describe("mapMcpToolToDefinition", () => {
  test("maps name/description and defaults to conservative write/review", () => {
    const mcpTool: McpToolLike = {
      name: "create_issue",
      description: "Create a Jira issue.",
      inputSchema: { type: "object", properties: {} },
    };
    const def = mapMcpToolToDefinition(mcpTool, "jira");
    expect(def.name).toBe("jira.create_issue");
    expect(def.source).toBe("mcp");
    expect(def.description).toBe("Create a Jira issue.");
    expect(def.riskLevel).toBe("write");
    expect(def.approvalMode).toBe("review");
    expect(def.executionMode).toBe("mcp");
  });

  test("downgrades safe read-pattern names to safe_read/auto_if_safe", () => {
    const def = mapMcpToolToDefinition({ name: "get_page" }, "confluence");
    expect(def.riskLevel).toBe("safe_read");
    expect(def.approvalMode).toBe("auto_if_safe");
    // Falls back to the qualified name when no description/title present.
    expect(def.description).toBe("confluence.get_page");
  });

  test("honours an explicit readOnlyHint annotation", () => {
    const def = mapMcpToolToDefinition(
      { name: "do_thing", annotations: { readOnlyHint: true } },
      "srv",
    );
    expect(def.riskLevel).toBe("safe_read");
  });
});
