import type {
  ActorInference,
  ActorInferenceRequest,
  ActorInferenceResult,
} from "../../actor/inference";
import { runtimeUnavailableError } from "../../shared/errors";
import type { CommandProbe } from "../base";
import { CodexAdapter, type CodexAdapterMode } from "./adapter";

/**
 * The Codex "chat-brain" as a Session Actor inference source — usable ONLY once
 * the Codex path is actually proven in the running environment. It never
 * fabricates drafts: `isAvailable()` delegates to a {@link CodexAdapter}
 * availability probe, and `run()` throws a `runtime_unavailable` ParamError with
 * the concrete blocker reason whenever the runtime cannot be reached (which is
 * the documented state in this environment). Param falls back to the
 * deterministic MockActor rather than inventing model output.
 */
export class CodexChatBrain implements ActorInference {
  readonly name = "codex";
  readonly description =
    "Codex chat-brain actor (chat-brain-when-proven); yields to the fallback actor unless a real Codex runtime is available, and never fabricates drafts";

  private readonly adapter: CodexAdapter;

  constructor(
    opts: {
      adapter?: CodexAdapter;
      command?: string;
      mode?: CodexAdapterMode;
      probe?: CommandProbe;
    } = {},
  ) {
    this.adapter =
      opts.adapter ??
      new CodexAdapter({
        command: opts.command,
        adapter: opts.mode,
        probe: opts.probe,
      });
  }

  async isAvailable(): Promise<boolean> {
    // run() is intentionally not implemented in this environment (the proven
    // prompt-handoff + output-parsing path is unfinished), so this brain is NOT
    // usable — report false. Otherwise resolveInference would select it on a
    // box where the codex binary probes available, and EVERY turn would throw.
    // The direct-CLI CodexCliActor is the working codex path.
    return false;
  }

  async run(_request: ActorInferenceRequest): Promise<ActorInferenceResult> {
    const availability = await this.adapter.checkAvailability();
    if (!availability.available) {
      throw runtimeUnavailableError(
        `codex chat-brain unavailable: ${availability.reason}`,
        { runtime: "codex" },
      );
    }
    // The runtime probed available, but the proven inference wiring (prompt
    // handoff + output parsing) is intentionally not implemented in this
    // environment. Fail honestly rather than returning fabricated drafts.
    throw runtimeUnavailableError(
      "codex chat-brain unavailable: proven inference path not implemented in this environment",
      { runtime: "codex" },
    );
  }
}
