import type { RuntimeAdapterCapabilities } from "../../contracts/runtime";
import {
  defaultCapabilities,
  type RuntimeAdapter,
  type RuntimeAvailability,
} from "../base";

/**
 * Placeholder browser-automation runtime.
 *
 * Intended inputs: a navigation/task goal and a set of target URLs. Intended
 * outputs: artifact refs (screenshots, extracted content, downloads). Risky
 * actions (form submits, purchases, destructive navigation) must go through
 * Param's approval flow before execution. Not configured by default, so it
 * reports available:false until a concrete provider is wired in.
 */
export class BrowserRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = "browser";

  capabilities(): RuntimeAdapterCapabilities {
    // Intended to produce artifacts and require approval for risky actions, but
    // it stays unavailable until wired.
    return defaultCapabilities(this.runtime, { supportsArtifacts: true });
  }

  async checkAvailability(): Promise<RuntimeAvailability> {
    return { available: false, reason: "not configured" };
  }
}
