import {
  spawnTaskAgentOutputPayloadSchema,
  type SpawnTaskAgentOutputPayload,
} from "../contracts/actor-output";
import type { TaskAgentRegistry } from "./registry";

export type TaskBudget = {
  maxTokens: number;
  maxCostUsd: number;
  timeoutSeconds: number;
  maxToolCalls: number;
};

export const defaultTaskBudget: TaskBudget = {
  maxTokens: 100_000,
  maxCostUsd: 1,
  timeoutSeconds: 300,
  maxToolCalls: 20,
};

export type TaskRunPlan = {
  taskType: string;
  goal: string;
  runtime: string;
  allowedTools: string[];
  budget: TaskBudget;
  memoryScope: string[];
  reportTo: "session_actor";
};

export type TaskRunPlanResult =
  | { ok: true; plan: TaskRunPlan }
  | { ok: false; error: string };

/**
 * Validate a spawn request and build a bounded task-run plan. Enforces the
 * requested budget against hard caps, resolves runtime + allowed tools from the
 * registry, and refuses unavailable task types (safe unavailable state).
 */
export function buildTaskRunPlan(
  output: SpawnTaskAgentOutputPayload,
  opts: { registry: TaskAgentRegistry; caps?: TaskBudget },
): TaskRunPlanResult {
  const parsed = spawnTaskAgentOutputPayloadSchema.safeParse(output);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid spawn" };
  }
  const spawn = parsed.data;
  const def = opts.registry.get(spawn.taskType);
  if (!def) {
    return { ok: false, error: `unknown task type: ${spawn.taskType}` };
  }
  if (!def.available) {
    return {
      ok: false,
      error: def.unavailableReason ?? `${spawn.taskType} unavailable`,
    };
  }

  const caps = opts.caps ?? defaultTaskBudget;
  const requested = spawn.budget ?? {};
  const budget: TaskBudget = {
    maxTokens: clamp(requested.maxTokens, caps.maxTokens),
    maxCostUsd: clamp(requested.maxCostUsd, caps.maxCostUsd),
    timeoutSeconds: clamp(requested.timeoutSeconds, caps.timeoutSeconds),
    maxToolCalls: clamp(requested.maxToolCalls, caps.maxToolCalls),
  };

  return {
    ok: true,
    plan: {
      taskType: spawn.taskType,
      goal: spawn.goal,
      runtime: spawn.preferredRuntime ?? def.runtime,
      allowedTools: spawn.allowedTools ?? def.defaultTools,
      budget,
      memoryScope: spawn.memoryScope ?? [],
      reportTo: "session_actor",
    },
  };
}

function clamp(value: number | undefined, cap: number): number {
  if (value === undefined || value <= 0) {
    return cap;
  }
  return Math.min(value, cap);
}
