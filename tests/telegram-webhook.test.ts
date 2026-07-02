import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { verifyParamTelegramWebhook } from "../agent/lib/telegram-webhook.ts";

const OLD_ENV = { ...process.env };

function webhookRequest() {
  return new Request("https://param.test/eve/v1/telegram", {
    headers: {
      "x-telegram-bot-api-secret-token": "telegram-secret",
    },
    method: "POST",
  });
}

function callbackBody(input: {
  readonly chatId: string | number;
  readonly chatType: "private" | "group" | "supergroup";
  readonly fromId: string | number;
}) {
  return JSON.stringify({
    callback_query: {
      from: { id: input.fromId },
      id: "callback-id",
      message: {
        chat: {
          id: input.chatId,
          type: input.chatType,
        },
      },
    },
  });
}

beforeEach(() => {
  process.env = { ...OLD_ENV };
  process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN = "telegram-secret";
  process.env.PARAM_ALLOWED_TELEGRAM_CHAT_IDS = "-100";
  process.env.PARAM_ALLOWED_TELEGRAM_USER_IDS = "111";
  process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS = "111";
  process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS_BY_CHAT = "";
  process.env.PARAM_ALLOW_UNRESTRICTED_TELEGRAM = "false";
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("verifyParamTelegramWebhook", () => {
  test("allows trusted callbacks in allowed groups", async () => {
    const body = callbackBody({ chatId: "-100", chatType: "supergroup", fromId: "111" });

    await expect(verifyParamTelegramWebhook(webhookRequest(), body)).resolves.toBe(body);
  });

  test("rejects untrusted callback approvers", async () => {
    const body = callbackBody({ chatId: "-100", chatType: "supergroup", fromId: "222" });

    await expect(verifyParamTelegramWebhook(webhookRequest(), body)).resolves.toBe(false);
  });

  test("rejects trusted callbacks from disallowed chats", async () => {
    const body = callbackBody({ chatId: "-200", chatType: "supergroup", fromId: "111" });

    await expect(verifyParamTelegramWebhook(webhookRequest(), body)).resolves.toBe(false);
  });

  test("allows configured chat-specific reviewers", async () => {
    process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS_BY_CHAT = JSON.stringify({
      "-100": ["222"],
    });
    const body = callbackBody({ chatId: "-100", chatType: "supergroup", fromId: "222" });

    await expect(verifyParamTelegramWebhook(webhookRequest(), body)).resolves.toBe(body);
  });

  test("rejects global trusted users when a chat-specific reviewer list is configured", async () => {
    process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS_BY_CHAT = JSON.stringify({
      "-100": ["222"],
    });
    const body = callbackBody({ chatId: "-100", chatType: "supergroup", fromId: "111" });

    await expect(verifyParamTelegramWebhook(webhookRequest(), body)).resolves.toBe(false);
  });
});
