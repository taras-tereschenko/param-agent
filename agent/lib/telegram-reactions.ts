/**
 * Telegram's default set of allowed emoji reactions. `setMessageReaction`
 * rejects anything outside this set, so Param only ever sends one of these.
 * Keep in sync with Telegram's documented reaction list if it changes.
 */
export const TELEGRAM_ALLOWED_REACTIONS: ReadonlySet<string> = new Set([
  "👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉",
  "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤‍🔥", "🌚",
  "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕",
  "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "✍",
  "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘",
  "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡",
]);

/**
 * Max reactions Param sends per message. Bots reliably set a single reaction,
 * so keep this at 1 unless that changes.
 */
export const MAX_TELEGRAM_REACTIONS = 1;

const REACTION_DIRECTIVE = /\[\[param:react:(?<emoji>[^\]]*)\]\]/giu;

// Telegram's reaction values omit the U+FE0F variation selector, but models
// emit the fully-qualified form (e.g. "❤️"). Strip it so input matches the
// allowed set and Telegram gets the canonical form it accepts.
function normalizeReactionEmoji(raw: string): string {
  return raw.trim().replace(new RegExp("\\uFE0F", "gu"), "");
}

export interface TelegramReactionPlan {
  /** Valid emoji to react with, in order, deduped and capped. */
  readonly reactions: readonly string[];
  /** The message text with all reaction directives removed. */
  readonly text: string;
}

/**
 * Pull reaction directives out of one actor text block.
 *
 * Param signals a reaction by emitting `[[param:react:👍]]` (optionally more
 * than one). This strips those directives from the text so they never post as
 * literal characters, keeps only emoji Telegram actually allows, dedupes them,
 * and caps the count. The returned `text` still needs the normal delivery
 * pipeline (stay-quiet suppression, bubbles); this only owns reactions.
 */
export function parseTelegramReactions(text: string | null | undefined): TelegramReactionPlan {
  if (!text) return { reactions: [], text: "" };

  const seen = new Set<string>();
  const reactions: string[] = [];

  for (const match of text.matchAll(REACTION_DIRECTIVE)) {
    const emoji = normalizeReactionEmoji(match.groups?.emoji ?? "");
    if (!emoji || seen.has(emoji) || !TELEGRAM_ALLOWED_REACTIONS.has(emoji)) continue;

    seen.add(emoji);
    if (reactions.length < MAX_TELEGRAM_REACTIONS) reactions.push(emoji);
  }

  const stripped = text.replace(REACTION_DIRECTIVE, "");

  return { reactions, text: stripped };
}

// Plain, non-readonly object type so it satisfies Eve's JsonObject request body
// type. Do not add readonly modifiers; that breaks the assignability.
export type SetMessageReactionRequest = {
  chat_id: string;
  message_id: number;
  reaction: { type: "emoji"; emoji: string }[];
};

/**
 * Build the `setMessageReaction` request body for the triggering message, or
 * `undefined` when it cannot be sent (missing chat/message id, non-integer
 * message id, or no reactions). Kept pure so the channel just forwards the
 * result to `telegram.request`.
 */
export function buildSetMessageReactionRequest(input: {
  readonly chatId: string | null | undefined;
  readonly messageId: string | null | undefined;
  readonly reactions: readonly string[];
}): SetMessageReactionRequest | undefined {
  if (!input.chatId || !input.messageId || input.reactions.length === 0) return undefined;

  const messageId = Number(input.messageId);
  if (!Number.isInteger(messageId)) return undefined;

  return {
    chat_id: input.chatId,
    message_id: messageId,
    reaction: input.reactions.map(emoji => ({ type: "emoji" as const, emoji })),
  };
}
