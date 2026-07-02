import { defaultTelegramAuth, type TelegramMessage } from "eve/channels/telegram";
import {
  envFlag,
  isAllowedTelegramChatId,
  isAllowedTelegramPrivateUserId,
  isTrustedTelegramAuth,
  isTrustedTelegramReviewerForChat,
} from "./telegram-auth.js";

export type TelegramDispatchReason =
  | "private"
  | "command"
  | "mention"
  | "reply"
  | "ambient";

export interface TelegramPolicyDecision {
  readonly auth: ReturnType<typeof defaultTelegramAuth>;
  readonly context: readonly string[];
  readonly reason: TelegramDispatchReason;
}

function hasBody(message: TelegramMessage) {
  return Boolean((message.text || message.caption).trim() || message.attachments.length > 0);
}

function isGroup(chatType: TelegramMessage["chat"]["type"]) {
  return chatType === "group" || chatType === "supergroup";
}

function isBotCommand(text: string, botUsername: string | undefined) {
  const match = /^\/(?<command>[A-Za-z0-9_]+)(?:@(?<target>[A-Za-z0-9_]+))?(?:\s|$)/u.exec(text);
  if (!match) return false;

  const target = match.groups?.target;
  return target === undefined || target.toLowerCase() === botUsername?.toLowerCase();
}

function mentionsBot(text: string, botUsername: string | undefined) {
  return botUsername ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`) : false;
}

function isReplyToParam(message: TelegramMessage, botUsername: string | undefined) {
  const from = message.replyToMessage?.from;
  if (!from?.isBot) return false;

  const configuredBotId = process.env.TELEGRAM_BOT_ID?.trim();
  if (configuredBotId && from.id === configuredBotId) return true;

  return Boolean(
    botUsername
      && from.username
      && from.username.toLowerCase() === botUsername.toLowerCase(),
  );
}

function dispatchReason(message: TelegramMessage, botUsername: string | undefined): TelegramDispatchReason | null {
  if (message.chat.type === "private") return "private";

  const text = message.text || message.caption;
  if (isReplyToParam(message, botUsername)) return "reply";
  if (isBotCommand(text, botUsername)) return "command";
  if (mentionsBot(text, botUsername)) return "mention";

  const ambientGroups = envFlag("PARAM_TELEGRAM_AMBIENT_GROUP_MESSAGES");
  if (ambientGroups && isGroup(message.chat.type)) return "ambient";

  return null;
}

function isAllowedMessage(message: TelegramMessage) {
  if (message.chat.type === "private") {
    return isAllowedTelegramPrivateUserId(message.from?.id);
  }

  if (isGroup(message.chat.type)) {
    return isAllowedTelegramChatId(message.chat.id);
  }

  return false;
}

function isApprovalReplyText(message: TelegramMessage) {
  const text = (message.text || message.caption).trim().toLowerCase();
  return text === "approve" || text === "deny";
}

function isTrustedForTelegramMessage(message: TelegramMessage, auth: ReturnType<typeof defaultTelegramAuth>) {
  if (message.chat.type === "private") {
    return isTrustedTelegramAuth(auth);
  }

  if (isGroup(message.chat.type)) {
    return isTrustedTelegramReviewerForChat(message.from?.id, message.chat.id);
  }

  return false;
}

export function telegramPolicyDecision(
  message: TelegramMessage,
  botUsername: string | undefined,
): TelegramPolicyDecision | null {
  if (message.from?.isBot || message.chat.type === "channel" || !hasBody(message)) {
    return null;
  }

  if (!isAllowedMessage(message)) {
    return null;
  }

  const reason = dispatchReason(message, botUsername);
  if (!reason) {
    return null;
  }

  const auth = defaultTelegramAuth(message);
  if (!auth) {
    return null;
  }

  const senderIsTrusted = isTrustedForTelegramMessage(message, auth);
  if (isApprovalReplyText(message) && !senderIsTrusted) {
    return null;
  }

  const context = [
    "Telegram turn context:",
    `- dispatch reason: ${reason}`,
    `- chat id: ${message.chat.id}`,
    `- chat type: ${message.chat.type}`,
    message.chat.title ? `- chat title: ${message.chat.title}` : undefined,
    message.messageThreadId ? `- topic/thread id: ${message.messageThreadId}` : undefined,
    message.from?.id ? `- sender id: ${message.from.id}` : undefined,
    message.from?.username ? `- sender username: @${message.from.username}` : undefined,
    message.from?.firstName ? `- sender first name: ${message.from.firstName}` : undefined,
    `- sender is trusted: ${senderIsTrusted ? "yes" : "no"}`,
    reason === "ambient"
      ? "- this message did not directly address Param; staying quiet is often correct"
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return { auth, context, reason };
}
