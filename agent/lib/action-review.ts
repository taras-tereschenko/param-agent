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

  return json.length > 900 ? `${json.slice(0, 900)}...` : json;
}

export function formatActionReviewText(input: {
  readonly renderedText: string;
  readonly request: ActionReviewRequest;
  readonly state: TelegramChannelState;
}) {
  if (!isApprovalRequest(input.request)) {
    return input.renderedText;
  }

  const lines: string[] = [];
  const mentions = isGroupChat(input.state.chatType) ? trustedTelegramMentions() : [];
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

  return lines.join("\n");
}
