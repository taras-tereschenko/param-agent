import { describe, expect, test } from "bun:test";

import { TaskAgentRegistry } from "../../src/task-agents/registry";
import {
  buildTaskRunPlan,
  defaultTaskBudget,
  type TaskRunPlan,
} from "../../src/task-agents/spawn";
import { buildTaskResult } from "../../src/task-agents/result";
import {
  buildTaskPrompt,
  CliTaskExecutor,
  TaskRuntimeRegistry,
} from "../../src/task-agents/executor";
import type {
  CliRunInput,
  CliRunResult,
} from "../../src/runtimes/codex/cli-actor";
import type { SpawnTaskAgentOutputPayload } from "../../src/contracts/actor-output";

function taskPlan(over: Partial<TaskRunPlan> = {}): TaskRunPlan {
  return {
    taskType: "research",
    goal: "find the capital of France",
    runtime: "codex",
    allowedTools: ["system.time"],
    budget: {
      maxTokens: 1000,
      maxCostUsd: 1,
      timeoutSeconds: 30,
      maxToolCalls: 5,
    },
    memoryScope: [],
    reportTo: "session_actor",
    ...over,
  };
}

/** Fake CLI runner: records the last input and returns a scripted result. */
function fakeRunner(result: Partial<CliRunResult>) {
  const calls: CliRunInput[] = [];
  const runner = async (input: CliRunInput): Promise<CliRunResult> => {
    calls.push(input);
    return { stdout: "", stderr: "", exitCode: 0, ...result };
  };
  return { runner, calls };
}

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

describe("buildTaskPrompt", () => {
  test("carries the goal, task type, and allowed tools", () => {
    const prompt = buildTaskPrompt(taskPlan({ allowedTools: ["a.b", "c.d"] }));
    expect(prompt).toContain("find the capital of France");
    expect(prompt).toContain('type "research"');
    expect(prompt).toContain("a.b, c.d");
  });

  test("says none when no tools are allowed", () => {
    expect(buildTaskPrompt(taskPlan({ allowedTools: [] }))).toContain(
      "Allowed tools: none",
    );
  });
});

describe("CliTaskExecutor", () => {
  test("completed: exit 0 -> trimmed stdout summary", async () => {
    const { runner, calls } = fakeRunner({
      stdout: "  Paris is the capital.\n",
      exitCode: 0,
    });
    const executor = new CliTaskExecutor({
      runtime: "codex",
      command: "codex",
      runner,
    });
    const outcome = await executor.run(taskPlan({ budget: { ...taskPlan().budget, timeoutSeconds: 42 } }));
    expect(outcome.status).toBe("completed");
    expect(outcome.summary).toBe("Paris is the capital.");
    // Budget timeout is enforced as a hard kill (seconds -> ms).
    expect(calls[0]?.timeoutMs).toBe(42_000);
  });

  test("failed: nonzero exit preserves stderr in the error", async () => {
    const { runner } = fakeRunner({
      stdout: "",
      stderr: "boom: model refused",
      exitCode: 1,
    });
    const executor = new CliTaskExecutor({
      runtime: "codex",
      command: "codex",
      runner,
    });
    const outcome = await executor.run(taskPlan());
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("nonzero_exit");
    expect(outcome.error?.message).toContain("boom");
  });

  test("failed: empty output on a clean exit is not a fake success", async () => {
    const { runner } = fakeRunner({ stdout: "   \n", exitCode: 0 });
    const executor = new CliTaskExecutor({
      runtime: "codex",
      command: "codex",
      runner,
    });
    const outcome = await executor.run(taskPlan());
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("empty_output");
  });

  test("failed: a spawn throw degrades to a safe failed outcome", async () => {
    const executor = new CliTaskExecutor({
      runtime: "codex",
      command: "codex",
      runner: async () => {
        throw new Error("ENOENT");
      },
    });
    const outcome = await executor.run(taskPlan());
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("spawn_failed");
  });
});

describe("TaskRuntimeRegistry", () => {
  test("resolves an executor by runtime name; unknown -> undefined", () => {
    const { runner } = fakeRunner({ stdout: "ok", exitCode: 0 });
    const codex = new CliTaskExecutor({
      runtime: "codex",
      command: "codex",
      runner,
    });
    const registry = new TaskRuntimeRegistry([codex]);
    expect(registry.resolve("codex")).toBe(codex);
    expect(registry.resolve("mock")).toBeUndefined();
    expect(registry.resolve("image")).toBeUndefined();
  });
});
