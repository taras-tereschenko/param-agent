import type { TelegramChannelState, TelegramHandle } from "eve/channels/telegram";
import {
  isAllowedTelegramPrivateUserId,
  trustedTelegramMentionsForChat,
  trustedTelegramUserIds,
  trustedTelegramUserIdsForChat,
} from "./telegram-auth.js";

export type ActionReviewRoute =
  | {
      readonly kind: "chat";
      readonly mentions: readonly string[];
      readonly notifyReviewerTelegramUserIds: readonly string[];
      readonly reviewerTelegramUserIds: readonly string[];
    }
  | {
      readonly kind: "dm-notify";
      readonly notifyReviewerTelegramUserIds: readonly string[];
    };

export function actionReviewRouteForTelegram(state: TelegramChannelState): ActionReviewRoute {
  if (!isGroupChat(state.chatType)) {
    return {
      kind: "chat",
      mentions: [],
      notifyReviewerTelegramUserIds: [],
      reviewerTelegramUserIds: [],
    };
  }

  const chatReviewerIds = trustedTelegramUserIdsForChat(state.chatId);
  if (chatReviewerIds.length > 0) {
    return {
      kind: "chat",
      mentions: trustedTelegramMentionsForChat(state.chatId),
      notifyReviewerTelegramUserIds: [],
      reviewerTelegramUserIds: chatReviewerIds,
    };
  }

  return {
    kind: "dm-notify",
    notifyReviewerTelegramUserIds: trustedTelegramUserIds().filter(isAllowedTelegramPrivateUserId),
  };
}

export function formatDmActionReviewNotificationText(input: {
  readonly reviewText: string;
  readonly state: TelegramChannelState;
}) {
  const lines = [
    `action review in ${input.state.chatType ?? "telegram"} ${input.state.chatId ?? "unknown"}`,
  ];

  if (input.state.messageThreadId !== null) {
    lines.push(`topic: ${input.state.messageThreadId}`);
  }

  lines.push(
    "",
    "heads up, this group has no chat-specific reviewer configured",
    "approve or deny in the original chat if you can access it",
    "",
    input.reviewText,
  );

  return lines.join("\n");
}

export function formatDmFallbackNotice(input: {
  readonly deliveredCount: number;
  readonly reviewerCount: number;
}) {
  const status =
    input.deliveredCount > 0
      ? `notified ${input.deliveredCount}/${input.reviewerCount} trusted reviewers by dm`
      : "could not dm trusted reviewers";

  return `${status}\napproval still stays in this chat`;
}

export async function sendDmActionReviewNotifications(input: {
  readonly reviewText: string;
  readonly reviewerTelegramUserIds: readonly string[];
  readonly state: TelegramChannelState;
  readonly telegram: TelegramHandle;
}) {
  const text = formatDmActionReviewNotificationText({
    reviewText: input.reviewText,
    state: input.state,
  });
  let deliveredCount = 0;

  for (const reviewerId of input.reviewerTelegramUserIds) {
    try {
      await input.telegram.request("sendMessage", {
        chat_id: reviewerId,
        text,
      });
      deliveredCount += 1;
    } catch (error) {
      console.error("failed to send action review dm notification", { error, reviewerId });
    }
  }

  return deliveredCount;
}

function isGroupChat(chatType: TelegramChannelState["chatType"]) {
  return chatType === "group" || chatType === "supergroup";
}
