import { describe, expect, test } from "bun:test";

import type { ActorInferenceRequest } from "../../src/actor/inference";
import type { PromptPacket } from "../../src/contracts/prompt";
import { ParamError } from "../../src/shared/errors";
import { defaultCapabilities, type CommandProbe } from "../../src/runtimes/base";
import {
  buildRuntimeFrame,
  redactEnvForRuntime,
} from "../../src/runtimes/capabilities";
import { CodexAdapter } from "../../src/runtimes/codex/adapter";
import { CodexChatBrain } from "../../src/runtimes/codex/chat-brain";
import {
  CodexCliActor,
  extractOutputArray,
  type CliRunner,
} from "../../src/runtimes/codex/cli-actor";
import { OpenCodeAdapter } from "../../src/runtimes/opencode/adapter";
import { AntigravityAdapter } from "../../src/runtimes/antigravity/adapter";
import { RuntimeRegistry } from "../../src/runtimes/registry";

/** A fake process probe so no real command is ever spawned in tests. */
function fakeProbe(result: {
  ok: boolean;
  stdout?: string;
  exitCode?: number;
}): CommandProbe {
  return async () => ({
    ok: result.ok,
    stdout: result.stdout ?? "",
    exitCode: result.exitCode ?? (result.ok ? 0 : 127),
  });
}

describe("defaultCapabilities", () => {
  test("everything is false except supportsOutputBuffering", () => {
    const caps = defaultCapabilities("codex");
    expect(caps.runtime).toBe("codex");
    expect(caps.supportsOutputBuffering).toBe(true);
    expect(caps.supportsLiveSteering).toBe(false);
    expect(caps.supportsCancel).toBe(false);
    expect(caps.supportsCheckpointRefresh).toBe(false);
    expect(caps.supportsToolInterception).toBe(false);
    expect(caps.supportsArtifacts).toBe(false);
    expect(caps.supportsUsage).toBe(false);
  });
});

describe("CodexAdapter direct-cli availability", () => {
  test("missing command -> unavailable with a reason", async () => {
    const adapter = new CodexAdapter({
      probe: fakeProbe({ ok: false, exitCode: 127 }),
    });
    const availability = await adapter.checkAvailability();
    expect(availability.available).toBe(false);
    expect(availability.reason.length).toBeGreaterThan(0);
    expect(availability.version).toBeUndefined();
  });

  test("present command -> available with version", async () => {
    const adapter = new CodexAdapter({
      probe: fakeProbe({ ok: true, stdout: "codex 1.2.3\n" }),
    });
    const availability = await adapter.checkAvailability();
    expect(availability.available).toBe(true);
    expect(availability.version).toBe("codex 1.2.3");
  });
});

describe("CodexAdapter ai-sdk-harness proof gate", () => {
  test("probeHarness degrades safely: available:false, non-empty reason, never throws", async () => {
    const adapter = new CodexAdapter({ adapter: "ai-sdk-harness" });
    const result = await adapter.probeHarness();
    // Document the observed blocker reason for this environment.
    console.log("[codex harness blocker] reason =>", result.reason);
    expect(result.available).toBe(false);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);

    // checkAvailability routes to probeHarness for the harness mode and must
    // also degrade to unavailable without throwing.
    const viaCheck = await adapter.checkAvailability();
    expect(viaCheck.available).toBe(false);
  });
});

describe("CodexChatBrain honest fallback", () => {
  test("run() throws runtime_unavailable when unavailable and never fabricates drafts", async () => {
    const brain = new CodexChatBrain({ probe: fakeProbe({ ok: false }) });
    expect(await brain.isAvailable()).toBe(false);

    const request: ActorInferenceRequest = {
      promptPacket: {} as PromptPacket,
      renderedPrompt: "hey",
      runType: "normal_chat",
      allowedOutputs: ["message", "done"],
    };

    let thrown: unknown;
    try {
      await brain.run(request);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ParamError);
    expect((thrown as ParamError).code).toBe("runtime_unavailable");
    expect(
      (thrown as ParamError).message.includes("codex chat-brain unavailable"),
    ).toBe(true);
  });

  test("isAvailable() is false even when the codex binary probes available (run() unimplemented)", async () => {
    // The binary being present must NOT make resolveInference select this brain,
    // since run() always throws — that would fail every turn. Report unusable.
    const brain = new CodexChatBrain({ probe: fakeProbe({ ok: true }) });
    expect(await brain.isAvailable()).toBe(false);
  });
});

