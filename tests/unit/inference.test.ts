import { describe, expect, test } from "bun:test";

import type { ParamConfig } from "../../src/config/schema";
import { OpenAiApiActor } from "../../src/runtimes/openai/api-actor";
import { resolveInference } from "../../src/worker/inference";

// Minimal config for the brain-selection logic. defaultRuntime defaults to a
// non-codex runtime so the codex branch (which probes the real `codex` CLI) is
// skipped, keeping these tests deterministic and offline.
function makeConfig(
  opts: { environment?: string; defaultRuntime?: string } = {},
): ParamConfig {
  return {
    app: { environment: opts.environment ?? "development" },
    actor: { defaultRuntime: opts.defaultRuntime ?? "opencode" },
    runtimes: {},
  } as unknown as ParamConfig;
}

describe("resolveInference (brain selection)", () => {
  test("PARAM_ACTOR=mock -> deterministic MockActor", async () => {
    const r = await resolveInference(makeConfig(), { PARAM_ACTOR: "mock" });
    expect(r.inference.name).toBe("mock");
  });

  test("auto + OPENAI_API_KEY -> OpenAI API brain", async () => {
    const r = await resolveInference(makeConfig(), {
      OPENAI_API_KEY: "sk-test",
    });
    expect(r.inference.name).toBe("openai");
  });

  test("PARAM_ACTOR=openai without a key -> hard fail", async () => {
    await expect(
      resolveInference(makeConfig(), { PARAM_ACTOR: "openai" }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  test("auto + no brain + production -> hard fail (never silent mock)", async () => {
    await expect(
      resolveInference(makeConfig({ environment: "production" }), {}),
    ).rejects.toThrow(/no real Session Actor brain/);
  });

  test("auto + no brain + non-production -> MockActor", async () => {
    const r = await resolveInference(
      makeConfig({ environment: "development" }),
      {},
    );
    expect(r.inference.name).toBe("mock");
  });
});

describe("OpenAiApiActor", () => {
  test("isAvailable reflects the API key", () => {
    expect(new OpenAiApiActor({ apiKey: "" }).isAvailable()).toBe(false);
    expect(new OpenAiApiActor({ apiKey: "sk-x" }).isAvailable()).toBe(true);
  });
});
