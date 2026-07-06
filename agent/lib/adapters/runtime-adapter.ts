/**
 * Runtime adapters are how Param reaches native or risky work that must not run
 * in a normal serverless handler: code agents (Codex/OpenCode/Antigravity),
 * browser automation, image generation, and research runners. Each adapter runs
 * behind this interface, is gated on its own credentials, and returns a result
 * to Param — it never talks to a chat directly.
 *
 * This is the foundation: the interface, the registry, and config-gated provider
 * descriptors. The concrete runners are wired per provider once their
 * credentials and execution environment (sandbox / remote runner) are available;
 * until then `run` reports that the adapter is not configured or not yet wired.
 */

export type RuntimeAdapterKind = "browser" | "code" | "image" | "research";

export interface RuntimeJob {
  readonly kind: RuntimeAdapterKind;
  readonly prompt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RuntimeResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly error?: string;
}

export interface RuntimeAdapter {
  readonly id: string;
  readonly kind: RuntimeAdapterKind;
  /** Whether the adapter has the credentials/config it needs to run. */
  isConfigured(): boolean;
  /** Run a job and return a result for Param. Never posts to a chat. */
  run(job: RuntimeJob): Promise<RuntimeResult>;
}

export class RuntimeAdapterRegistry {
  private readonly adapters = new Map<string, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  get(id: string): RuntimeAdapter | undefined {
    return this.adapters.get(id);
  }

  all(): RuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  /** Adapters whose credentials/config are present. */
  configured(): RuntimeAdapter[] {
    return this.all().filter(adapter => adapter.isConfigured());
  }

  /** The first configured adapter for a kind, or undefined if none are ready. */
  selectByKind(kind: RuntimeAdapterKind): RuntimeAdapter | undefined {
    return this.configured().find(adapter => adapter.kind === kind);
  }
}

interface AdapterEnvSpec {
  readonly id: string;
  readonly kind: RuntimeAdapterKind;
  /** Env vars that must all be set for the adapter to count as configured. */
  readonly envKeys: readonly string[];
}

const ADAPTER_ENV_SPECS: readonly AdapterEnvSpec[] = [
  { envKeys: ["PARAM_CODEX_API_KEY"], id: "codex", kind: "code" },
  { envKeys: ["PARAM_OPENCODE_API_KEY"], id: "opencode", kind: "code" },
  { envKeys: ["PARAM_ANTIGRAVITY_API_KEY"], id: "antigravity", kind: "code" },
  { envKeys: ["PARAM_BROWSER_PROVIDER_URL"], id: "browser", kind: "browser" },
  { envKeys: ["PARAM_IMAGE_PROVIDER_API_KEY"], id: "image", kind: "image" },
];

function envAdapter(spec: AdapterEnvSpec, env: NodeJS.ProcessEnv): RuntimeAdapter {
  const isConfigured = () =>
    spec.envKeys.length > 0 && spec.envKeys.every(key => Boolean(env[key]?.trim()));

  return {
    id: spec.id,
    isConfigured,
    kind: spec.kind,
    async run() {
      if (!isConfigured()) {
        return { error: `${spec.id} adapter is not configured`, ok: false };
      }

      return { error: `${spec.id} adapter runner is not wired yet`, ok: false };
    },
  };
}

/**
 * Build the default registry with every known provider registered but gated on
 * its credentials. Nothing runs until the matching env vars are set and the
 * provider's runner is wired.
 */
export function defaultRuntimeRegistry(env: NodeJS.ProcessEnv = process.env): RuntimeAdapterRegistry {
  const registry = new RuntimeAdapterRegistry();
  for (const spec of ADAPTER_ENV_SPECS) {
    registry.register(envAdapter(spec, env));
  }

  return registry;
}
