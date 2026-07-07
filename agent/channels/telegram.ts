import {
  registerTelegramFreeformPrompt,
  renderTelegramInputRequest,
  splitTelegramMessageText,
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
import {
  buildSetMessageReactionRequest,
  parseTelegramReactions,
} from "../lib/telegram-reactions.js";
import { buildInlineKeyboardMarkup, parseTelegramLinkButtons } from "../lib/telegram-ui.js";
import { verifyParamTelegramWebhook } from "../lib/telegram-webhook.js";

function triggeringMessageId(ctx: unknown): string | undefined {
  // Only the current turn's caller — reacting to the initiator could target a
  // stale origin message on a resumed or proactive session.
  const current = (ctx as { session?: { auth?: { current?: unknown } } })?.session?.auth?.current;
  const value = (current as { attributes?: Record<string, unknown> } | null | undefined)
    ?.attributes?.message_id;

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

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
    async "message.completed"(data, channel, ctx) {
      if (data.finishReason === "tool-calls" || !data.message) return;

      const { reactions, text: afterReactions } = parseTelegramReactions(data.message);
      const { buttons, text } = parseTelegramLinkButtons(afterReactions);

      const reactionRequest = buildSetMessageReactionRequest({
        chatId: channel.state.chatId,
        messageId: triggeringMessageId(ctx),
        reactions,
      });
      if (reactionRequest) {
        try {
          await channel.telegram.request("setMessageReaction", reactionRequest);
        } catch (error) {
          console.error("failed to set telegram reaction", error);
        }
      }

      const plan = planTelegramDelivery(text, { maxMessages: telegramMaxMessages() });
      const replyMarkup = buildInlineKeyboardMarkup(buttons);
      for (const [index, message] of plan.messages.entries()) {
        const isLastBubble = index === plan.messages.length - 1;
        if (!(isLastBubble && replyMarkup)) {
          await channel.telegram.post(message);
          continue;
        }

        // Attach the keyboard to the true last chunk: post() puts reply_markup on
        // the first chunk when it splits an over-4096 message, which would strand
        // the buttons mid-message. On rejection, resend without buttons so the
        // reply text is never lost.
        const chunks = splitTelegramMessageText(message);
        for (const [chunkIndex, chunk] of chunks.entries()) {
          if (chunkIndex < chunks.length - 1) {
            await channel.telegram.post(chunk);
            continue;
          }
          try {
            await channel.telegram.post({ reply_markup: replyMarkup, text: chunk });
          } catch (error) {
            console.error("failed to post telegram buttons; sending without", error);
            await channel.telegram.post(chunk);
          }
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
