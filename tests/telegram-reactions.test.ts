import { describe, expect, test } from "bun:test";
import {
  buildSetMessageReactionRequest,
  MAX_TELEGRAM_REACTIONS,
  parseTelegramReactions,
  TELEGRAM_ALLOWED_REACTIONS,
} from "../agent/lib/telegram-reactions.ts";

describe("parseTelegramReactions", () => {
  test("returns nothing for empty input", () => {
    expect(parseTelegramReactions(undefined)).toEqual({ reactions: [], text: "" });
    expect(parseTelegramReactions("")).toEqual({ reactions: [], text: "" });
  });

  test("leaves plain text untouched", () => {
    expect(parseTelegramReactions("yo what's up")).toEqual({
      reactions: [],
      text: "yo what's up",
    });
  });

  test("extracts a reaction directive and strips it from the text", () => {
    const plan = parseTelegramReactions("nice [[param:react:🔥]]");
    expect(plan.reactions).toEqual(["🔥"]);
    expect(plan.text).toBe("nice ");
  });

  test("supports a reaction-only message (no text left after stripping)", () => {
    const plan = parseTelegramReactions("[[param:react:👍]]");
    expect(plan.reactions).toEqual(["👍"]);
    expect(plan.text).toBe("");
  });

  test("drops emoji Telegram does not allow as reactions", () => {
    const plan = parseTelegramReactions("[[param:react:🍕]]");
    expect(plan.reactions).toEqual([]);
    expect(plan.text).toBe("");
  });

  test("normalizes the variation selector so a fully-qualified emoji matches", () => {
    // "❤️" is the heart models emit; Telegram's reaction value is the
    // bare "❤", which is what the allowed set holds.
    expect(parseTelegramReactions("[[param:react:❤️]]").reactions).toEqual(["❤"]);
  });

  test("dedupes repeated reactions", () => {
    // With MAX_TELEGRAM_REACTIONS === 1 the cap also enforces this; the seen-set
    // dedupe becomes independently observable only if the cap rises above 1.
    const plan = parseTelegramReactions("[[param:react:👍]] [[param:react:👍]]");
    expect(plan.reactions).toEqual(["👍"]);
  });

  test("caps the number of reactions", () => {
    const plan = parseTelegramReactions("[[param:react:👍]][[param:react:🔥]][[param:react:🎉]]");
    expect(plan.reactions).toHaveLength(MAX_TELEGRAM_REACTIONS);
    expect(plan.reactions).toEqual(["👍"]);
  });

  test("ignores an empty or whitespace directive", () => {
    expect(parseTelegramReactions("[[param:react:]]").reactions).toEqual([]);
    expect(parseTelegramReactions("[[param:react:   ]]").reactions).toEqual([]);
  });

  test("trims surrounding whitespace inside the directive", () => {
    expect(parseTelegramReactions("[[param:react: 🔥 ]]").reactions).toEqual(["🔥"]);
  });

  test("strips reaction directives even when mixed through multi-line text", () => {
    const plan = parseTelegramReactions("first line\n\n[[param:react:❤]]\n\nsecond line");
    expect(plan.reactions).toEqual(["❤"]);
    expect(plan.text).toBe("first line\n\n\n\nsecond line");
  });

  test("every allowed reaction round-trips through the parser", () => {
    for (const emoji of TELEGRAM_ALLOWED_REACTIONS) {
      expect(parseTelegramReactions(`[[param:react:${emoji}]]`).reactions).toEqual([emoji]);
    }
  });
});

describe("buildSetMessageReactionRequest", () => {
  test("builds a request for a valid chat, message, and reaction", () => {
    expect(
      buildSetMessageReactionRequest({ chatId: "-100", messageId: "42", reactions: ["🔥"] }),
    ).toEqual({
      chat_id: "-100",
      message_id: 42,
      reaction: [{ type: "emoji", emoji: "🔥" }],
    });
  });

  test("returns undefined without a chat id, message id, or reaction", () => {
    expect(buildSetMessageReactionRequest({ chatId: null, messageId: "42", reactions: ["🔥"] })).toBeUndefined();
    expect(buildSetMessageReactionRequest({ chatId: "-100", messageId: null, reactions: ["🔥"] })).toBeUndefined();
    expect(buildSetMessageReactionRequest({ chatId: "-100", messageId: "42", reactions: [] })).toBeUndefined();
  });

  test("returns undefined for a non-integer message id", () => {
    expect(
      buildSetMessageReactionRequest({ chatId: "-100", messageId: "abc", reactions: ["🔥"] }),
    ).toBeUndefined();
  });
});
