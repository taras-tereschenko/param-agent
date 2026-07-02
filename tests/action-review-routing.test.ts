import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TelegramChannelState } from "eve/channels/telegram";
import {
  actionReviewRouteForTelegram,
  formatDmActionReviewNotificationText,
  formatDmFallbackNotice,
} from "../agent/lib/action-review-routing.ts";

const OLD_ENV = { ...process.env };

function groupState(chatId = "-100"): TelegramChannelState {
  return {
    botUsername: "param_bot",
    chatId,
    chatType: "supergroup",
    conversationId: "42",
    messageThreadId: null,
    triggeringUserId: "222",
  };
}

beforeEach(() => {
  process.env = { ...OLD_ENV };
  process.env.PARAM_ALLOWED_TELEGRAM_USER_IDS = "111,333";
  process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS = "111,333";
  process.env.PARAM_TRUSTED_TELEGRAM_MENTIONS = "@owner,@backup";
  process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS_BY_CHAT = "";
  process.env.PARAM_TRUSTED_TELEGRAM_MENTIONS_BY_CHAT = "";
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("action review routing", () => {
  test("routes group approvals to configured chat reviewers", () => {
    process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS_BY_CHAT = JSON.stringify({
      "-100": ["111"],
    });
    process.env.PARAM_TRUSTED_TELEGRAM_MENTIONS_BY_CHAT = JSON.stringify({
      "-100": ["@owner"],
    });

    expect(actionReviewRouteForTelegram(groupState())).toEqual({
      kind: "chat",
      mentions: ["@owner"],
      notifyReviewerTelegramUserIds: [],
      reviewerTelegramUserIds: ["111"],
    });
  });

  test("does not fall back to global mentions for chat-specific reviewers", () => {
    process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS_BY_CHAT = JSON.stringify({
      "-100": ["111"],
    });

    expect(actionReviewRouteForTelegram(groupState())).toEqual({
      kind: "chat",
      mentions: [],
      notifyReviewerTelegramUserIds: [],
      reviewerTelegramUserIds: ["111"],
    });
  });

  test("falls back to global trusted reviewer DM notifications when group has no chat reviewers", () => {
    expect(actionReviewRouteForTelegram(groupState())).toEqual({
      kind: "dm-notify",
      notifyReviewerTelegramUserIds: ["111", "333"],
    });
  });

  test("keeps private approvals in the same chat", () => {
    expect(
      actionReviewRouteForTelegram({
        ...groupState("111"),
        chatType: "private",
      }),
    ).toEqual({
      kind: "chat",
      mentions: [],
      notifyReviewerTelegramUserIds: [],
      reviewerTelegramUserIds: [],
    });
  });

  test("renders DM notification text without moving the approval", () => {
    expect(
      formatDmActionReviewNotificationText({
        reviewText: "action review",
        state: groupState(),
      }),
    ).toContain("approve or deny in the original chat");
  });

  test("renders a group notice after DM notification fallback", () => {
    expect(
      formatDmFallbackNotice({
        deliveredCount: 1,
        reviewerCount: 2,
      }),
    ).toBe("notified 1/2 trusted reviewers by dm\napproval still stays in this chat");
  });
});
