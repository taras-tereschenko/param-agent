import { describe, expect, test } from "bun:test";

import {
  buildTelegramSessionRoute,
  deriveSessionKey,
  resolveTelegramRoute,
} from "../../src/orchestrator/session-resolver";
import {
  defaultBatchPolicy,
  isDirectlyAddressed,
  shouldFlushBatch,
  type BatchState,
} from "../../src/orchestrator/batching";
import {
  classifySteering,
  isHardControl,
  requiresImmediateInterrupt,
  requiresPreSendRefresh,
} from "../../src/orchestrator/steering";

describe("session-resolver", () => {
  test("deterministic keys per route type", () => {
    expect(
      deriveSessionKey({
        platform: "telegram",
        accountId: "main",
        routeType: "dm",
        platformUserId: "42",
      }),
    ).toBe("telegram:dm:main:42");
    expect(
      deriveSessionKey({
        platform: "telegram",
        accountId: "main",
        routeType: "group",
        platformChatId: "-100",
      }),
    ).toBe("telegram:group:main:-100");
    expect(
      deriveSessionKey({
        platform: "telegram",
        accountId: "main",
        routeType: "topic",
        platformChatId: "-100",
        messageThreadId: "7",
      }),
    ).toBe("telegram:topic:main:-100:7");
  });

  test("topic messages route separately from the parent group", () => {
    expect(resolveTelegramRoute("supergroup")).toBe("group");
    expect(resolveTelegramRoute("supergroup", "7")).toBe("topic");
    expect(resolveTelegramRoute("private")).toBe("dm");
  });

  test("buildTelegramSessionRoute wires key + route together", () => {
    const route = buildTelegramSessionRoute({
      accountId: "main",
      chatType: "supergroup",
      platformChatId: "-100",
      messageThreadId: "9",
    });
    expect(route.routeType).toBe("topic");
    expect(route.sessionKey).toBe("telegram:topic:main:-100:9");
  });

  test("missing required fields throw", () => {
    expect(() =>
      deriveSessionKey({
        platform: "telegram",
        accountId: "main",
        routeType: "dm",
      }),
    ).toThrow();
  });
});

describe("batching", () => {
  const base: BatchState = {
    pendingCount: 1,
    firstPendingAtMs: 0,
    lastPendingAtMs: 0,
  };

  test("empty buffer never flushes", () => {
    expect(
      shouldFlushBatch({ ...base, pendingCount: 0 }, defaultBatchPolicy, 999999)
        .flush,
    ).toBe(false);
  });

  test("directly-addressed messages flush after a short quiet gap", () => {
    const state: BatchState = {
      ...base,
      strongestTrigger: { isDirectMessage: true },
      lastPendingAtMs: 0,
    };
    // before direct debounce
    expect(shouldFlushBatch(state, defaultBatchPolicy, 500).flush).toBe(false);
    // after direct debounce
    const d = shouldFlushBatch(state, defaultBatchPolicy, 2000);
    expect(d.flush).toBe(true);
    expect(d.reason).toBe("quiet_gap");
  });

  test("ambient chatter waits longer than direct messages", () => {
    const ambient: BatchState = {
      ...base,
      strongestTrigger: { isDirectMessage: false },
    };
    // 2s gap: direct would flush, ambient should not
    expect(shouldFlushBatch(ambient, defaultBatchPolicy, 2000).flush).toBe(
      false,
    );
    expect(
      shouldFlushBatch(ambient, defaultBatchPolicy, 13000).flush,
    ).toBe(true);
  });

  test("max count forces a flush", () => {
    const busy: BatchState = { ...base, pendingCount: 999, lastPendingAtMs: 0 };
    expect(shouldFlushBatch(busy, defaultBatchPolicy, 1).reason).toBe(
      "max_count",
    );
  });

  test("isDirectlyAddressed covers mention/reply/dm/command", () => {
    expect(isDirectlyAddressed({ mentionsParam: true })).toBe(true);
    expect(isDirectlyAddressed({ repliesToParam: true })).toBe(true);
    expect(isDirectlyAddressed({})).toBe(false);
  });
});

describe("steering", () => {
  test("hard controls detected from text and approval responses", () => {
    expect(isHardControl({ text: "stop" })).toBe(true);
    expect(isHardControl({ text: "cancel that" })).toBe(true);
    expect(isHardControl({ text: "/approve" })).toBe(true);
    expect(isHardControl({ isApprovalResponse: true })).toBe(true);
    expect(isHardControl({ text: "lol ok" })).toBe(false);
  });

  test("strong steering for direct targeting", () => {
    expect(classifySteering({ mentionsParam: true }).priority).toBe("strong");
    expect(classifySteering({ senderIsTrusted: true }).priority).toBe(
      "strong",
    );
    expect(classifySteering({ text: "random chatter" }).priority).toBe("soft");
    expect(classifySteering({ text: "stop" }).priority).toBe("hard_control");
  });

  test("tags reflect signals", () => {
    const tags = classifySteering({
      mentionsParam: true,
      repliesToParam: true,
      senderIsTrusted: true,
    }).tags;
    expect(tags).toContain("mention");
    expect(tags).toContain("reply_to_param");
    expect(tags).toContain("trusted_sender");
  });

  test("pre-send refresh required for strong/hard steering only", () => {
    expect(
      requiresPreSendRefresh([{ priority: "soft", consumedAt: undefined }]),
    ).toBe(false);
    expect(
      requiresPreSendRefresh([{ priority: "strong", consumedAt: undefined }]),
    ).toBe(true);
    // consumed items don't trigger refresh
    expect(
      requiresPreSendRefresh([
        { priority: "hard_control", consumedAt: "2026-01-01T00:00:00.000Z" },
      ]),
    ).toBe(false);
  });

  test("immediate interrupt only for hard controls", () => {
    expect(
      requiresImmediateInterrupt([{ priority: "strong", consumedAt: undefined }]),
    ).toBe(false);
    expect(
      requiresImmediateInterrupt([
        { priority: "hard_control", consumedAt: undefined },
      ]),
    ).toBe(true);
  });
});
