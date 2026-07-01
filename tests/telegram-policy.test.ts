import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TelegramMessage } from "eve/channels/telegram";
import { telegramPolicyDecision } from "../agent/lib/telegram-policy.ts";

const OLD_ENV = { ...process.env };

function privateMessage(input: {
  readonly fromId: string;
  readonly text: string;
}): TelegramMessage {
  return {
    attachments: [],
    caption: "",
    chat: {
      id: input.fromId,
      type: "private",
    },
    from: {
      firstName: "Test",
      id: input.fromId,
      isBot: false,
      username: "test_user",
    },
    messageId: "1",
    text: input.text,
  };
}

beforeEach(() => {
  process.env = { ...OLD_ENV };
  process.env.PARAM_ALLOWED_TELEGRAM_USER_IDS = "111,222";
  process.env.PARAM_ALLOWED_TELEGRAM_CHAT_IDS = "";
  process.env.PARAM_TRUSTED_TELEGRAM_USER_IDS = "111";
  process.env.PARAM_ALLOW_UNRESTRICTED_TELEGRAM = "false";
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("telegramPolicyDecision", () => {
  test("blocks untrusted private approval words", () => {
    const decision = telegramPolicyDecision(privateMessage({ fromId: "222", text: "approve" }), "param_bot");

    expect(decision).toBeNull();
  });

  test("allows trusted private approval words", () => {
    const decision = telegramPolicyDecision(privateMessage({ fromId: "111", text: "approve" }), "param_bot");

    expect(decision?.reason).toBe("private");
  });
});
