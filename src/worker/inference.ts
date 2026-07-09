import type { ParamConfig } from "../config/schema";
import type { ActorInference } from "../actor/inference";
import { MockActor } from "../actor/mock-actor";
import { CodexChatBrain } from "../runtimes/codex/chat-brain";

export type ResolvedInference = {
  inference: ActorInference;
  note: string;
};

/**
 * Resolve the Session Actor inference path.
 *
 * The Codex chat-brain path is a first-class target but is unproven in this
 * environment (no installed `codex` CLI, no subscription auth, no sandbox), so
 * it reports unavailable. Until a real path is proven/configured, Param falls
 * back to the deterministic MockActor, which exercises the full loop safely.
 * See docs/CODEX_CHAT_BRAIN_PROOF.md.
 */
export async function resolveInference(
  config: ParamConfig,
): Promise<ResolvedInference> {
  if (config.actor.defaultRuntime === "codex") {
    const codex = new CodexChatBrain();
    if (await codex.isAvailable()) {
      return {
        inference: codex,
        note: "codex chat-brain available and selected",
      };
    }
  }
  return {
    inference: new MockActor(),
    note: "codex chat-brain unavailable in this environment; using deterministic MockActor fallback (see docs/CODEX_CHAT_BRAIN_PROOF.md)",
  };
}
