import { describe, expect, test } from "bun:test";

import { MockActor } from "../../src/actor/mock-actor";
import { runActorTurn, type ActorTurnInput } from "../../src/actor/runner";
import {
  applyStyleFixes,
  checkStyle,
  guardVisibleText,
  passesStyle,
} from "../../src/actor/style-guard";
import { parseActorOutputs } from "../../src/actor/output-parser";
import { validateActorOutputs } from "../../src/actor/output-validator";
import { buildContext } from "../../src/actor/context-builder";
import type {
  PlatformCapabilitySummary,
  PromptApprovalPolicy,
  StyleGuardPolicy,
} from "../../src/contracts/prompt";

const platform: PlatformCapabilitySummary = {
  platform: "telegram",
  supportsText: true,
  supportsReactions: true,
  availableReactions: ["👍", "🔥"],
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

function baseInput(overrides: Partial<ActorTurnInput>): ActorTurnInput {
  return {
    actorRunId: "run-1",
    sessionId: "sess-1",
    runType: "normal_chat",
    platformCapabilities: platform,
    styleGuard,
    approvalPolicy,
    knownEventIds: ["e1"],
    ...overrides,
  };
}

describe("style guard", () => {
  test("flags markdown bold, em-dash, banned phrase, contrastive structure", () => {
    expect(checkStyle("**hello**").some((v) => v.code === "markdown_bold")).toBe(
      true,
    );
    expect(checkStyle("a — b").some((v) => v.code === "em_dash")).toBe(true);
    expect(
      checkStyle("how can i help you today").some(
        (v) => v.code === "banned_phrase",
      ),
    ).toBe(true);
    expect(
      checkStyle("it's not just a reminder, but a nudge").some(
        (v) => v.code === "contrastive_structure",
      ),
    ).toBe(true);
  });

  test("accepts casual lowercase slang without flagging", () => {
    expect(passesStyle("yo lmao that's wild")).toBe(true);
    expect(passesStyle("np")).toBe(true);
  });

  test("applyStyleFixes removes em-dash, bold, and trailing period", () => {
    expect(applyStyleFixes("**hi** there")).toBe("hi there");
    expect(applyStyleFixes("ok fine.")).toBe("ok fine");
    expect(applyStyleFixes("a — b").includes("—")).toBe(false);
  });

  test("naked url is flagged and rewritten into a markdown link", () => {
    const bad = "check https://example.com/x";
    expect(checkStyle(bad).some((v) => v.code === "naked_url")).toBe(true);
    const guarded = guardVisibleText(bad, { rewriteOnFailure: true });
    expect(guarded.text.includes("[link](https://example.com/x)")).toBe(true);
  });
});

describe("output parser", () => {
  test("parses fenced JSON array of drafts", () => {
    const raw = '```json\n[{"type":"no_reply","payload":{"reason":"nothing_to_add"}},{"type":"done","payload":{"status":"completed"}}]\n```';
    const { drafts, errors } = parseActorOutputs(raw);
    expect(errors).toHaveLength(0);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.type).toBe("no_reply");
  });

  test("collects errors for malformed items but keeps valid ones", () => {
    const { drafts, errors } = parseActorOutputs([
      { type: "message", payload: { text: "hey" } },
      { type: "not_a_type", payload: {} },
    ]);
    expect(drafts).toHaveLength(1);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("output validator", () => {
  test("rejects disallowed output types and enforces the visible cap", () => {
    const res = validateActorOutputs(
      [
        { type: "message", payload: { text: "a", parseMode: "plain", style: "param_chat", visible: true } },
        { type: "message", payload: { text: "b", parseMode: "plain", style: "param_chat", visible: true } },
        { type: "tool_call", payload: { toolCallId: "t", toolName: "x", input: {}, reason: "r" } },
      ],
      { allowedOutputs: ["message", "done"], maxVisibleMessages: 1 },
    );
    // second message over cap + tool_call not allowed => 2 rejected
    expect(res.rejected.length).toBe(2);
    expect(res.accepted.length).toBe(1);
  });

  test("rejects reactions not in the available set", () => {
    const res = validateActorOutputs(
      [
        {
          type: "react_to_message",
          payload: { targetEventId: "e1", emoji: "🎉" },
        },
      ],
      {
        allowedOutputs: ["react_to_message"],
        maxVisibleMessages: 6,
        sessionKnownEventIds: new Set(["e1"]),
        availableReactions: ["👍"],
      },
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(1);
  });
});

describe("context builder", () => {
  test("extracts the latest inbound message and known event ids", () => {
    const ctx = buildContext([
      {
        id: "e1",
        type: "chat.message.received",
        source: { kind: "user", displayName: "sam" },
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { text: "hey", mechanical: { isDirectMessage: true } },
      },
    ]);
    expect(ctx.latest?.text).toBe("hey");
    expect(ctx.latest?.isDirectMessage).toBe(true);
    expect(ctx.knownEventIds).toEqual(["e1"]);
    expect(ctx.sessionContextText.includes("sam: hey")).toBe(true);
  });
});

describe("mock actor + runner", () => {
  test("greeting gets a short greeting, not a briefing", async () => {
    const res = await runActorTurn(
      new MockActor(),
      baseInput({ latest: { text: "hey", isDirectMessage: true, latestEventId: "e1" } }),
    );
    expect(res.visibleMessages).toHaveLength(1);
    expect(res.visibleMessages[0]?.text).toBe("yo");
    expect(res.stayedQuiet).toBe(false);
    // every run ends with done
    expect(res.drafts.some((d) => d.type === "done")).toBe(true);
  });

  test("stays quiet in a busy group when not addressed", async () => {
    const res = await runActorTurn(
      new MockActor(),
      baseInput({
        latest: {
          text: "just chatting",
          isGroupMessage: true,
          mentionsParam: false,
          latestEventId: "e1",
        },
      }),
    );
    expect(res.stayedQuiet).toBe(true);
    expect(res.visibleMessages).toHaveLength(0);
  });

  test("long prompt produces multiple bubbles (multi-message behavior)", async () => {
    const res = await runActorTurn(
      new MockActor(),
      baseInput({
        latest: {
          text: "x".repeat(200),
          isDirectMessage: true,
          latestEventId: "e1",
        },
      }),
    );
    expect(res.visibleMessages.length).toBeGreaterThan(1);
  });

  test("hard-control steering drops stale visible output (stale guard)", async () => {
    const res = await runActorTurn(
      new MockActor(),
      baseInput({
        latest: { text: "hey", isDirectMessage: true, latestEventId: "e1" },
        steering: [{ priority: "hard_control", text: "stop" }],
      }),
    );
    expect(res.interrupted).toBe(true);
    expect(res.visibleMessages).toHaveLength(0);
    expect(res.stayedQuiet).toBe(true);
  });

  test("strong steering requests a pre-send refresh", async () => {
    const res = await runActorTurn(
      new MockActor(),
      baseInput({
        latest: { text: "hey", isDirectMessage: true, latestEventId: "e1" },
        steering: [{ priority: "strong", text: "actually wait" }],
      }),
    );
    expect(res.preSendRefreshRequired).toBe(true);
  });

  test("memory_review run is internal and never speaks", async () => {
    const res = await runActorTurn(
      new MockActor(),
      baseInput({ runType: "memory_review" }),
    );
    expect(res.visibleMessages).toHaveLength(0);
    expect(res.drafts.some((d) => d.type === "run_summary")).toBe(true);
  });
});
