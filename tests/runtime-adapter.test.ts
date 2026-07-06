import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  defaultRuntimeRegistry,
  RuntimeAdapterRegistry,
  type RuntimeAdapter,
} from "../agent/lib/adapters/runtime-adapter.ts";

const OLD_ENV = { ...process.env };

function fakeAdapter(overrides: Partial<RuntimeAdapter> & { id: string }): RuntimeAdapter {
  return {
    id: overrides.id,
    isConfigured: overrides.isConfigured ?? (() => true),
    kind: overrides.kind ?? "code",
    run: overrides.run ?? (async () => ({ ok: true })),
  };
}

describe("RuntimeAdapterRegistry", () => {
  test("registers and retrieves adapters by id", () => {
    const registry = new RuntimeAdapterRegistry();
    const adapter = fakeAdapter({ id: "a" });
    registry.register(adapter);

    expect(registry.get("a")).toBe(adapter);
    expect(registry.all()).toEqual([adapter]);
  });

  test("configured() returns only adapters that report configured", () => {
    const registry = new RuntimeAdapterRegistry()
      .register(fakeAdapter({ id: "ready", isConfigured: () => true }))
      .register(fakeAdapter({ id: "unready", isConfigured: () => false }));

    expect(registry.configured().map(a => a.id)).toEqual(["ready"]);
  });

  test("selectByKind returns the first configured adapter of that kind", () => {
    const registry = new RuntimeAdapterRegistry()
      .register(fakeAdapter({ id: "code-off", isConfigured: () => false, kind: "code" }))
      .register(fakeAdapter({ id: "code-on", isConfigured: () => true, kind: "code" }))
      .register(fakeAdapter({ id: "browser-on", isConfigured: () => true, kind: "browser" }));

    expect(registry.selectByKind("code")?.id).toBe("code-on");
    expect(registry.selectByKind("browser")?.id).toBe("browser-on");
    expect(registry.selectByKind("image")).toBeUndefined();
  });
});

describe("defaultRuntimeRegistry", () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  test("registers every known provider", () => {
    const ids = defaultRuntimeRegistry({}).all().map(a => a.id);
    expect(ids).toEqual(["codex", "opencode", "antigravity", "browser", "image"]);
  });

  test("adapters are unconfigured without their env vars", () => {
    expect(defaultRuntimeRegistry({}).configured()).toEqual([]);
  });

  test("an adapter becomes configured once its env var is set", () => {
    const registry = defaultRuntimeRegistry({ PARAM_CODEX_API_KEY: "sk-test" });
    expect(registry.configured().map(a => a.id)).toEqual(["codex"]);
    expect(registry.selectByKind("code")?.id).toBe("codex");
  });

  test("a whitespace-only env var does not count as configured", () => {
    expect(defaultRuntimeRegistry({ PARAM_CODEX_API_KEY: "   " }).configured()).toEqual([]);
  });

  test("an unconfigured adapter's run reports it is not configured", async () => {
    const codex = defaultRuntimeRegistry({}).get("codex");
    const result = await codex?.run({ kind: "code", prompt: "hi" });
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain("not configured");
  });

  test("a configured adapter's run reports the runner is not wired yet", async () => {
    const codex = defaultRuntimeRegistry({ PARAM_CODEX_API_KEY: "sk-test" }).get("codex");
    const result = await codex?.run({ kind: "code", prompt: "hi" });
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain("not wired yet");
  });
});
