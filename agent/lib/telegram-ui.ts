/**
 * Inline link buttons for Telegram messages. Param can attach tappable,
 * labelled URL buttons instead of pasting raw links, which fits its style
 * ("readable link labels, no naked URLs"). Only URL buttons are supported here:
 * they carry no callback data, so they need no callback handling and never
 * touch Action Review. Consequential callback buttons are separate, later work.
 *
 * Param emits a button with a directive: `[[param:link:Label|https://url]]`.
 */

export const MAX_TELEGRAM_LINK_BUTTONS = 5;

const LINK_DIRECTIVE = /\[\[param:link:(?<spec>[^\]]*)\]\]/giu;

export interface TelegramLinkButton {
  readonly text: string;
  readonly url: string;
}

export interface TelegramLinkButtonPlan {
  /** Valid link buttons, in order, capped. */
  readonly buttons: readonly TelegramLinkButton[];
  /** The message text with all link directives removed. */
  readonly text: string;
}

// Plain, non-readonly object type so it satisfies Eve's JsonObject reply_markup
// body type. Do not add readonly modifiers; that breaks the assignability.
export type InlineKeyboardMarkup = {
  inline_keyboard: { text: string; url: string }[][];
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pull link-button directives out of one actor text block. Keeps only buttons
 * with a non-empty label and an http(s) URL, caps the count, and strips the
 * directives from the text so they never post as literal characters.
 */
export function parseTelegramLinkButtons(text: string | null | undefined): TelegramLinkButtonPlan {
  if (!text) return { buttons: [], text: "" };

  const buttons: TelegramLinkButton[] = [];

  for (const match of text.matchAll(LINK_DIRECTIVE)) {
    const spec = match.groups?.spec ?? "";
    const separator = spec.indexOf("|");
    if (separator < 0) continue;

    const label = spec.slice(0, separator).trim();
    const url = spec.slice(separator + 1).trim();
    if (!label || !isHttpUrl(url)) continue;

    if (buttons.length < MAX_TELEGRAM_LINK_BUTTONS) buttons.push({ text: label, url });
  }

  const stripped = text.replace(LINK_DIRECTIVE, "");

  return { buttons, text: stripped };
}

/**
 * Build a Telegram `reply_markup` inline keyboard (one button per row), or
 * `undefined` when there are no buttons.
 */
export function buildInlineKeyboardMarkup(
  buttons: readonly TelegramLinkButton[],
): InlineKeyboardMarkup | undefined {
  if (buttons.length === 0) return undefined;

  return {
    inline_keyboard: buttons.map(button => [{ text: button.text, url: button.url }]),
  };
}
