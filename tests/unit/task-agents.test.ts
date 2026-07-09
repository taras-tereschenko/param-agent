import { describe, expect, test } from "bun:test";

import { TaskAgentRegistry } from "../../src/task-agents/registry";
import {
  buildTaskRunPlan,
  defaultTaskBudget,
} from "../../src/task-agents/spawn";
import { buildTaskResult } from "../../src/task-agents/result";
import type { SpawnTaskAgentOutputPayload } from "../../src/contracts/actor-output";

function spawn(
  over: Partial<SpawnTaskAgentOutputPayload>,
): SpawnTaskAgentOutputPayload {
  return {
    taskType: "research",
    goal: "look something up",
    reportTo: "session_actor",
    ...over,
  };
}

describe("task agent registry", () => {
  test("image/browser are placeholders (unavailable)", () => {
    const reg = new TaskAgentRegistry();
    expect(reg.isAvailable("research")).toBe(true);
    expect(reg.isAvailable("image")).toBe(false);
    expect(reg.isAvailable("browser")).toBe(false);
  });
});

describe("buildTaskRunPlan", () => {
  const registry = new TaskAgentRegistry();

  test("resolves runtime + tools for an available type", () => {
    const res = buildTaskRunPlan(spawn({ taskType: "research" }), { registry });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.runtime).toBe("codex");
      expect(res.plan.reportTo).toBe("session_actor");
    }
  });

  test("refuses unavailable task types (safe unavailable state)", () => {
    const res = buildTaskRunPlan(spawn({ taskType: "image" }), { registry });
    expect(res.ok).toBe(false);
  });

  test("clamps requested budget to hard caps", () => {
    const res = buildTaskRunPlan(
      spawn({ budget: { maxTokens: 10_000_000, timeoutSeconds: 999_999 } }),
      { registry },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.budget.maxTokens).toBe(defaultTaskBudget.maxTokens);
      expect(res.plan.budget.timeoutSeconds).toBe(
        defaultTaskBudget.timeoutSeconds,
      );
    }
  });

  test("preferredRuntime overrides the default", () => {
    const res = buildTaskRunPlan(
      spawn({ taskType: "coding", preferredRuntime: "opencode" }),
      { registry },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.runtime).toBe("opencode");
    }
  });
});

describe("buildTaskResult", () => {
  test("validates and preserves errors honestly", () => {
    const result = buildTaskResult({
      taskSessionId: "ts1",
      taskRunId: "tr1",
      status: "failed",
      summary: "could not reach the site",
      error: { code: "timeout", message: "timed out" },
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("timeout");
  });
});
