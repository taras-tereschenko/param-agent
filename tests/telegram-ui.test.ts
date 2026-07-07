import { describe, expect, test } from "bun:test";
import {
  buildInlineKeyboardMarkup,
  MAX_TELEGRAM_LINK_BUTTONS,
  parseTelegramLinkButtons,
} from "../agent/lib/telegram-ui.ts";

describe("parseTelegramLinkButtons", () => {
  test("returns nothing for empty input", () => {
    expect(parseTelegramLinkButtons(undefined)).toEqual({ buttons: [], text: "" });
    expect(parseTelegramLinkButtons("")).toEqual({ buttons: [], text: "" });
  });

  test("leaves plain text untouched", () => {
    expect(parseTelegramLinkButtons("just text")).toEqual({ buttons: [], text: "just text" });
  });

  test("extracts a link button and strips the directive", () => {
    const plan = parseTelegramLinkButtons("here [[param:link:The docs|https://example.com/docs]]");
    expect(plan.buttons).toEqual([{ text: "The docs", url: "https://example.com/docs" }]);
    expect(plan.text).toBe("here ");
  });

  test("supports multiple buttons and trims label and url", () => {
    const plan = parseTelegramLinkButtons(
      "[[param:link: One | https://a.com ]][[param:link:Two|https://b.com]]",
    );
    expect(plan.buttons).toEqual([
      { text: "One", url: "https://a.com" },
      { text: "Two", url: "https://b.com" },
    ]);
  });

  test("drops a button with a non-http(s) url", () => {
    expect(parseTelegramLinkButtons("[[param:link:Bad|javascript:alert(1)]]").buttons).toEqual([]);
    expect(parseTelegramLinkButtons("[[param:link:Bad|ftp://x.com]]").buttons).toEqual([]);
    expect(parseTelegramLinkButtons("[[param:link:Bad|not a url]]").buttons).toEqual([]);
  });

  test("drops a url with embedded whitespace", () => {
    expect(parseTelegramLinkButtons("[[param:link:Bad|https://x.com/a\nb]]").buttons).toEqual([]);
  });

  test("strips a dropped directive from the text so it never leaks", () => {
    const plan = parseTelegramLinkButtons("see [[param:link:Bad|javascript:alert(1)]] here");
    expect(plan.buttons).toEqual([]);
    expect(plan.text).toBe("see  here");
  });

  test("drops a button with an empty label or missing separator", () => {
    expect(parseTelegramLinkButtons("[[param:link:|https://a.com]]").buttons).toEqual([]);
    expect(parseTelegramLinkButtons("[[param:link:https://a.com]]").buttons).toEqual([]);
  });

  test("keeps the first pipe as the separator so query strings survive", () => {
    const plan = parseTelegramLinkButtons("[[param:link:Search|https://x.com/s?q=a|b]]");
    expect(plan.buttons).toEqual([{ text: "Search", url: "https://x.com/s?q=a|b" }]);
  });

  test("caps the number of buttons", () => {
    const directives = Array.from(
      { length: MAX_TELEGRAM_LINK_BUTTONS + 3 },
      (_unused, i) => `[[param:link:B${i}|https://x.com/${i}]]`,
    ).join("");
    expect(parseTelegramLinkButtons(directives).buttons).toHaveLength(MAX_TELEGRAM_LINK_BUTTONS);
  });
});

describe("buildInlineKeyboardMarkup", () => {
  test("returns undefined with no buttons", () => {
    expect(buildInlineKeyboardMarkup([])).toBeUndefined();
  });

  test("builds one button per row", () => {
    expect(
      buildInlineKeyboardMarkup([
        { text: "One", url: "https://a.com" },
        { text: "Two", url: "https://b.com" },
      ]),
    ).toEqual({
      inline_keyboard: [
        [{ text: "One", url: "https://a.com" }],
        [{ text: "Two", url: "https://b.com" }],
      ],
    });
  });
});
