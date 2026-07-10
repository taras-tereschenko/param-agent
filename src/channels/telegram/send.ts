/**
 * Outbound send shaping (pure) + a thin sender that delivers via a transport.
 *
 * Param sends *plain text*; `parse_mode` is intentionally omitted. Rich
 * formatting is produced elsewhere (render_ui) and is not this seam's concern.
 */

import type { TelegramTransport } from "./transport";

export type SendTarget = {
  chatId: string;
  messageThreadId?: string;
  replyToPlatformMessageId?: string;
};

export type BuiltSendMessageParams = {
  chat_id: string;
  text: string;
  message_thread_id?: string;
  reply_parameters?: { message_id: number };
};

/** Telegram rejects sendMessage over 4096 chars with HTTP 400. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return text;
  }
  return `${text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 1)}…`;
}

export function buildSendMessageParams(
  text: string,
  target: SendTarget,
): BuiltSendMessageParams {
  const params: BuiltSendMessageParams = {
    chat_id: target.chatId,
    // Safety net: never exceed Telegram's hard limit even if an upstream guard
    // is bypassed. Normal bubbles are already far shorter.
    text: truncateForTelegram(text),
  };
  if (target.messageThreadId !== undefined) {
    params.message_thread_id = target.messageThreadId;
  }
  if (target.replyToPlatformMessageId !== undefined) {
    params.reply_parameters = {
      message_id: Number(target.replyToPlatformMessageId),
    };
  }
  return params;
}

export class TelegramSender {
  private readonly transport: TelegramTransport;

  constructor(transport: TelegramTransport) {
    this.transport = transport;
  }

  async sendText(
    text: string,
    target: SendTarget,
  ): Promise<{ messageId: string }> {
    return this.transport.sendMessage(buildSendMessageParams(text, target));
  }

  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    await this.transport.setMessageReaction({
      chat_id: chatId,
      message_id: Number(messageId),
      emoji,
    });
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.transport.answerCallbackQuery({
      callback_query_id: callbackId,
      text,
    });
  }
}
