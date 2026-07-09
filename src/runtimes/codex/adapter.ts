import type { RuntimeAdapterCapabilities } from "../../contracts/runtime";
import {
  bunSpawnProbe,
  defaultCapabilities,
  type CommandProbe,
  type RuntimeAdapter,
  type RuntimeAvailability,
} from "../base";

export type CodexAdapterMode = "direct-cli" | "ai-sdk-harness";

/**
 * Adapter for the Codex runtime. Two integration modes:
 *  - `direct-cli`: shell out to a local `codex` binary (probed for availability);
 *  - `ai-sdk-harness`: drive Codex via the AI SDK harness + a sandbox provider.
 *
 * The harness path is the documented, unproven-in-this-environment path (see the
 * Codex chat-brain proof gate). Its packages are imported LAZILY inside
 * {@link CodexAdapter.probeHarness} and wrapped in try/catch, so importing this
 * adapter never crashes the build even when the harness cannot load, and
 * `checkAvailability()` never throws.
 */
export class CodexAdapter implements RuntimeAdapter {
  readonly runtime = "codex";
  private readonly command: string;
  private readonly adapter: CodexAdapterMode;
  private readonly probe: CommandProbe;

  constructor(
    opts: {
      command?: string;
      adapter?: CodexAdapterMode;
      probe?: CommandProbe;
    } = {},
  ) {
    this.command = opts.command ?? "codex";
    this.adapter = opts.adapter ?? "direct-cli";
    this.probe = opts.probe ?? bunSpawnProbe;
  }

  capabilities(): RuntimeAdapterCapabilities {
    // Conservative: a CLI process can be killed (cancel) and its output buffered,
    // but we do not claim live steering or in-flight tool interception.
    return defaultCapabilities(this.runtime, {
      supportsCancel: true,
      supportsOutputBuffering: true,
      supportsLiveSteering: false,
    });
  }

  async checkAvailability(): Promise<RuntimeAvailability> {
    if (this.adapter === "ai-sdk-harness") {
      return this.probeHarness();
    }
    return this.probeCli();
  }

  private async probeCli(): Promise<RuntimeAvailability> {
    const result = await this.probe(this.command, ["--version"]);
    if (result.ok) {
      const version = result.stdout.trim();
      return {
        available: true,
        reason: `codex CLI available via "${this.command}"`,
        version: version.length > 0 ? version : undefined,
      };
    }
    return {
      available: false,
      reason: `codex CLI not found or not runnable (command "${this.command}", exit ${result.exitCode})`,
    };
  }

  /**
   * Probe the AI SDK harness path. Imports are lazy and guarded so a failure to
   * load the harness (the expected result in this environment — the isolated AI
   * SDK internals cannot resolve the `zod/v4` subpath) degrades to a clear
   * unavailable state instead of throwing. Availability is only reported when
   * the harness AND the Vercel sandbox provider load AND a sandbox token is
   * detected — none of which hold here.
   */
  async probeHarness(): Promise<RuntimeAvailability> {
    try {
      await import("@ai-sdk/harness-codex");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        reason: `AI SDK harness import failed in this environment (zod/v4 subpath): ${message}`,
      };
    }

    // The harness-codex package loaded; the Vercel Sandbox path additionally
    // needs @ai-sdk/harness + @ai-sdk/sandbox-vercel and a sandbox token/auth.
    try {
      await import("@ai-sdk/harness");
      await import("@ai-sdk/sandbox-vercel");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        reason: `harness imported but sandbox provider import failed: ${message}`,
      };
    }

    if (!hasSandboxToken()) {
      return {
        available: false,
        reason: "harness imported but no sandbox provider/auth configured",
      };
    }

    return {
      available: true,
      reason: "ai-sdk harness + vercel sandbox provider available",
    };
  }
}

function hasSandboxToken(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  const candidates = [
    "VERCEL_SANDBOX_TOKEN",
    "VERCEL_OIDC_TOKEN",
    "VERCEL_TOKEN",
  ];
  return candidates.some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0;
  });
}
