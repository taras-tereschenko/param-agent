import type { ParamConfig } from "../config/schema";
import type { ActorInference } from "../actor/inference";
import { MockActor } from "../actor/mock-actor";
import { CodexCliActor } from "../runtimes/codex/cli-actor";
import { CodexChatBrain } from "../runtimes/codex/chat-brain";
import { OpenAiApiActor } from "../runtimes/openai/api-actor";

export type ResolvedInference = {
  inference: ActorInference;
  note: string;
};

/**
 * Resolve the Session Actor inference path (the "brain").
 *
 * A REAL brain is the default; the deterministic MockActor is NEVER a silent
 * fallback — it runs only when explicitly requested (`PARAM_ACTOR=mock`), and
 * in production a missing brain HARD-FAILS boot (the boot guard turns the throw
 * into a clean exit so systemd restarts once the operator fixes it).
 *
 * `PARAM_ACTOR` (default `auto`):
 *   - `mock`   → deterministic MockActor (deliberate; allowed in production).
 *   - `openai` → force the direct OpenAI API brain (throws if no OPENAI_API_KEY).
 *   - `codex`  → force the local codex CLI brain (throws if codex unavailable).
 *   - `auto`   → OpenAI API brain if OPENAI_API_KEY is set; else the codex CLI
 *                brain if installed; else hard-fail in production / MockActor in dev.
 *
 * The OpenAI API brain (structured output) is preferred for a user-provided
 * key: the provider enforces the output schema, so it can't silently produce
 * unparseable prose the way the codex-CLI path can (see
 * docs/CODEX_CHAT_BRAIN_PROOF.md).
 */
export async function resolveInference(
  config: ParamConfig,
  env: Record<string, string | undefined> = Bun.env,
): Promise<ResolvedInference> {
  const mode = (env.PARAM_ACTOR ?? "auto").toLowerCase();
  const isProduction = config.app.environment === "production";

  if (mode === "mock") {
    return {
      inference: new MockActor(),
      note: "explicit PARAM_ACTOR=mock (deterministic actor)",
    };
  }

  // Preferred real brain: direct OpenAI API (structured output) when keyed.
  if (mode === "openai" || mode === "auto") {
    const openai = new OpenAiApiActor({
      apiKey: env.OPENAI_API_KEY,
      model: env.PARAM_OPENAI_MODEL,
    });
    if (openai.isAvailable()) {
      return {
        inference: openai,
        note: `OpenAI API brain selected (model ${env.PARAM_OPENAI_MODEL ?? "gpt-4o-mini"})`,
      };
    }
    if (mode === "openai") {
      throw new Error(
        "PARAM_ACTOR=openai but OPENAI_API_KEY is not set — add it to .env or use PARAM_ACTOR=codex/mock",
      );
    }
  }

  // Codex CLI brain: subscription (codex login) or OPENAI_API_KEY, when installed.
  if (mode === "codex" || mode === "auto") {
    if (config.actor.defaultRuntime === "codex") {
      const codexCfg = config.runtimes?.codex;
      if (codexCfg?.adapter === "ai-sdk-harness") {
        const harness = new CodexChatBrain();
        if (await harness.isAvailable()) {
          return {
            inference: harness,
            note: "codex chat-brain via AI SDK harness (sandboxed) selected",
          };
        }
      } else {
        const cli = new CodexCliActor({
          command: codexCfg?.command ?? "codex",
          args: codexCfg?.args ?? ["exec"],
        });
        if (await cli.isAvailable()) {
          return {
            inference: cli,
            note: "codex CLI chat-brain (direct-cli) selected; PROVE output reliability on first runs (docs/CODEX_CHAT_BRAIN_PROOF.md)",
          };
        }
      }
    }
    if (mode === "codex") {
      throw new Error(
        "PARAM_ACTOR=codex but the codex CLI is not available (install it and ensure it's on PATH)",
      );
    }
  }

  // No real brain available.
  if (isProduction) {
    throw new Error(
      "no real Session Actor brain available: set OPENAI_API_KEY (recommended) or install + auth the codex CLI. To run the deterministic actor deliberately, set PARAM_ACTOR=mock.",
    );
  }
  return {
    inference: new MockActor(),
    note: "no real brain configured; using deterministic MockActor (non-production only). Set OPENAI_API_KEY for the real brain.",
  };
}
