import { telegramChannel } from "eve/channels/telegram";
import { STAY_QUIET_TOKEN } from "../lib/base-instructions.js";
import { telegramPolicyDecision } from "../lib/telegram-policy.js";
import { verifyParamTelegramWebhook } from "../lib/telegram-webhook.js";

export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "param_bot",
  credentials: {
    webhookVerifier: verifyParamTelegramWebhook,
  },
  uploadPolicy: {
    allowedMediaTypes: ["image/*", "application/pdf", "text/plain"],
    maxBytes: 10 * 1024 * 1024,
  },
  async onMessage(ctx, message) {
    const decision = telegramPolicyDecision(message, ctx.telegram.botUsername);
    if (!decision) return null;

    if (decision.reason !== "ambient") {
      await ctx.telegram.startTyping();
    }
    return decision;
  },
  events: {
    async "message.completed"(data, channel) {
      if (data.finishReason === "tool-calls" || !data.message) return;

      const text = data.message.trim();
      if (!text || text === STAY_QUIET_TOKEN) return;

      const messages = text
        .split(/\n{2,}/u)
        .map(part => part.trim())
        .filter(Boolean);

      for (const message of messages) {
        if (message !== STAY_QUIET_TOKEN) {
          await channel.telegram.post(message);
        }
      }
    },
    async "turn.failed"(_data, channel) {
      await channel.telegram.post("ugh something broke on my side\n\ntry again in a sec");
    },
    async "session.failed"(_data, channel) {
      await channel.telegram.post("this thread got stuck\n\nsend a new message and i’ll pick it back up");
    },
  },
});
