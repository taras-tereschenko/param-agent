import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildProactiveWakePrompt, proactiveTelegramChatIds } from "../agent/lib/proactive.ts";

const OLD_ENV = { ...process.env };

describe("proactiveTelegramChatIds", () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  test("is empty by default so Param never proactively spams", () => {
    delete process.env.PARAM_PROACTIVE_TELEGRAM_CHAT_IDS;
    expect(proactiveTelegramChatIds()).toEqual([]);
  });

  test("parses a comma-separated opt-in list", () => {
    process.env.PARAM_PROACTIVE_TELEGRAM_CHAT_IDS = "111, -100 ,222";
    expect(proactiveTelegramChatIds()).toEqual(["111", "-100", "222"]);
  });

  test("dedupes repeated chat ids so a wake fires once per chat", () => {
    process.env.PARAM_PROACTIVE_TELEGRAM_CHAT_IDS = "111,111,222";
    expect(proactiveTelegramChatIds()).toEqual(["111", "222"]);
  });
});

describe("buildProactiveWakePrompt", () => {
  test("frames a proactive moment and biases toward staying quiet", () => {
    const prompt = buildProactiveWakePrompt();
    expect(prompt.toLowerCase()).toContain("proactive");
    expect(prompt.toLowerCase()).toContain("stay quiet");
    expect(prompt.length).toBeGreaterThan(0);
  });
});
