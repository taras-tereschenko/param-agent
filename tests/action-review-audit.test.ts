import { describe, expect, test } from "bun:test";
import type { TelegramChannelState } from "eve/channels/telegram";
import {
  buildActionReviewRequestRecord,
  buildActionReviewResultUpdate,
  stableActionReviewHash,
} from "../agent/lib/db/action-review.ts";

const state = {
  botUsername: "param_bot",
  chatId: "-100",
  chatType: "supergroup",
  conversationId: "42",
  messageThreadId: 7,
  triggeringUserId: "111",
} as TelegramChannelState;

const ctx = {
  session: {
    auth: {
      current: {
        attributes: {},
        authenticator: "telegram",
        principalId: "telegram:111",
        principalType: "user",
      },
      initiator: null,
    },
    id: "session-1",
    turn: {
      id: "turn-1",
      sequence: 3,
    },
  },
};

describe("action review audit helpers", () => {
  test("hashes proposals stably", () => {
    const left = stableActionReviewHash({ a: { x: 1, y: 2 }, b: ["c"] });
    const right = stableActionReviewHash({ b: ["c"], a: { y: 2, x: 1 } });

    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });

  test("builds a request record from Eve and Telegram context", () => {
    const record = buildActionReviewRequestRecord({
      ctx,
      event: {
        sequence: 12,
        stepIndex: 2,
        turnId: "turn-1",
      },
      request: {
        action: {
          callId: "call-1",
          input: { path: "/workspace/.env" },
          kind: "tool-call",
          toolName: "read_file",
        },
        display: "confirmation",
        options: [
          { id: "approve", label: "Approve" },
          { id: "deny", label: "Deny" },
        ],
        prompt: "Approve read_file?",
        requestId: "request-1",
      },
      state,
    });

    expect(record).toMatchObject({
      actionKind: "tool-call",
      callId: "call-1",
      chatId: "-100",
      chatType: "supergroup",
      messageThreadId: "7",
      requesterPrincipalId: "telegram:111",
      requesterTelegramUserId: "111",
      requestId: "request-1",
      sessionId: "session-1",
      status: "requested",
      toolName: "read_file",
      turnId: "turn-1",
    });
    expect(record.proposalHash).toHaveLength(64);
    expect(record.proposal).toMatchObject({
      action: {
        callId: "call-1",
        input: { path: "/workspace/.env" },
      },
      channel: {
        chatId: "-100",
        triggeringUserId: "111",
      },
    });
  });

  test("builds a rejected result update", () => {
    const now = new Date("2026-01-02T03:04:05.000Z");
    const update = buildActionReviewResultUpdate({
      ctx,
      event: {
        result: {
          callId: "call-1",
          kind: "tool-result",
          output: "denied",
          toolName: "read_file",
        },
        status: "rejected",
      },
      now,
    });

    expect(update).toMatchObject({
      approverPrincipalId: "telegram:111",
      approverTelegramUserId: "111",
      resultStatus: "rejected",
      status: "rejected",
    });
    expect(update.resolvedAt).toBe(now);
    expect(update.result).toMatchObject({
      callId: "call-1",
      output: "denied",
      toolName: "read_file",
    });
  });

  test("falls back to Telegram callback state for approver identity", () => {
    const update = buildActionReviewResultUpdate({
      ctx: {
        session: {
          auth: {
            current: null,
            initiator: null,
          },
          id: "session-1",
        },
      },
      event: {
        result: {
          callId: "call-1",
          kind: "tool-result",
          output: "ok",
          toolName: "read_file",
        },
        status: "completed",
      },
      state,
    });

    expect(update).toMatchObject({
      approverPrincipalId: "telegram:111",
      approverPrincipalType: "user",
      approverTelegramUserId: "111",
    });
  });
});
