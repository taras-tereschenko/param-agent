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
  "You are replying in a chat, NOT running a coding task. Respond with ONLY a",
  "JSON array of Param actor outputs — no prose, no code fence, nothing before",
  "or after the JSON.",
  'Each element is {"type": <allowed output>, "payload": { ... }} using only',
  "the allowed outputs and payload shapes for this run.",
  "For a normal chat turn you MUST include at least one message output with your",
  'actual reply text, THEN end with {"type":"done","payload":{"status":"completed"}}.',
  "Example of a normal reply:",
  '[{"type":"message","payload":{"text":"hey, yeah I\'m around — what\'s up?"}},{"type":"done","payload":{"status":"completed"}}]',
  '"done" on its own is NOT a reply. Only omit the message when the situation',
  "genuinely needs no response, and then say so explicitly:",
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

/**
 * codex exec may wrap the JSON array in reasoning/prose. Extract the array so
 * the parser (which JSON.parses the whole string) doesn't fail on surrounding
 * text: if the output isn't already pure JSON / a code fence, slice from the
 * first `[` to the last `]`. Falls back to the raw text unchanged.
 */
export function extractOutputArray(stdout: string): string {
  const trimmed = stdout.trim();
  if (
    trimmed.startsWith("[") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("```")
  ) {
    return trimmed;
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

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

    const arrayText = extractOutputArray(res.stdout);
    const { drafts, errors } = parseActorOutputs(arrayText);
    const hasMessage = drafts.some((d) => d.type === "message");

    // codex is a chat model and may reply in PLAIN PROSE instead of the JSON
    // format. Never drop that: if no structured message was parsed, wrap any
    // prose codex produced as the reply so the bot actually talks. (When codex
    // returned ONLY `[{done}]` there is no prose, so this correctly stays quiet
    // and the strengthened OUTPUT_INSTRUCTION is what makes it emit a message.)
    if (!hasMessage) {
      const prose = plainReplyText(
        drafts.length === 0 ? res.stdout : res.stdout.replace(arrayText, " "),
      );
      if (prose) {
        // Build through the parser so the message payload gets its schema
        // defaults (parseMode/style/visible) and is a valid draft.
        const { drafts: wrapped } = parseActorOutputs([
          { type: "message", payload: { text: prose } },
          { type: "done", payload: { status: "completed" } },
        ]);
        if (wrapped.length > 0) {
          return { drafts: wrapped, provider: "codex-cli" };
        }
      }
    }

    if (drafts.length === 0) {
      log.warn("codex cli produced no valid outputs; staying quiet", {
        errors: errors.slice(0, 3),
        // The raw output shows HOW codex replied (prose vs JSON, wrapper text,
        // banners) so the exec invocation / parser can be tuned precisely.
        stdoutHead: res.stdout.slice(0, 800),
      });
      return { drafts: SAFE_FALLBACK, provider: "codex-cli" };
    }
    // Parsed, but the model closed the turn with only `done`/nothing to say and
    // wrote no prose — log the raw output so a mis-following model is
    // diagnosable in one run (the actor will simply stay quiet).
    const hasReplyOrAction = drafts.some(
      (d) =>
        d.type === "message" ||
        d.type === "react_to_message" ||
        d.type === "render_ui" ||
        d.type === "no_reply" ||
        d.type === "tool_call" ||
        d.type === "spawn_task_agent",
    );
    if (!hasReplyOrAction) {
      log.warn("codex cli returned no message/action (only done); staying quiet", {
        stdoutHead: res.stdout.slice(0, 800),
      });
    }
    return { drafts, provider: "codex-cli" };
  }
}

/**
 * Extract a plausible plain-text reply from codex output when no structured
 * message was parsed: strip code fences + any bracketed JSON, collapse
 * whitespace, and require real words at a sane length. Returns "" when nothing
 * usable remains (so a done-only turn stays quiet rather than sending noise).
 */
export function plainReplyText(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[[\s\S]*\]/g, " ")
    .replace(/\{[\s\S]*\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 4000) {
    return "";
  }
  if (!/[a-zA-Z]/.test(cleaned)) {
    return "";
  }
  return cleaned;
}
