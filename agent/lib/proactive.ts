import { csvList } from "./telegram-auth.js";

/**
 * Telegram chats Param may proactively wake into. Opt-in only: an empty list
 * means Param never starts conversations on its own, so scheduled wakes can
 * never spam a chat that has not asked for them.
 */
export function proactiveTelegramChatIds(): string[] {
  return csvList("PARAM_PROACTIVE_TELEGRAM_CHAT_IDS");
}

/**
 * The wake message handed to Param on a scheduled proactive turn. It is not a
 * user message — it tells Param a real friend might (rarely) reach out, and to
 * stay quiet unless it genuinely feels natural. Staying quiet is done the usual
 * way (the stay-quiet token), so a quiet decision posts nothing.
 */
export function buildProactiveWakePrompt(): string {
  return [
    "Proactive moment: no one just messaged you. This is a scheduled check-in, not a user turn.",
    "Decide whether a real friend would naturally reach out right now, like a light check-in, a random thought, a meme, or a follow-up on something that actually matters.",
    "Usually the right move is to stay quiet. Only speak if it genuinely feels natural, not needy or spammy.",
    "If nothing feels natural, stay quiet.",
  ].join("\n");
}
