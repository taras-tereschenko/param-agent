import type { ParamConfig } from "../config/schema";
import type { ActorInference } from "../actor/inference";
import { MockActor } from "../actor/mock-actor";
import { CodexCliActor } from "../runtimes/codex/cli-actor";
import { CodexChatBrain } from "../runtimes/codex/chat-brain";

export type ResolvedInference = {
  inference: ActorInference;
  note: string;
};

/**
 * Resolve the Session Actor inference path.
 *
 * Order for the `codex` runtime:
 *   1. direct local `codex` CLI chat-brain (VPS/native default) when the CLI is
 *      installed + available;
 *   2. the AI SDK harness path when `adapter: "ai-sdk-harness"` and available;
 *   3. otherwise the deterministic MockActor fallback.
 *
 * The CLI chat-brain's output reliability must be proven on the host (first
 * gate — see docs/CODEX_CHAT_BRAIN_PROOF.md); it degrades to a safe no_reply if
 * the CLI errors or returns unparseable output.
 */
export async function resolveInference(
  config: ParamConfig,
): Promise<ResolvedInference> {
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
  return {
    inference: new MockActor(),
    note: "no proven chat brain available; using deterministic MockActor fallback (see docs/CODEX_CHAT_BRAIN_PROOF.md)",
  };
}
