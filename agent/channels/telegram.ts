import {
  registerTelegramFreeformPrompt,
  renderTelegramInputRequest,
  telegramChannel,
} from "eve/channels/telegram";
import { formatActionReviewMessage, isApprovalRequest } from "../lib/action-review.js";
import {
  actionReviewRouteForTelegram,
  formatDmFallbackNotice,
  sendDmActionReviewNotifications,
} from "../lib/action-review-routing.js";
import {
  recordActionReviewRequested,
  recordActionReviewResult,
} from "../lib/db/action-review.js";
import { planTelegramDelivery, telegramMaxMessages } from "../lib/telegram-delivery.js";
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

      const plan = planTelegramDelivery(data.message, { maxMessages: telegramMaxMessages() });
      for (const message of plan.messages) {
        await channel.telegram.post(message);
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
          const route = actionReviewRouteForTelegram(channel.state);

          try {
            await recordActionReviewRequested({
              ctx,
              event: data,
              request,
              routing: {
                dmReviewerTelegramUserIds:
                  route.kind === "dm-notify" ? route.notifyReviewerTelegramUserIds : [],
                route: route.kind,
              },
              state: channel.state,
            });
          } catch (error) {
            console.error("failed to create action review audit", error);
            await channel.telegram.post(
              "action review unavailable\n\napproval buttons hidden because audit logging failed",
            );
            continue;
          }

          const rendered = renderTelegramInputRequest(request, channel.state);
          const formatted = formatActionReviewMessage({
            mentions: route.kind === "chat" ? route.mentions : [],
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

          if (route.kind === "dm-notify" && formatted.allowReplyMarkup) {
            const deliveredCount = await sendDmActionReviewNotifications({
              reviewText: formatted.text,
              reviewerTelegramUserIds: route.notifyReviewerTelegramUserIds,
              state: channel.state,
              telegram: channel.telegram,
            });

            await channel.telegram.post(
              formatDmFallbackNotice({
                deliveredCount,
                reviewerCount: route.notifyReviewerTelegramUserIds.length,
              }),
            );
          }
          continue;
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
