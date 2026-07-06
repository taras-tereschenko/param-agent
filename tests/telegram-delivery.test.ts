import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { STAY_QUIET_TOKEN } from "../agent/lib/base-instructions.ts";
import {
  DEFAULT_MAX_TELEGRAM_MESSAGES,
  planTelegramDelivery,
  telegramMaxMessages,
} from "../agent/lib/telegram-delivery.ts";

const OLD_ENV = { ...process.env };

describe("planTelegramDelivery", () => {
  test("returns no messages for nullish or empty input", () => {
    expect(planTelegramDelivery(undefined).messages).toEqual([]);
    expect(planTelegramDelivery(null).messages).toEqual([]);
    expect(planTelegramDelivery("").messages).toEqual([]);
    expect(planTelegramDelivery("   \n  ").messages).toEqual([]);
  });

  test("keeps a single short message as one bubble", () => {
    expect(planTelegramDelivery("yo").messages).toEqual(["yo"]);
  });

  test("splits blank-line separated thoughts into separate bubbles", () => {
    expect(planTelegramDelivery("yo\n\nwhat's up").messages).toEqual(["yo", "what's up"]);
  });

  test("treats three or more newlines as a single split", () => {
    expect(planTelegramDelivery("yo\n\n\n\nwhat's up").messages).toEqual(["yo", "what's up"]);
  });

  test("keeps single newlines inside one bubble", () => {
    expect(planTelegramDelivery("line one\nline two").messages).toEqual(["line one\nline two"]);
  });

  test("trims bubbles and drops empty ones", () => {
    expect(planTelegramDelivery("  yo  \n\n   \n\n  bet ").messages).toEqual(["yo", "bet"]);
  });

  test("stays quiet when the output is exactly the stay-quiet token", () => {
    expect(planTelegramDelivery(STAY_QUIET_TOKEN).messages).toEqual([]);
    expect(planTelegramDelivery(`  ${STAY_QUIET_TOKEN}  `).messages).toEqual([]);
  });

  test("never leaks the stay-quiet token when the model leaves it inline", () => {
    expect(planTelegramDelivery(`yo ${STAY_QUIET_TOKEN}`).messages).toEqual(["yo"]);
    expect(planTelegramDelivery(`${STAY_QUIET_TOKEN} hey`).messages).toEqual(["hey"]);
  });

  test("drops a stay-quiet token that sits in its own bubble", () => {
    expect(planTelegramDelivery(`a\n\n${STAY_QUIET_TOKEN}\n\nb`).messages).toEqual(["a", "b"]);
  });

  test("caps the burst and merges overflow into the last bubble", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc\n\nd", { maxMessages: 2 });
    expect(plan.messages).toEqual(["a", "b\n\nc\n\nd"]);
  });

  test("merges everything into one bubble when the cap is 1", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc", { maxMessages: 1 });
    expect(plan.messages).toEqual(["a\n\nb\n\nc"]);
  });

  test("treats a sub-1 cap as 1 rather than dropping content", () => {
    expect(planTelegramDelivery("a\n\nb", { maxMessages: 0 }).messages).toEqual(["a\n\nb"]);
    expect(planTelegramDelivery("a\n\nb", { maxMessages: -3 }).messages).toEqual(["a\n\nb"]);
  });

  test("floors fractional caps", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc", { maxMessages: 2.9 });
    expect(plan.messages).toEqual(["a", "b\n\nc"]);
  });

  test("keeps every bubble when it is under the default cap", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc");
    expect(plan.messages).toEqual(["a", "b", "c"]);
    expect(plan.messages.length).toBeLessThanOrEqual(DEFAULT_MAX_TELEGRAM_MESSAGES);
  });
});

describe("telegramMaxMessages", () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  test("falls back to the default when unset", () => {
    delete process.env.PARAM_TELEGRAM_MAX_MESSAGES;
    expect(telegramMaxMessages()).toBe(DEFAULT_MAX_TELEGRAM_MESSAGES);
  });

  test("reads a valid override", () => {
    process.env.PARAM_TELEGRAM_MAX_MESSAGES = "3";
    expect(telegramMaxMessages()).toBe(3);
  });

  test("falls back to the default for non-numeric or sub-1 values", () => {
    process.env.PARAM_TELEGRAM_MAX_MESSAGES = "nope";
    expect(telegramMaxMessages()).toBe(DEFAULT_MAX_TELEGRAM_MESSAGES);

    process.env.PARAM_TELEGRAM_MAX_MESSAGES = "0";
    expect(telegramMaxMessages()).toBe(DEFAULT_MAX_TELEGRAM_MESSAGES);

    process.env.PARAM_TELEGRAM_MAX_MESSAGES = "-2";
    expect(telegramMaxMessages()).toBe(DEFAULT_MAX_TELEGRAM_MESSAGES);
  });
});
