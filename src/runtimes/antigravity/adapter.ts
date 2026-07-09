import type { RuntimeAdapterCapabilities } from "../../contracts/runtime";
import {
  bunSpawnProbe,
  defaultCapabilities,
  type CommandProbe,
  type RuntimeAdapter,
  type RuntimeAvailability,
} from "../base";

/**
 * Adapter for the Antigravity CLI runtime. Availability is probe-based: if the
 * `antigravity` binary is missing, the runtime reports a safe unavailable state
 * (no throw). Capabilities stay conservative until the installed version is
 * verified — see {@link AntigravityAdapter.reportCapabilitiesForVersion}.
 */
export class AntigravityAdapter implements RuntimeAdapter {
  readonly runtime = "antigravity";
  private readonly command: string;
  private readonly probe: CommandProbe;

  constructor(opts: { command?: string; probe?: CommandProbe } = {}) {
    this.command = opts.command ?? "antigravity";
    this.probe = opts.probe ?? bunSpawnProbe;
  }

  capabilities(): RuntimeAdapterCapabilities {
    return defaultCapabilities(this.runtime, {
      supportsCancel: true,
      supportsOutputBuffering: true,
    });
  }

  async checkAvailability(): Promise<RuntimeAvailability> {
    const result = await this.probe(this.command, ["--version"]);
    if (result.ok) {
      const version = result.stdout.trim();
      return {
        available: true,
        reason: `antigravity CLI available via "${this.command}"`,
        version: version.length > 0 ? version : undefined,
      };
    }
    return {
      available: false,
      reason: `antigravity CLI not found or not runnable (command "${this.command}", exit ${result.exitCode})`,
    };
  }

  /** Note on why capabilities stay conservative until a version is probed. */
  reportCapabilitiesForVersion(version?: string): string {
    return `antigravity capabilities are reported conservatively for version ${version ?? "unknown"}; enable steering/tool-interception/artifacts only after verifying the installed CLI supports them.`;
  }
}
