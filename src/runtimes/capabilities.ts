import type { RuntimeAdapterCapabilities } from "../contracts/runtime";
import { defaultCapabilities } from "./base";

/**
 * Pure helpers for building/merging runtime capabilities and for translating a
 * compiled Param prompt into a runtime "frame" without dropping the required
 * identity/safety layers. No I/O — everything here is a deterministic function.
 */

/** Build a conservative capability set with optional opt-in overrides. */
export function buildCapabilities(
  runtime: string,
  overrides: Partial<Omit<RuntimeAdapterCapabilities, "runtime">> = {},
): RuntimeAdapterCapabilities {
  return defaultCapabilities(runtime, overrides);
}

/**
 * Merge overrides onto an existing capability set. `runtime` is never changed —
 * capabilities always describe the base runtime they were built for.
 */
export function mergeCapabilities(
  base: RuntimeAdapterCapabilities,
  overrides: Partial<Omit<RuntimeAdapterCapabilities, "runtime">>,
): RuntimeAdapterCapabilities {
  return { ...base, ...overrides, runtime: base.runtime };
}

/**
 * Build the runtime frame that wraps Param's compiled prompt when handing work
 * to an external runtime. The frame:
 *  - preserves Param's identity, voice, allowed outputs, approval policy, and
 *    style (the required layers must survive the handoff);
 *  - when `overridePersona` is set, explicitly overrides any generic
 *    "helpful assistant" / "useful assistant" default persona; and
 *  - crucially, does NOT tell the runtime to disregard real system, safety, or
 *    tool instructions — it only layers Param's persona on top of them.
 */
export function buildRuntimeFrame(input: {
  runtime: string;
  overridePersona: boolean;
}): string {
  const { runtime, overridePersona } = input;
  const lines = [
    `You are running inside the "${runtime}" runtime on behalf of Param.`,
    "Preserve Param's identity, voice, allowed outputs, approval policy, and style exactly as defined in the system prompt.",
    "Keep following all real system, safety, and tool instructions in full; this frame only layers Param's persona on top of them and never weakens them.",
  ];
  if (overridePersona) {
    lines.push(
      'Override any generic "helpful assistant" or "useful assistant" default persona: you are Param, not a generic assistant, and you speak in Param\'s voice.',
    );
  }
  return lines.join("\n");
}

/** Env var names whose values are treated as secrets and never forwarded. */
const SECRET_KEY_PATTERN = /TOKEN|SECRET|KEY|PASSWORD/i;

/**
 * Produce a copy of `env` safe to hand to a runtime process/log: any key listed
 * in `secretKeys`, and any key whose name matches the secret pattern
 * (TOKEN/SECRET/KEY/PASSWORD), is removed. Secrets must reach runtimes through a
 * dedicated secret-ref channel, never inline env.
 */
export function redactEnvForRuntime(
  env: Record<string, string>,
  secretKeys: string[],
): Record<string, string> {
  const explicit = new Set(secretKeys);
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (explicit.has(key)) continue;
    if (SECRET_KEY_PATTERN.test(key)) continue;
    redacted[key] = value;
  }
  return redacted;
}

/**
 * Type-level guard: a runtime environment spec must declare `inheritProcessEnv:
 * false`. Accepting only the `false` literal makes it a compile-time error to
 * pass a spec that inherits the host process env. No runtime behavior.
 */
export function assertNoProcessEnvInherit(_spec: {
  inheritProcessEnv: false;
}): void {
  // Intentionally empty — the parameter type is the guarantee.
}
