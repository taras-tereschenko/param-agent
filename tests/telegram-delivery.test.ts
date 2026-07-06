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

  test("splits CRLF and bare-CR blank lines into separate bubbles", () => {
    expect(planTelegramDelivery("yo\r\n\r\nwhat's up").messages).toEqual(["yo", "what's up"]);
    expect(planTelegramDelivery("yo\r\rwhat's up").messages).toEqual(["yo", "what's up"]);
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

  test("does not leak a sentinel reconstituted from overlapping tokens", () => {
    expect(planTelegramDelivery("[[param:[[param:stay_quiet]]stay_quiet]]").messages).toEqual([]);
    expect(planTelegramDelivery(`yo [[param:${STAY_QUIET_TOKEN}stay_quiet]]`).messages).toEqual([
      "yo",
    ]);
  });

  test("caps the burst and merges overflow into the last bubble", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc\n\nd", { maxMessages: 2 });
    expect(plan.messages).toEqual(["a", "b\n\nc\n\nd"]);
  });

  test("merges everything into one bubble when the cap is 1", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc", { maxMessages: 1 });
    expect(plan.messages).toEqual(["a\n\nb\n\nc"]);
  });

  test("keeps every bubble when the count exactly equals the cap", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc", { maxMessages: 3 });
    expect(plan.messages).toEqual(["a", "b", "c"]);
  });

  test("treats a sub-1 cap as 1 rather than dropping content", () => {
    expect(planTelegramDelivery("a\n\nb", { maxMessages: 0 }).messages).toEqual(["a\n\nb"]);
    expect(planTelegramDelivery("a\n\nb", { maxMessages: -3 }).messages).toEqual(["a\n\nb"]);
  });

  test("falls back to the default cap for a non-finite cap", () => {
    // 7 bubbles so the result differs from both broken behaviors (NaN would
    // merge into 1, Infinity would keep all 7); only the default cap gives 6.
    const sevenBubbles = "a\n\nb\n\nc\n\nd\n\ne\n\nf\n\ng";
    expect(planTelegramDelivery(sevenBubbles, { maxMessages: Number.NaN }).messages).toHaveLength(
      DEFAULT_MAX_TELEGRAM_MESSAGES,
    );
    expect(
      planTelegramDelivery(sevenBubbles, { maxMessages: Number.POSITIVE_INFINITY }).messages,
    ).toHaveLength(DEFAULT_MAX_TELEGRAM_MESSAGES);
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

  test("applies the default cap and merges overflow when no cap is passed", () => {
    const plan = planTelegramDelivery("a\n\nb\n\nc\n\nd\n\ne\n\nf\n\ng");
    expect(plan.messages).toHaveLength(DEFAULT_MAX_TELEGRAM_MESSAGES);
    expect(plan.messages).toEqual(["a", "b", "c", "d", "e", "f\n\ng"]);
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
