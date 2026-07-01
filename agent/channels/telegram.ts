import {
  registerTelegramFreeformPrompt,
  renderTelegramInputRequest,
  telegramChannel,
} from "eve/channels/telegram";
import { formatActionReviewMessage, isApprovalRequest } from "../lib/action-review.js";
import { STAY_QUIET_TOKEN } from "../lib/base-instructions.js";
import {
  recordActionReviewRequested,
  recordActionReviewResult,
} from "../lib/db/action-review.js";
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
    async "action.result"(data, channel, ctx) {
      if (data.result.kind !== "tool-result") return;

      try {
        await recordActionReviewResult({ ctx, event: data, state: channel.state });
      } catch (error) {
        console.error("failed to update action review audit", error);
      }
    },
    async "turn.failed"(_data, channel) {
      await channel.telegram.post("ugh something broke on my side\n\ntry again in a sec");
    },
    async "session.failed"(_data, channel) {
      await channel.telegram.post("this thread got stuck\n\nsend a new message and i’ll pick it back up");
    },
    async "input.requested"(data, channel, ctx) {
      for (const request of data.requests) {
        if (isApprovalRequest(request)) {
          try {
            await recordActionReviewRequested({
              ctx,
              event: data,
              request,
              state: channel.state,
            });
          } catch (error) {
            console.error("failed to create action review audit", error);
            await channel.telegram.post(
              "action review unavailable\n\napproval buttons hidden because audit logging failed",
            );
            continue;
          }
        }

        const rendered = renderTelegramInputRequest(request, channel.state);
        const formatted = formatActionReviewMessage({
          renderedText: rendered.text,
          request,
          state: channel.state,
        });

        const posted = await channel.telegram.post({
          reply_markup: formatted.allowReplyMarkup ? rendered.replyMarkup : undefined,
          text: formatted.text,
        });

        if (formatted.allowReplyMarkup && rendered.freeformRequestId !== undefined && posted.id) {
          registerTelegramFreeformPrompt(channel.state, {
            messageId: posted.id,
            requestId: rendered.freeformRequestId,
          });
        }
      }
    },
  },
});
