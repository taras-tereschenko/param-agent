import { timingSafeEqual } from "node:crypto";
import {
  isAllowedTelegramChatId,
  isAllowedTelegramPrivateUserId,
  isTrustedTelegramUserId,
} from "./telegram-auth.js";

type TelegramRawChatType = "channel" | "group" | "private" | "supergroup";

interface TelegramRawCallbackUpdate {
  readonly callback_query?: {
    readonly from?: {
      readonly id?: number | string;
    };
    readonly message?: {
      readonly chat?: {
        readonly id?: number | string;
        readonly type?: TelegramRawChatType;
      };
    };
  };
}

function secureEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function verifySecretHeader(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
  if (!expected) return false;

  const actual = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return secureEqual(expected, actual);
}

function asId(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function isGroup(chatType: TelegramRawChatType | undefined) {
  return chatType === "group" || chatType === "supergroup";
}

function isAllowedCallback(update: TelegramRawCallbackUpdate) {
  const callback = update.callback_query;
  if (!callback) return true;

  const fromId = asId(callback.from?.id);
  if (!isTrustedTelegramUserId(fromId)) return false;

  const chat = callback.message?.chat;
  if (!chat) return false;

  if (chat.type === "private") {
    return isAllowedTelegramPrivateUserId(fromId);
  }

  if (isGroup(chat.type)) {
    return isAllowedTelegramChatId(asId(chat.id));
  }

  return false;
}

export async function verifyParamTelegramWebhook(request: Request, body: string) {
  if (!verifySecretHeader(request)) return false;

  let update: TelegramRawCallbackUpdate;
  try {
    update = JSON.parse(body) as TelegramRawCallbackUpdate;
  } catch {
    return false;
  }

  return isAllowedCallback(update) ? body : false;
}
