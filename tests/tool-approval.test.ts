import { describe, expect, test } from "bun:test";
import { glob, grep, readFile } from "eve/tools/defaults";
import {
  globApproval,
  grepApproval,
  readFileApproval,
} from "../agent/lib/tool-approval.ts";

function runApproval(
  approval: ReturnType<typeof readFileApproval>,
  toolInput: Record<string, unknown>,
) {
  return approval({
    approvedTools: new Set(),
    session: {} as never,
    toolInput,
    toolName: "test_tool",
  } as never);
}

describe("read tool approval policies", () => {
  test("auto-approves a specific non-sensitive file read", () => {
    expect(runApproval(readFileApproval(), { filePath: "/workspace/agent/agent.ts" })).toBe("not-applicable");
  });

  test("requires review for sensitive file reads", () => {
    expect(runApproval(readFileApproval(), { filePath: "/workspace/.env" })).toBe("user-approval");
  });

  test("auto-approves targeted globs", () => {
    expect(runApproval(globApproval(), { pattern: "agent/**/*.ts" })).toBe("not-applicable");
  });

  test("requires review for broad globs", () => {
    expect(runApproval(globApproval(), { pattern: "**/*" })).toBe("user-approval");
  });

  test("requires review for dot-prefixed broad globs", () => {
    expect(runApproval(globApproval(), { pattern: "./**/*" })).toBe("user-approval");
  });

  test("auto-approves grep when scoped by path", () => {
    expect(runApproval(grepApproval(), { path: "/workspace/agent", pattern: "Param" })).toBe("not-applicable");
  });

  test("requires review for broad grep", () => {
    expect(runApproval(grepApproval(), { pattern: "Param" })).toBe("user-approval");
  });

  test("requires review for workspace-root grep", () => {
    expect(runApproval(grepApproval(), { path: "/workspace", pattern: "Param" })).toBe("user-approval");
  });

  test("requires review for sensitive grep patterns", () => {
    expect(runApproval(grepApproval(), { glob: "**/*.ts", pattern: "token" })).toBe("user-approval");
  });

  test("requires review for oversized file reads", () => {
    expect(
      runApproval(readFileApproval(), { filePath: "/workspace/agent/agent.ts", limit: 5000 }),
    ).toBe("user-approval");
  });

  test("requires review for oversized glob limits", () => {
    expect(runApproval(globApproval(), { limit: 500, pattern: "agent/**/*.ts" })).toBe(
      "user-approval",
    );
  });

  test("requires review for oversized grep context", () => {
    expect(
      runApproval(grepApproval(), { context: 50, path: "/workspace/agent", pattern: "Param" }),
    ).toBe("user-approval");
  });

  test("requires review for broad grep globs even with a scoped path", () => {
    expect(
      runApproval(grepApproval(), { glob: "**/*", path: "/workspace/agent", pattern: "Param" }),
    ).toBe("user-approval");
  });

  test("requires review for sensitive glob patterns", () => {
    expect(runApproval(globApproval(), { pattern: "credentials/**/*.ts" })).toBe("user-approval");
  });

  test("requires review for oversized grep limits", () => {
    expect(
      runApproval(grepApproval(), { limit: 500, path: "/workspace/agent", pattern: "Param" }),
    ).toBe("user-approval");
  });
});

// The approval policies read specific input fields by name. If a future eve
// upgrade renames one of those fields, the policy would silently read
// `undefined` and stop gating sensitive paths, so pin the field names to eve's
// real default-tool schemas. A failure here means re-check tool-approval.ts
// against the current eve schema before shipping.
function schemaPropertyKeys(schema: unknown): Set<string> {
  if (schema && typeof schema === "object" && "properties" in schema) {
    const properties = (schema as { properties?: unknown }).properties;
    if (properties && typeof properties === "object") {
      return new Set(Object.keys(properties));
    }
  }

  return new Set();
}

describe("approval field names match eve default tool schemas", () => {
  test("read_file exposes the fields readFileApproval gates on", () => {
    const keys = schemaPropertyKeys(readFile.inputSchema);
    expect(keys.has("filePath")).toBe(true);
    expect(keys.has("limit")).toBe(true);
  });

  test("glob exposes the fields globApproval gates on", () => {
    const keys = schemaPropertyKeys(glob.inputSchema);
    expect(keys.has("pattern")).toBe(true);
    expect(keys.has("path")).toBe(true);
    expect(keys.has("limit")).toBe(true);
  });

  test("grep exposes the fields grepApproval gates on", () => {
    const keys = schemaPropertyKeys(grep.inputSchema);
    for (const field of ["pattern", "path", "glob", "limit", "context"]) {
      expect(keys.has(field)).toBe(true);
    }
  });
});
