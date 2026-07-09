import type { RuntimeAdapterCapabilities } from "../../contracts/runtime";
import {
  defaultCapabilities,
  type RuntimeAdapter,
  type RuntimeAvailability,
} from "../base";

/**
 * Placeholder image-generation runtime.
 *
 * Intended inputs: a generation goal, an optional style spec, and reference
 * artifact refs. Intended outputs: one or more artifact refs (the generated
 * images) plus usage. Not configured by default, so it reports available:false
 * until a concrete provider is wired in.
 */
export class ImageRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = "image";

  capabilities(): RuntimeAdapterCapabilities {
    // Its intended product is artifacts, but it stays unavailable until wired.
    return defaultCapabilities(this.runtime, { supportsArtifacts: true });
  }

  async checkAvailability(): Promise<RuntimeAvailability> {
    return { available: false, reason: "not configured" };
  }
}
