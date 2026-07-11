import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  compilePromptPacket,
  humanTextAgentPrompt,
  HUMAN_TEXT_AGENT_LAYER_ID,
  renderPromptPacket,
  verbatimLayerIndex,
} from "../../src/prompts";
import type {
  PlatformCapabilitySummary,
  PromptApprovalPolicy,
  StyleGuardPolicy,
} from "../../src/contracts/prompt";

const promptFile = readFileSync(
  new URL("../../src/prompts/human-text-agent-prompt.txt", import.meta.url),
  "utf8",
);

const platform: PlatformCapabilitySummary = {
  platform: "telegram",
  supportsText: true,
  supportsReactions: true,
  availableReactions: ["👍", "🔥", "😭"],
  supportsReplies: true,
  supportsFiles: true,
  supportsInlineButtons: true,
  supportsRichMessage: true,
  supportsMiniApps: false,
};

const styleGuard: StyleGuardPolicy = {
  version: "style_guard:param_chat_v1",
  enabled: true,
  rewriteOnFailure: true,
  maxVisibleMessagesPerRun: 6,
};

const approvalPolicy: PromptApprovalPolicy = {
  requireApprovalForConsequential: true,
  safeAutoRunTools: ["system.health"],
};

function compileNormal(runtimeFrame?: string) {
  return compilePromptPacket({
    actorRunId: "run-1",
    sessionId: "sess-1",
    runType: "normal_chat",
    runtimeFrame,
    platformCapabilities: platform,
    styleGuard,
    approvalPolicy,
    memoryContextText: "",
    contextRefs: { eventIds: [], memoryIds: [] },
  });
}

describe("verbatim human text agent prompt", () => {
  test("loaded content matches the committed file byte-for-byte", () => {
    expect(humanTextAgentPrompt).toBe(promptFile);
  });

  test("compiler includes the base prompt verbatim and unmodified", () => {
    const packet = compileNormal();
    const layer = packet.layers.find(
      (l) => l.id === HUMAN_TEXT_AGENT_LAYER_ID,
    );
    expect(layer).toBeDefined();
    expect(layer?.verbatim).toBe(true);
    expect(layer?.content).toBe(humanTextAgentPrompt);
  });

  test("rendered prompt contains the base prompt verbatim as a substring", () => {
    const rendered = renderPromptPacket(compileNormal("runtime frame here"));
    expect(rendered.includes(humanTextAgentPrompt)).toBe(true);
  });

  test("base prompt comes after the runtime frame and before Param additions", () => {
    const packet = compileNormal("RUNTIME FRAME");
    const baseIndex = verbatimLayerIndex(packet);
    const frameIndex = packet.layers.findIndex(
      (l) => l.id === "runtime_adapter_frame",
    );
    const identityIndex = packet.layers.findIndex(
      (l) => l.id === "param_identity_voice",
    );
    expect(frameIndex).toBe(0);
    expect(baseIndex).toBe(1);
    expect(identityIndex).toBeGreaterThan(baseIndex);
  });

  test("no non-verbatim layer alters the base text (no bold/em-dash injected)", () => {
    const packet = compileNormal();
    const nonBase = packet.layers.filter(
      (l) => l.id !== HUMAN_TEXT_AGENT_LAYER_ID,
    );
    // The base prompt should never be duplicated or paraphrased into another layer.
    for (const layer of nonBase) {
      expect(layer.content).not.toBe(humanTextAgentPrompt);
    }
  });
});

describe("run contracts", () => {
  test("memory_review and compaction are non-visible (no style guard layer)", () => {
    const packet = compilePromptPacket({
      actorRunId: "r",
      sessionId: "s",
      runType: "memory_review",
      platformCapabilities: platform,
      styleGuard,
      approvalPolicy,
      contextRefs: { eventIds: [], memoryIds: [] },
    });
    expect(packet.layers.some((l) => l.id === "style_guard")).toBe(false);
    expect(packet.layers.some((l) => l.id === "param_identity_voice")).toBe(
      false,
    );
    expect(packet.allowedOutputs).toEqual([
      "memory_candidate",
      "run_summary",
      "done",
    ]);
  });

  test("allowedOutputs override is respected (ambient wake)", () => {
    const packet = compilePromptPacket({
      actorRunId: "r",
      sessionId: "s",
      runType: "ambient_wake",
      platformCapabilities: platform,
      styleGuard,
      approvalPolicy,
      allowedOutputs: ["no_reply", "done"],
      contextRefs: { eventIds: [], memoryIds: [] },
    });
    expect(packet.allowedOutputs).toEqual(["no_reply", "done"]);
  });
});

describe("skill context layer", () => {
  test("injects a trust-gated skill layer between session and memory context", () => {
    const packet = compilePromptPacket({
      actorRunId: "r",
      sessionId: "s",
      runType: "normal_chat",
      platformCapabilities: platform,
      styleGuard,
      approvalPolicy,
      sessionContextText: "recent chat",
      skillContextText: "Relevant skills:\n- deploy: how to ship",
      memoryContextText: "",
      contextRefs: { eventIds: [], memoryIds: [] },
    });
    const skill = packet.layers.find((l) => l.id === "skill_context");
    expect(skill).toBeDefined();
    expect(skill?.content).toContain("deploy: how to ship");
    // Trust reminder is always attached so a skill can't read as a grant.
    expect(skill?.content).toContain("Action Review");
    const sessionIdx = packet.layers.findIndex((l) => l.id === "session_context");
    const skillIdx = packet.layers.findIndex((l) => l.id === "skill_context");
    const memoryIdx = packet.layers.findIndex((l) => l.id === "memory_context");
    expect(skillIdx).toBeGreaterThan(sessionIdx);
    expect(memoryIdx).toBeGreaterThan(skillIdx);
  });

  test("omits the skill layer when no relevant skills apply", () => {
    const packet = compilePromptPacket({
      actorRunId: "r",
      sessionId: "s",
      runType: "normal_chat",
      platformCapabilities: platform,
      styleGuard,
      approvalPolicy,
      skillContextText: "",
      memoryContextText: "",
      contextRefs: { eventIds: [], memoryIds: [] },
    });
    expect(packet.layers.some((l) => l.id === "skill_context")).toBe(false);
  });
});
