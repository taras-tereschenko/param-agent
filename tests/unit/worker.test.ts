import { describe, expect, test } from "bun:test";

import { resolveInference } from "../../src/worker/inference";
import {
  approvalPolicyFromConfig,
  styleGuardFromConfig,
  telegramCapabilities,
  memoryRetrievalContextFromSession,
} from "../../src/worker/context";
import baseConfig from "../../param.config";

describe("worker inference resolution", () => {
  test("PARAM_ACTOR=mock selects the deterministic MockActor", async () => {
    // Real brain is the default; the mock is opt-in only (never a silent
    // fallback). Full selection matrix is covered in inference.test.ts.
    const { inference } = await resolveInference(baseConfig, {
      PARAM_ACTOR: "mock",
    });
    expect(inference.name).toBe("mock");
    expect(inference.isAvailable()).toBe(true);
  });
});

describe("worker context helpers", () => {
  test("style guard + approval policy derive from config", () => {
    const sg = styleGuardFromConfig(baseConfig);
    expect(sg.maxVisibleMessagesPerRun).toBe(
      baseConfig.actor.maxVisibleMessagesPerRun,
    );
    const ap = approvalPolicyFromConfig(baseConfig);
    expect(ap.requireApprovalForConsequential).toBe(true);
  });

  test("telegram capabilities describe the channel", () => {
    const caps = telegramCapabilities(["👍"]);
    expect(caps.platform).toBe("telegram");
    expect(caps.supportsReactions).toBe(true);
    expect(caps.availableReactions).toEqual(["👍"]);
  });

  test("memory retrieval context is scope-safe per route", () => {
    const dm = memoryRetrievalContextFromSession(
      { id: "s1", routeType: "dm", platformChatId: "42" },
      "U1",
    );
    expect(dm.paramUserId).toBe("U1");
    expect(dm.groupChatId).toBeUndefined();

    const group = memoryRetrievalContextFromSession({
      id: "s2",
      routeType: "group",
      platformChatId: "-100",
    });
    expect(group.groupChatId).toBe("-100");
    expect(group.paramUserId).toBeUndefined();
  });
});