describe("CodexCliActor output handling", () => {
  test("extractOutputArray pulls the JSON array out of surrounding prose", () => {
    expect(
      extractOutputArray('here you go:\n[{"type":"done","payload":{}}]\ncheers'),
    ).toBe('[{"type":"done","payload":{}}]');
    expect(extractOutputArray('[{"type":"done"}]')).toBe('[{"type":"done"}]');
  });

  test("run() returns the message even when codex wraps the JSON in prose", async () => {
    const runner: CliRunner = async () => ({
      stdout:
        'Thinking...\n[{"type":"message","payload":{"text":"hey, around!"}},{"type":"done","payload":{"status":"completed"}}]\nDone.',
      stderr: "",
      exitCode: 0,
    });
    const actor = new CodexCliActor({ runner });
    const res = await actor.run({
      renderedPrompt: "hi",
      promptPacket: {} as PromptPacket,
      runType: "normal_chat",
      allowedOutputs: ["message", "done"],
    } as unknown as ActorInferenceRequest);
    const msg = res.drafts.find((d) => d.type === "message");
    expect(msg && msg.type === "message" ? msg.payload.text : "").toBe(
      "hey, around!",
    );
  });
});

describe("buildRuntimeFrame", () => {
  test("overrides generic persona and does not instruct the runtime to ignore safety", () => {
    const frame = buildRuntimeFrame({ runtime: "codex", overridePersona: true });
    expect(frame.toLowerCase().includes("helpful assistant")).toBe(true);
    expect(frame.toLowerCase().includes("useful assistant")).toBe(true);
    expect(frame.toLowerCase().includes("override")).toBe(true);
    expect(frame.includes("Param")).toBe(true);
    // Must NOT tell the runtime to disregard real system/safety/tool rules.
    expect(frame.toLowerCase().includes("ignore")).toBe(false);
  });
});

describe("redactEnvForRuntime", () => {
  test("strips TOKEN/SECRET/KEY/PASSWORD keys and listed secretKeys", () => {
    const redacted = redactEnvForRuntime(
      {
        API_TOKEN: "t",
        MY_SECRET: "s",
        OPENAI_API_KEY: "k",
        DB_PASSWORD: "p",
        CUSTOM_CRED: "c",
        SAFE_VALUE: "ok",
        REGION: "us",
      },
      ["CUSTOM_CRED"],
    );
    expect(redacted.SAFE_VALUE).toBe("ok");
    expect(redacted.REGION).toBe("us");
    expect("API_TOKEN" in redacted).toBe(false);
    expect("MY_SECRET" in redacted).toBe(false);
    expect("OPENAI_API_KEY" in redacted).toBe(false);
    expect("DB_PASSWORD" in redacted).toBe(false);
    expect("CUSTOM_CRED" in redacted).toBe(false);
  });
});

describe("RuntimeRegistry.availabilityReport", () => {
  test("aggregates registered adapters using fake probes", async () => {
    const registry = new RuntimeRegistry();
    registry
      .register(new CodexAdapter({ probe: fakeProbe({ ok: true, stdout: "codex 9" }) }))
      .register(new OpenCodeAdapter({ probe: fakeProbe({ ok: false }) }))
      .register(new AntigravityAdapter({ probe: fakeProbe({ ok: false }) }));

    const report = await registry.availabilityReport();
    expect(Object.keys(report).sort()).toEqual([
      "antigravity",
      "codex",
      "opencode",
    ]);
    expect(report.codex?.available).toBe(true);
    expect(report.opencode?.available).toBe(false);
    expect(report.antigravity?.available).toBe(false);
    expect(registry.get("codex")?.runtime).toBe("codex");
    expect(registry.list()).toHaveLength(3);
  });
});

describe("OpenCode / Antigravity adapters", () => {
  test("report unavailable (no throw) when the CLI is missing", async () => {
    const opencode = await new OpenCodeAdapter({
      probe: fakeProbe({ ok: false, exitCode: 127 }),
    }).checkAvailability();
    expect(opencode.available).toBe(false);
    expect(opencode.reason.length).toBeGreaterThan(0);

    const antigravity = await new AntigravityAdapter({
      probe: fakeProbe({ ok: false, exitCode: 127 }),
    }).checkAvailability();
    expect(antigravity.available).toBe(false);
    expect(antigravity.reason.length).toBeGreaterThan(0);
  });
});
