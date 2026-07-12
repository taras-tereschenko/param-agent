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
  '[{"type":"message","payload":{"text":"hey, yeah i\'m around. what\'s up?"}},{"type":"done","payload":{"status":"completed"}}]',
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
 * Find every top-level, balanced `[ ... ]` span in the text (string-aware, so
 * brackets inside JSON string values don't confuse the matcher). Used to pull
 * codex's actor-output array out of any surrounding prose WITHOUT the
 * first-`[`-to-last-`]` corruption that bracketed prose (e.g. "see [1]") caused.
 */
export function findBalancedArrays(text: string): string[] {
  const spans: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "[") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "[") depth += 1;
      else if (c === "]") {
        depth -= 1;
        if (depth === 0) {
          spans.push(text.slice(i, j + 1));
          i = j; // don't restart inside this span
          break;
        }
      }
    }
  }
  return spans;
}

/**
 * Parse codex output into actor drafts, robust to surrounding prose/reasoning.
 * Tries the whole output first (pure JSON / code fence), then each balanced
 * `[...]` span (largest first — the actor array is the substantial one),
 * returning the first that yields ≥1 valid draft plus the matched text (so the
 * caller can subtract it when recovering a prose reply).
 */
export function parseCodexOutputs(stdout: string): {
  drafts: ActorOutputDraft[];
  matched?: string;
} {
  const whole = parseActorOutputs(stdout);
  if (whole.drafts.length > 0) {
    return { drafts: whole.drafts, matched: stdout.trim() };
  }
  const spans = findBalancedArrays(stdout).sort((a, b) => b.length - a.length);
  for (const span of spans) {
    const parsed = parseActorOutputs(span);
    if (parsed.drafts.length > 0) {
      return { drafts: parsed.drafts, matched: span };
    }
  }
  return { drafts: [] };
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

    const { drafts, matched } = parseCodexOutputs(res.stdout);

    // Only recover a prose reply when the model gave us NOTHING actionable —
    // i.e. drafts are empty or contain only `done`. Never override an explicit
    // no_reply / tool_call / react / spawn that codex intentionally emitted,
    // even if it also printed reasoning prose around it.
    const onlyDoneOrEmpty =
      drafts.length === 0 || drafts.every((d) => d.type === "done");
    if (onlyDoneOrEmpty) {
      // codex is a chat model and may reply in PLAIN PROSE instead of the JSON
      // format (or add a `done` with no message). Deliver that prose so the bot
      // actually talks. Subtract the matched JSON so we don't echo it; if codex
      // returned ONLY `[{done}]` there is no prose and this stays quiet (the
      // strengthened OUTPUT_INSTRUCTION is what makes it emit a message).
      const prose = plainReplyText(
        matched ? res.stdout.replace(matched, " ") : res.stdout,
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
        // The raw output shows HOW codex replied (prose vs JSON, wrapper text,
        // banners) so the exec invocation / parser can be tuned precisely.
        stdoutHead: res.stdout.slice(0, 800),
      });
      return { drafts: SAFE_FALLBACK, provider: "codex-cli" };
    }
    if (onlyDoneOrEmpty) {
      // Parsed only `done` with no prose to recover — log so a mis-following
      // model is diagnosable in one run (the actor will simply stay quiet).
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
  // Strip code fences only — do NOT strip brackets/braces: a real reply can
  // contain them ("the values are [1, 2, 3]") and greedy stripping silently
  // dropped that content. The JSON actor-array, when present, is already
  // subtracted by the caller (via the matched span).
  const cleaned = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 4000) {
    return "";
  }
  if (!/[a-zA-Z]/.test(cleaned)) {
    return "";
  }
  return cleaned;
}
