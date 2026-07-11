/**
 * Telegram transport seam.
 *
 * `TelegramTransport` is the narrow interface the channel adapter depends on;
 * `BotApiTransport` is the production implementation over the Bot API. Keeping
 * the interface small makes the adapter trivially testable with a fake.
 *
 * `createChatSdkTelegramAdapter` documents the Chat SDK messenger integration
 * seam (long-polling / webhook lifecycle handled by the SDK adapter). Param's
 * own inbound normalization + access policy run on top of the raw updates.
 */

import {
  createTelegramAdapter,
  type TelegramAdapterConfig,
  type TelegramUpdate,
} from "@chat-adapter/telegram";

import { ParamError } from "../../shared/errors";

export type InlineKeyboardButton = { text: string; callback_data: string };

export type SendMessageParams = {
  chat_id: string;
  text: string;
  message_thread_id?: string;
  reply_parameters?: { message_id: number };
  parse_mode?: string;
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
};

export type SetMessageReactionParams = {
  chat_id: string;
  message_id: number;
  emoji: string;
};

export type AnswerCallbackQueryParams = {
  callback_query_id: string;
  text?: string;
};

export interface TelegramTransport {
  getUpdates(
    offset: number | undefined,
    timeoutSeconds: number,
  ): Promise<TelegramUpdate[]>;
  sendMessage(params: SendMessageParams): Promise<{ messageId: string }>;
  setMessageReaction(params: SetMessageReactionParams): Promise<void>;
  answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<void>;
  getMe(): Promise<{ id: string; username?: string }>;
}

type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export class BotApiTransport implements TelegramTransport {
  private readonly token: string;
  private readonly apiBaseUrl: string;

  constructor(token: string, apiBaseUrl = "https://api.telegram.org") {
    this.token = token;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.apiBaseUrl}/bot${this.token}/${method}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    let envelope: TelegramApiEnvelope<T>;
    try {
      envelope = (await response.json()) as TelegramApiEnvelope<T>;
    } catch (error) {
      throw new ParamError(
        "internal",
        `Telegram API ${method} returned a non-JSON response`,
        { method, status: response.status, cause: String(error) },
      );
    }

    if (!envelope.ok) {
      throw new ParamError(
        "internal",
        `Telegram API ${method} failed: ${envelope.description ?? `HTTP ${response.status}`}`,
        { method, status: response.status, errorCode: envelope.error_code },
      );
    }

    return envelope.result as T;
  }

  async getUpdates(
    offset: number | undefined,
    timeoutSeconds: number,
  ): Promise<TelegramUpdate[]> {
    const body: Record<string, unknown> = { timeout: timeoutSeconds };
    if (offset !== undefined) {
      body.offset = offset;
    }
    const result = await this.call<TelegramUpdate[]>("getUpdates", body);
    return result ?? [];
  }

  async sendMessage(params: SendMessageParams): Promise<{ messageId: string }> {
    const result = await this.call<{ message_id: number }>(
      "sendMessage",
      params as unknown as Record<string, unknown>,
    );
    return { messageId: String(result.message_id) };
  }

  async setMessageReaction(params: SetMessageReactionParams): Promise<void> {
    await this.call("setMessageReaction", {
      chat_id: params.chat_id,
      message_id: params.message_id,
      reaction: [{ type: "emoji", emoji: params.emoji }],
    });
  }

  async answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: params.callback_query_id,
      text: params.text,
    });
  }

  async getMe(): Promise<{ id: string; username?: string }> {
    const result = await this.call<{ id: number; username?: string }>(
      "getMe",
      {},
    );
    return { id: String(result.id), username: result.username };
  }
}

/**
 * Thin factory around the Chat SDK Telegram adapter. The SDK adapter reads
 * `TELEGRAM_BOT_TOKEN` and long-polling settings from config/env; this exists
 * to document the messenger integration seam without wrapping it.
 */
export function createChatSdkTelegramAdapter(config?: TelegramAdapterConfig) {
  return createTelegramAdapter(config);
}
