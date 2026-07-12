import type {
  ActorInference,
  ActorInferenceRequest,
  ActorInferenceResult,
} from "../../actor/inference";
import type { ActorOutputDraft } from "../../contracts/actor-output";
import { parseActorOutputs } from "../../actor/output-parser";
import { logger } from "../../observability/logger";

/**
 * Direct local Codex CLI chat-brain (VPS/native path).
 *
 * Runs the installed, subscription-backed `codex` CLI non-interactively, feeds
 * it the compiled Param prompt plus a strict output-format instruction, and
 * parses stdout into Param actor outputs. If the CLI is missing, errors, times
 * out, or produces unparseable output, the turn degrades to a safe no_reply so
 * a bad model turn never crashes the loop or delivers garbage.
 *
 * IMPORTANT: the exact non-interactive invocation and output reliability depend
 * on the installed codex version and MUST be validated on the host (the first
 * gate from GOAL.md / docs/CODEX_CHAT_BRAIN_PROOF.md). The command + args are
 * config-driven (runtimes.codex.command / args) so they can be tuned without a
 * code change.
 */
const log = logger.child("codex-cli");

const OUTPUT_INSTRUCTION = [
  "",
  "=== PARAM OUTPUT FORMAT (STRICT) ===",
  "Respond with ONLY a JSON array of Param actor outputs. No prose, no code",
  "fence, no explanation before or after the JSON.",
  'Each element is {"type": <allowed output>, "payload": { ... }} using only',
  "the allowed outputs and payload shapes for this run.",
  'Always end the array with {"type":"done","payload":{"status":"completed"}}.',
  "If you should stay quiet, return exactly:",
  '[{"type":"no_reply","payload":{"reason":"nothing_to_add"}},{"type":"done","payload":{"status":"completed"}}]',
].join("\n");

export type CliRunInput = {
  command: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
  env?: Record<string, string>;
  cwd?: string;
};

export type CliRunResult = { stdout: string; stderr: string; exitCode: number };

export type CliRunner = (input: CliRunInput) => Promise<CliRunResult>;

/** Default runner: spawn the CLI, feed stdin, capture stdout with a timeout. */
export const bunCliRunner: CliRunner = async (input) => {
  const proc = Bun.spawn([input.command, ...input.args], {
    stdin: Buffer.from(input.stdin),
    stdout: "pipe",
    stderr: "pipe",
    cwd: input.cwd,
    env: input.env,
  });
  // On timeout send SIGTERM, then escalate to SIGKILL if the child ignores it —
  // otherwise a stuck child leaves `proc.exited` pending forever and hangs the
  // caller (the worker's job loop).
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
    killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    }, 2_000);
  }, input.timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
  }
};

const SAFE_FALLBACK: ActorOutputDraft[] = [
  { type: "no_reply", payload: { reason: "nothing_to_add" } },
  { type: "done", payload: { status: "completed" } },
];

export type CodexCliActorOptions = {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  runner?: CliRunner;
  env?: Record<string, string>;
  cwd?: string;
};

export class CodexCliActor implements ActorInference {
  readonly name = "codex-cli";
  readonly description =
    "direct local codex CLI chat-brain (non-interactive); output reliability must be proven on the host";

  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number;
  private readonly runner: CliRunner;
  private readonly env?: Record<string, string>;
  private readonly cwd?: string;

  constructor(opts: CodexCliActorOptions = {}) {
    this.command = opts.command ?? "codex";
    this.args = opts.args ?? ["exec"];
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.runner = opts.runner ?? bunCliRunner;
    this.env = opts.env;
    this.cwd = opts.cwd;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.runner({
        command: this.command,
        args: ["--version"],
        stdin: "",
        timeoutMs: 5_000,
        env: this.env,
        cwd: this.cwd,
      });
      return res.exitCode === 0;
    } catch {
      return false;
    }
  }

  async run(request: ActorInferenceRequest): Promise<ActorInferenceResult> {
    const prompt = `${request.renderedPrompt}\n${OUTPUT_INSTRUCTION}`;
    let res: CliRunResult;
    try {
      res = await this.runner({
        command: this.command,
        args: this.args,
        stdin: prompt,
        timeoutMs: this.timeoutMs,
        env: this.env,
        cwd: this.cwd,
      });
    } catch (error) {
      log.warn("codex cli spawn failed; staying quiet", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { drafts: SAFE_FALLBACK, provider: "codex-cli" };
    }

    if (res.exitCode !== 0) {
      log.warn("codex cli exited non-zero; staying quiet", {
        exitCode: res.exitCode,
        // Surface the real error so a broken invocation is diagnosable in one
        // run (auth/prompt/flag problems show here) instead of a silent quiet.
        stderrHead: res.stderr.slice(0, 800),
        stdoutHead: res.stdout.slice(0, 400),
      });
      return { drafts: SAFE_FALLBACK, provider: "codex-cli" };
    }

    const { drafts, errors } = parseActorOutputs(res.stdout);
    if (drafts.length === 0) {
      log.warn("codex cli produced no valid outputs; staying quiet", {
        errors: errors.slice(0, 3),
        // The raw output shows HOW codex replied (prose vs JSON, wrapper text,
        // banners) so the exec invocation / parser can be tuned precisely.
        stdoutHead: res.stdout.slice(0, 800),
      });
      return { drafts: SAFE_FALLBACK, provider: "codex-cli" };
    }
    return { drafts, provider: "codex-cli" };
  }
}
