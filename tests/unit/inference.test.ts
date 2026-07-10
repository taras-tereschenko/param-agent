import { describe, expect, test } from "bun:test";

import { actorOutputDraftSchema } from "../../src/contracts/actor-output";
import type { ParamConfig } from "../../src/config/schema";
import {
  type ModelOutput,
  OpenAiApiActor,
  toDraft,
} from "../../src/runtimes/openai/api-actor";
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

  test("every model output maps to a schema-valid actor draft", () => {
    const samples: ModelOutput[] = [
      { type: "message", text: "hey" },
      { type: "react_to_message", targetEventId: "e1", emoji: "👍" },
      { type: "no_reply", reason: "nothing_to_add" },
      {
        type: "tool_call",
        toolName: "system.time",
        input: { tz: "UTC" },
        reason: "check the time",
      },
      { type: "spawn_task_agent", taskType: "research", goal: "look it up" },
      {
        type: "memory_candidate",
        operation: "create",
        scope: "user",
        text: "prefers tea",
        confidence: 0.8,
        sensitivity: "low",
        provenanceNote: "said so in chat",
      },
      { type: "run_summary", summary: "chatted", decisions: ["said hi"] },
      { type: "done", status: "completed" },
    ];
    for (const sample of samples) {
      const draft = toDraft(sample);
      expect(() => actorOutputDraftSchema.parse(draft)).not.toThrow();
    }
  });
});
