import { describe, expect, test } from "bun:test";

import { checkStyle, passesStyle } from "../../src/actor/style-guard";
import { identityVoiceLayer, multiBubbleLayer } from "../../src/prompts/layers";
import { MockActor } from "../../src/actor/mock-actor";
import { runActorTurn, type ActorTurnInput } from "../../src/actor/runner";
import type {
  PlatformCapabilitySummary,
  PromptApprovalPolicy,
  StyleGuardPolicy,
} from "../../src/contracts/prompt";

// Strings a real friend would never text, that must be caught before delivery.
const ASSISTANT_LIKE = [
  "As an AI, I cannot do that.",
  "Certainly! How can I help you today?",
  "In summary, here are the key points",
  "Let me know if you need anything else!",
  "I'm here to assist with your request.",
  "**Important:** please review the following",
  "here is the plan — step one, step two",
  "it's not just a reminder, but a nudge",
  "## Heading\nbody text",
];

// Casual Param-voiced messages that must pass untouched.
const PARAM_VOICE = [
  "yo",
  "np",
  "lmao that's wild",
  "gotcha, on it",
  "brother i'm not nike",
  "idk man, seems sus",
  "ok bet",
];

describe("voice regression", () => {
  test("assistant/corporate/markdown/em-dash output is always flagged", () => {
    for (const bad of ASSISTANT_LIKE) {
      expect(checkStyle(bad).length).toBeGreaterThan(0);
    }
  });

  test("casual Param voice passes the style guard", () => {
    for (const good of PARAM_VOICE) {
      expect(passesStyle(good)).toBe(true);
    }
  });

  test("Param's own prompt layers contain no em-dash", () => {
    expect(identityVoiceLayer.includes("—")).toBe(false);
    expect(multiBubbleLayer.includes("—")).toBe(false);
  });
});

describe("mock actor never emits style-guard-failing visible output", () => {
  const platform: PlatformCapabilitySummary = {
    platform: "telegram",
    supportsText: true,
    supportsReactions: true,
    availableReactions: ["👍"],
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
    safeAutoRunTools: [],
  };

  const inputs = [
    "hey",
    "hello there",
    "thanks!!",
    "can you do the thing",
    "x".repeat(300),
    "STOP",
    "what's the weather",
    "😭😭😭",
    "",
  ];

  test("every delivered bubble passes the style guard", async () => {
    for (const text of inputs) {
      const input: ActorTurnInput = {
        actorRunId: "r",
        sessionId: "s",
        runType: "normal_chat",
        platformCapabilities: platform,
        styleGuard,
        approvalPolicy,
        knownEventIds: ["e1"],
        latest: { text, isDirectMessage: true, latestEventId: "e1" },
      };
      const res = await runActorTurn(new MockActor(), input);
      for (const message of res.visibleMessages) {
        expect(passesStyle(message.text)).toBe(true);
      }
    }
  });
});
