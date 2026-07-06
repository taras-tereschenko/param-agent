import { STAY_QUIET_TOKEN } from "./base-instructions.js";

export const DEFAULT_MAX_TELEGRAM_MESSAGES = 6;

export interface TelegramDeliveryPlan {
  /**
   * The messages to post, in order. Empty means Param stays quiet and the
   * channel should post nothing.
   */
  readonly messages: readonly string[];
}

export interface PlanTelegramDeliveryOptions {
  /**
   * Anti-flood ceiling on the number of separate Telegram bubbles for one
   * actor turn. Overflow is merged into the last bubble instead of dropped so
   * no content is lost. Values below 1 are treated as 1.
   */
  readonly maxMessages?: number;
}

/**
 * Turn one actor text block into the concrete Telegram messages to post.
 *
 * Param's actor separates thoughts with blank lines and signals "stay quiet"
 * with {@link STAY_QUIET_TOKEN}. This owns the delivery decisions the channel
 * used to make inline: suppressing the stay-quiet sentinel (even when the model
 * leaves it inline), splitting into separate bubbles, trimming, dropping empty
 * bubbles, and capping the burst so Param never floods a chat.
 *
 * The per-message 4096-character Telegram limit is intentionally left to the
 * channel's `post`, which already splits over-long text.
 */
export function planTelegramDelivery(
  text: string | null | undefined,
  options: PlanTelegramDeliveryOptions = {},
): TelegramDeliveryPlan {
  if (!text) return { messages: [] };

  // Remove the stay-quiet sentinel wherever it appears, not only when a bubble
  // is exactly the token, so it can never leak into a real message.
  const withoutQuietToken = text.split(STAY_QUIET_TOKEN).join("");

  const bubbles = withoutQuietToken
    .split(/\n{2,}/u)
    .map(part => part.trim())
    .filter(Boolean);

  if (bubbles.length === 0) return { messages: [] };

  const cap = Math.max(1, Math.floor(options.maxMessages ?? DEFAULT_MAX_TELEGRAM_MESSAGES));
  if (bubbles.length <= cap) return { messages: bubbles };

  const head = bubbles.slice(0, cap - 1);
  const merged = bubbles.slice(cap - 1).join("\n\n");

  return { messages: [...head, merged] };
}

/**
 * Read the anti-flood ceiling from the environment, falling back to
 * {@link DEFAULT_MAX_TELEGRAM_MESSAGES}. Non-numeric or sub-1 values fall back
 * to the default so a bad env var can never silence or unbound Param.
 */
export function telegramMaxMessages(): number {
  const raw = process.env.PARAM_TELEGRAM_MAX_MESSAGES?.trim();
  if (!raw) return DEFAULT_MAX_TELEGRAM_MESSAGES;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_TELEGRAM_MESSAGES;

  return parsed;
}
