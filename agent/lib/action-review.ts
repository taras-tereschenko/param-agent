import type { TelegramChannelState } from "eve/channels/telegram";
import { trustedTelegramMentions } from "./telegram-auth.js";

interface ActionReviewRequest {
  readonly action?: {
    readonly input?: unknown;
    readonly kind?: string;
    readonly toolName?: string;
  };
  readonly display?: string;
  readonly options?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}

const TELEGRAM_APPROVAL_TEXT_MAX_LENGTH = 3900;

function isGroupChat(chatType: TelegramChannelState["chatType"]) {
  return chatType === "group" || chatType === "supergroup";
}

export function isApprovalRequest(request: ActionReviewRequest) {
  const optionIds = new Set(request.options?.map(option => option.id));
  return request.display === "confirmation" && optionIds.has("approve") && optionIds.has("deny");
}

function inputPreview(input: unknown) {
  if (!input || typeof input !== "object") return undefined;

  const json = JSON.stringify(input, null, 2);
  if (!json) return undefined;

  return json;
}

function tooLargeActionReviewText(input: {
  readonly request: ActionReviewRequest;
  readonly state: TelegramChannelState;
}) {
  const lines = ["action review"];

  if (input.request.action?.toolName) {
    lines.push(`tool: ${input.request.action.toolName}`);
  }

  if (input.state.triggeringUserId) {
    lines.push(`requested by: ${input.state.triggeringUserId}`);
  }

  lines.push(
    "",
    "proposal is too large to review exactly in one Telegram message",
    "approval buttons hidden so nobody approves partial context",
    "ask Param to split this into a smaller action",
  );

  return lines.join("\n");
}

export function formatActionReviewMessage(input: {
  readonly mentions?: readonly string[];
  readonly renderedText: string;
  readonly request: ActionReviewRequest;
  readonly state: TelegramChannelState;
}) {
  if (!isApprovalRequest(input.request)) {
    return {
      allowReplyMarkup: true,
      text: input.renderedText,
    };
  }

  const lines: string[] = [];
  const mentions = input.mentions
    ?? (isGroupChat(input.state.chatType) ? trustedTelegramMentions(input.state.chatId) : []);
  if (mentions.length > 0) {
    lines.push(mentions.join(" "));
    lines.push("");
  }

  lines.push("action review");

  if (input.request.action?.toolName) {
    lines.push(`tool: ${input.request.action.toolName}`);
  }

  if (input.state.triggeringUserId) {
    lines.push(`requested by: ${input.state.triggeringUserId}`);
  }

  const preview = inputPreview(input.request.action?.input);
  if (preview) {
    lines.push("");
    lines.push(preview);
  }

  lines.push("");
  lines.push(input.renderedText);

  const text = lines.join("\n");
  if (text.length <= TELEGRAM_APPROVAL_TEXT_MAX_LENGTH) {
    return {
      allowReplyMarkup: true,
      text,
    };
  }

  return {
    allowReplyMarkup: false,
    text: tooLargeActionReviewText(input),
  };
}

export function formatActionReviewText(input: Parameters<typeof formatActionReviewMessage>[0]) {
  return formatActionReviewMessage(input).text;
}
