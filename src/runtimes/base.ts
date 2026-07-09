import type { RuntimeAdapterCapabilities } from "../contracts/runtime";

/**
 * Runtime Adapters subsystem — the seam between Param core and the external
 * runtimes/CLIs that can execute work (Codex, OpenCode, Antigravity, image and
 * browser runtimes). Adapters never fabricate results: when a runtime cannot be
 * reached they report an honest unavailable state with a clear reason.
 */

/** Result of probing whether a runtime can actually be used right now. */
export type RuntimeAvailability = {
  available: boolean;
  reason: string;
  version?: string;
};

/**
 * The minimal contract every runtime adapter implements. Capability discovery
 * and availability probing are separated so Param core can plan against a
 * runtime's declared capabilities without paying for (or being blocked by) a
 * live availability check.
 */
export interface RuntimeAdapter {
  readonly runtime: string;
  capabilities(): RuntimeAdapterCapabilities;
  checkAvailability(): Promise<RuntimeAvailability>;
}

/**
 * A conservative capability set: everything off except output buffering. Param
 * core must work when capabilities are false, so adapters opt in explicitly via
 * `overrides` only for features they have actually proven for a given runtime.
 */
export function defaultCapabilities(
  runtime: string,
  overrides: Partial<Omit<RuntimeAdapterCapabilities, "runtime">> = {},
): RuntimeAdapterCapabilities {
  return {
    runtime,
    supportsLiveSteering: false,
    supportsCancel: false,
    supportsCheckpointRefresh: false,
    supportsToolInterception: false,
    supportsOutputBuffering: true,
    supportsArtifacts: false,
    supportsUsage: false,
    ...overrides,
  };
}

/**
 * Injectable process probe. Runs a command and reports whether it succeeded.
 * Tests inject a fake so no real process is ever spawned; production uses
 * {@link bunSpawnProbe}.
 */
export type CommandProbe = (
  command: string,
  args: string[],
) => Promise<{ ok: boolean; stdout: string; exitCode: number }>;

/**
 * Default {@link CommandProbe} backed by `Bun.spawn`. Runs `<command> <args>`
 * (adapters pass `["--version"]`), captures stdout, and treats exit code 0 as
 * success. Any spawn failure (ENOENT / missing binary / thrown error) is turned
 * into a safe `{ ok: false, exitCode: 127, stdout: "" }` rather than a throw, so
 * a missing CLI degrades to an unavailable runtime instead of crashing Param.
 */
export const bunSpawnProbe: CommandProbe = async (command, args) => {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { ok: exitCode === 0, stdout, exitCode };
  } catch {
    return { ok: false, exitCode: 127, stdout: "" };
  }
};
