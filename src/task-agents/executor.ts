import { mkdirSync } from "node:fs";

import type { ParamConfig } from "../config/schema";
import { bunCliRunner, type CliRunner } from "../runtimes/codex/cli-actor";
import { scrubbedCliEnv } from "../worker/inference";
import type { TaskRunPlan } from "./spawn";

/**
 * Task-agent EXECUTION seam.
 *
 * A spawned task agent runs its goal on an external runtime CLI (codex /
 * opencode) non-interactively, then reports a concise result back to the parent
 * Session Actor via a task.result event. Executors never fabricate success: a
 * missing/failed runtime yields an honest failed outcome with a clear reason.
 *
 * SECURITY: the CLI is spawned with a scrubbed env (no DATABASE_URL / bot token
 * — see scrubbedCliEnv) and a hard timeout from the plan budget, so a task
 * agent cannot exfiltrate Param's secrets or run unbounded.
 */

export type TaskExecutionOutcome = {
  status: "completed" | "failed";
  summary: string;
  followUpSuggestions?: string[];
  error?: { code: string; message: string };
};

export interface TaskRuntimeExecutor {
  readonly runtime: string;
  /** Cheap probe: is the runtime usable right now? */
  isAvailable(): Promise<boolean>;
  /** Execute the plan under its budget and return a structured outcome. */
  run(plan: TaskRunPlan): Promise<TaskExecutionOutcome>;
}

/** Cap the reported summary so one runaway task can't bloat an event row. */
const MAX_SUMMARY_CHARS = 4000;

/** Build the non-interactive task prompt fed to the runtime CLI over stdin. */
export function buildTaskPrompt(plan: TaskRunPlan): string {
  const tools =
    plan.allowedTools.length > 0 ? plan.allowedTools.join(", ") : "none";
  return [
    `You are a Param task agent of type "${plan.taskType}".`,
    "Complete the task below and report a concise, self-contained result.",
    "You report to the Session Actor, not directly to a user; write a short",
    "plain-text summary of what you found or did.",
    "",
    `Task goal: ${plan.goal}`,
    `Allowed tools: ${tools}`,
    "",
    "Return only your final summary — no preamble, no code fences.",
  ].join("\n");
}

/**
 * CLI-backed task executor (codex/opencode). Enforces the plan's timeout as a
 * hard kill; token/cost/tool-call caps are advisory (the opaque CLI does not
 * expose them) and are recorded on the run for observability.
 */
export class CliTaskExecutor implements TaskRuntimeExecutor {
  readonly runtime: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly runner: CliRunner;
  private readonly env?: Record<string, string>;
  private readonly cwd?: string;

  constructor(opts: {
    runtime: string;
    command: string;
    args?: string[];
    runner?: CliRunner;
    env?: Record<string, string>;
    cwd?: string;
  }) {
    this.runtime = opts.runtime;
    this.command = opts.command;
    this.args = opts.args ?? ["exec"];
    this.runner = opts.runner ?? bunCliRunner;
    this.env = opts.env;
    this.cwd = opts.cwd;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Probe the binary on PATH; do not gate on the workspace cwd (it may not
      // exist yet — run() creates it before executing).
      const res = await this.runner({
        command: this.command,
        args: ["--version"],
        stdin: "",
        timeoutMs: 5_000,
        env: this.env,
      });
      return res.exitCode === 0;
    } catch {
      return false;
    }
  }

  async run(plan: TaskRunPlan): Promise<TaskExecutionOutcome> {
    const timeoutMs = Math.max(1, plan.budget.timeoutSeconds) * 1_000;
    // Ensure the isolated workspace dir exists so the spawn doesn't ENOENT.
    if (this.cwd) {
      try {
        mkdirSync(this.cwd, { recursive: true });
      } catch {
        /* best-effort; the spawn will surface a real error if it truly fails */
      }
    }
    let res: Awaited<ReturnType<CliRunner>>;
    try {
      res = await this.runner({
        command: this.command,
        args: this.args,
        stdin: buildTaskPrompt(plan),
        timeoutMs,
        env: this.env,
        cwd: this.cwd,
      });
    } catch (error) {
      return {
        status: "failed",
        summary: `task runtime (${this.runtime}) failed to start`,
        error: {
          code: "spawn_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (res.exitCode !== 0) {
      return {
        status: "failed",
        summary: `task runtime (${this.runtime}) exited with code ${res.exitCode}`,
        error: {
          code: "nonzero_exit",
          message: (res.stderr || res.stdout || "").trim().slice(0, 500),
        },
      };
    }

    const summary = res.stdout.trim().slice(0, MAX_SUMMARY_CHARS);
    if (!summary) {
      return {
        status: "failed",
        summary: `task runtime (${this.runtime}) produced no output`,
        error: { code: "empty_output", message: "runtime returned empty stdout" },
      };
    }
    return { status: "completed", summary };
  }
}

/** Runtime name -> executor. Unknown runtimes resolve to undefined (unavailable). */
export class TaskRuntimeRegistry {
  private readonly executors = new Map<string, TaskRuntimeExecutor>();

  constructor(executors: TaskRuntimeExecutor[] = []) {
    for (const executor of executors) {
      this.executors.set(executor.runtime, executor);
    }
  }

  resolve(runtime: string): TaskRuntimeExecutor | undefined {
    return this.executors.get(runtime);
  }

  list(): TaskRuntimeExecutor[] {
    return [...this.executors.values()];
  }
}

/**
 * Build the default task-runtime registry from config. Only direct-CLI runtimes
 * with a configured command become executors (codex/opencode); everything else
 * (mock/image/browser task types) has no executor and reports an honest
 * unavailable outcome. The CLI env is scrubbed of Param secrets.
 */
export function buildTaskExecutors(
  config: ParamConfig,
  env: Record<string, string | undefined> = Bun.env,
): TaskRuntimeRegistry {
  const executors: TaskRuntimeExecutor[] = [];
  const scrubbed = scrubbedCliEnv(env);
  const runtimes = config.runtimes ?? {};
  // Non-interactive subcommand per runtime (codex `exec`, opencode `run`).
  const defaultArgs: Record<string, string[]> = {
    codex: ["exec"],
    opencode: ["run"],
  };

  for (const runtime of ["codex", "opencode"] as const) {
    const rt = runtimes[runtime];
    if (!rt || !rt.enabled || !("command" in rt) || !rt.command) {
      continue;
    }
    // Only DIRECT-CLI runtimes are spawned raw here. A harness/sandboxed
    // runtime (adapter "ai-sdk-harness") must NOT be run raw — that would
    // bypass its sandbox — so it has no task executor until harness execution
    // is wired.
    if ("adapter" in rt && rt.adapter === "ai-sdk-harness") {
      continue;
    }
    executors.push(
      new CliTaskExecutor({
        runtime,
        command: rt.command,
        args: rt.args ?? defaultArgs[runtime],
        env: scrubbed,
        cwd: "workspacesDir" in rt ? rt.workspacesDir : undefined,
      }),
    );
  }

  return new TaskRuntimeRegistry(executors);
}
