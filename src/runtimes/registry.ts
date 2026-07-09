import type { RuntimeAdapter, RuntimeAvailability } from "./base";

/**
 * A registry of runtime adapters keyed by runtime name. Lets Param core look up
 * an adapter, enumerate them, and produce a single aggregated availability
 * report (used by ops/diagnostics to see which runtimes are reachable).
 */
export class RuntimeRegistry {
  private readonly adapters = new Map<string, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): this {
    this.adapters.set(adapter.runtime, adapter);
    return this;
  }

  get(runtime: string): RuntimeAdapter | undefined {
    return this.adapters.get(runtime);
  }

  list(): RuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Probe every registered adapter and collect the results. Adapters should not
   * throw from `checkAvailability`, but a defensive catch keeps one bad adapter
   * from failing the whole report.
   */
  async availabilityReport(): Promise<Record<string, RuntimeAvailability>> {
    const entries = await Promise.all(
      this.list().map(async (adapter) => {
        try {
          const availability = await adapter.checkAvailability();
          return [adapter.runtime, availability] as const;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return [
            adapter.runtime,
            { available: false, reason: `availability check threw: ${message}` },
          ] as const;
        }
      }),
    );

    const report: Record<string, RuntimeAvailability> = {};
    for (const [runtime, availability] of entries) {
      report[runtime] = availability;
    }
    return report;
  }
}
