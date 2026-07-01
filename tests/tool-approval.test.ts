import { describe, expect, test } from "bun:test";
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
});
