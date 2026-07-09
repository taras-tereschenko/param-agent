/**
 * Build a raw payload reference for a Telegram update so the full provider
 * payload can be preserved (inline) alongside a normalized event.
 */

import type { TelegramUpdate } from "@chat-adapter/telegram";

import { hashJson } from "../../shared/json";

export function rawUpdateKind(update: TelegramUpdate): string {
  if (update.message) return "message";
  if (update.edited_message) return "edited_message";
  if (update.message_reaction) return "message_reaction";
  if (update.callback_query) return "callback_query";
  if (update.channel_post) return "channel_post";
  if (update.edited_channel_post) return "edited_channel_post";
  return "unknown";
}

export function buildRawPayloadRef(update: TelegramUpdate): {
  provider: "telegram";
  kind: string;
  storage: "inline";
  json: Record<string, unknown>;
  hash: string;
} {
  return {
    provider: "telegram",
    kind: rawUpdateKind(update),
    storage: "inline",
    json: update as unknown as Record<string, unknown>,
    hash: hashJson(update),
  };
}
