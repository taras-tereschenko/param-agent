import { describe, expect, test } from "bun:test";

import type { RenderUiOutputPayload } from "../../src/contracts/ui";
import { ParamError } from "../../src/shared/errors";
import { renderUi } from "../../src/ui/renderer";
import {
  buildCallbackData,
  parseCallbackData,
  validateCallback,
} from "../../src/ui/callbacks";
import { validateThemePatch } from "../../src/ui/theme";

const EM_DASH = "—";

function payload(
  overrides: Partial<RenderUiOutputPayload> &
    Pick<RenderUiOutputPayload, "schema" | "spec">,
): RenderUiOutputPayload {
  return {
    surfaceId: "surface-1",
    target: "telegram_rich_message",
    specVersion: 1,
    ...overrides,
  } as RenderUiOutputPayload;
}

describe("renderUi", () => {
  test("renders param.status with state markers", () => {
    const rendered = renderUi(
      payload({
        schema: "param.status",
        spec: {
          title: "System",
          rows: [
            { label: "API", value: "up", state: "ok" },
            { label: "Queue", value: "slow", state: "warn" },
          ],
        },
      }),
    );
    const text = rendered.telegram?.text ?? "";
    expect(text).toContain("✅");
    expect(text).toContain("⚠️");
    expect(text).toContain("API: up");
  });

  test("unknown-but-string schema renders generically without throwing", () => {
    const rendered = renderUi(
      payload({
        surfaceId: "surface-2",
        target: "current_session",
        schema: "custom.widget",
        spec: { foo: "bar", count: 3 },
      }),
    );
    expect(rendered.telegram?.text).toContain("foo: bar");
    expect(rendered.telegram?.text).toContain("count: 3");
  });

  test("a spec failing its registered schema throws validationError", () => {
    let caught: unknown;
    try {
      renderUi(
        payload({
          surfaceId: "surface-3",
          schema: "param.status",
          spec: { rows: [] },
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamError);
    expect((caught as ParamError).code).toBe("validation_failed");
  });
});

describe("plain-text rendering has no em-dash", () => {
  test("rich_text renders to plain text without em-dash", () => {
    const rendered = renderUi(
      payload({
        schema: "param.rich_text",
        spec: {
          blocks: [
            { kind: "heading", text: "Report" },
            { kind: "paragraph", text: "all good" },
            { kind: "bullet", items: ["one", "two"] },
            { kind: "divider" },
            { kind: "key_value", pairs: [{ key: "status", value: "ok" }] },
            { kind: "code", text: "const x = 1;" },
          ],
        },
      }),
    );
    const text = rendered.telegram?.text ?? "";
    expect(text.includes(EM_DASH)).toBe(false);
    expect(text).toContain("REPORT");
    expect(text).toContain("• one");
    expect(text).toContain("----");
    expect(text).toContain("status: ok");
  });

  test("table renders to aligned plain text without em-dash", () => {
    const rendered = renderUi(
      payload({
        schema: "param.table",
        spec: {
          title: "Servers",
          columns: ["name", "state"],
          rows: [
            ["alpha", "up"],
            ["beta", "down"],
          ],
        },
      }),
    );
    const text = rendered.telegram?.text ?? "";
    expect(text.includes(EM_DASH)).toBe(false);
    expect(text).toContain("name");
    expect(text).toContain("alpha");
  });

  test("card renders to plain text without em-dash", () => {
    const rendered = renderUi(
      payload({
        schema: "param.card",
        spec: {
          title: "Deploy",
          body: "ready to ship",
          fields: [{ label: "env", value: "prod" }],
        },
      }),
    );
    const text = rendered.telegram?.text ?? "";
    expect(text.includes(EM_DASH)).toBe(false);
    expect(text).toContain("Deploy");
    expect(text).toContain("env: prod");
  });
});

describe("callbacks", () => {
  test("buildCallbackData/parseCallbackData round-trip for a small value", () => {
    const data = buildCallbackData("surf-1", "approve", { n: 1 });
    const parsed = parseCallbackData(data);
    expect(parsed.surfaceId).toBe("surf-1");
    expect(parsed.actionId).toBe("approve");
    expect(parsed.raw).toBe(data);
  });

  test("oversized value falls back to token form within 64 bytes", () => {
    const data = buildCallbackData("surf-1", "approve", {
      blob: "x".repeat(300),
    });
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
    const parsed = parseCallbackData(data);
    expect(parsed.surfaceId).toBe("surf-1");
    expect(parsed.actionId).toBe("approve");
  });

  test("validateCallback accepts known action and rejects unknown", () => {
    const allowed = [{ actionId: "approve" }, { actionId: "cancel" }];
    expect(validateCallback("approve", allowed)).toBe(true);
    expect(validateCallback("delete_everything", allowed)).toBe(false);
  });
});

describe("validateThemePatch", () => {
  test("rejects a non-allowlisted token", () => {
    const result = validateThemePatch({
      system: "shadcn-css-variables",
      scope: "surface",
      tokens: { primary: "oklch(0.7 0.1 210)", evil_css: "url(x)" },
    });
    expect(result.ok).toBe(false);
    expect(result.rejectedTokens).toContain("evil_css");
    expect(result.requiresActionReview).toBe(false);
  });

  test("flags requiresActionReview for global scope, not surface scope", () => {
    const global = validateThemePatch({
      system: "shadcn-css-variables",
      scope: "global",
      tokens: { primary: "oklch(0.7 0.1 210)" },
    });
    expect(global.ok).toBe(true);
    expect(global.requiresActionReview).toBe(true);

    const surface = validateThemePatch({
      system: "shadcn-css-variables",
      scope: "surface",
      tokens: { primary: "oklch(0.7 0.1 210)" },
    });
    expect(surface.requiresActionReview).toBe(false);
  });
});

describe("callbacks map to inline buttons", () => {
  test("maps callbacks to inline buttons and marks requiresApproval", () => {
    const rendered = renderUi(
      payload({
        surfaceId: "surface-5",
        schema: "param.card",
        spec: { title: "Confirm" },
        callbacks: [
          { actionId: "approve", label: "Approve", requiresApproval: true },
          { actionId: "cancel", label: "Cancel" },
        ],
      }),
    );
    expect(rendered.telegram?.inlineButtons).toHaveLength(2);
    expect(rendered.callbacks).toHaveLength(2);
    expect(
      rendered.callbacks.find((c) => c.actionId === "approve")
        ?.requiresApproval,
    ).toBe(true);
    expect(
      rendered.callbacks.find((c) => c.actionId === "cancel")?.requiresApproval,
    ).toBe(false);

    const approveButton = rendered.telegram?.inlineButtons?.find(
      (b) => b.text === "Approve",
    );
    expect(approveButton?.callbackData).toBeDefined();
  });
});
