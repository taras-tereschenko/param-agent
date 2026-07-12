/**
 * Telegram access policy.
 *
 * PURE, no I/O. Decides *access* (who is allowed to talk to Param) only. This
 * is deliberately separate from *trust* (who may approve consequential
 * actions), which lives elsewhere. The caller resolves any `SecretRef` values
 * to plain strings before building the allow-lists passed here.
 */

export type TelegramAccessLists = {
  allowedPrivateUserIds: string[];
  allowedGroupChatIds: string[];
  allowedTopicIds: { chatId: string; topicId: string }[];
};

export type AccessContext = {
  chatType: string;
  chatId: string;
  fromUserId?: string;
  messageThreadId?: string;
};

export type AccessDecision = {
  allowed: boolean;
  reason: string;
  routeType: "dm" | "group" | "topic" | "channel" | "unknown";
};

function hasThread(ctx: AccessContext): boolean {
  return ctx.messageThreadId !== undefined && ctx.messageThreadId !== "";
}

export function evaluateTelegramAccess(
  ctx: AccessContext,
  lists: TelegramAccessLists,
): AccessDecision {
  switch (ctx.chatType) {
    case "private": {
      if (!ctx.fromUserId) {
        return {
          allowed: false,
          reason: "private chat with no sender id",
          routeType: "dm",
        };
      }
      if (lists.allowedPrivateUserIds.includes(ctx.fromUserId)) {
        return {
          allowed: true,
          reason: `private user ${ctx.fromUserId} is allow-listed`,
          routeType: "dm",
        };
      }
      return {
        allowed: false,
        reason: `private user ${ctx.fromUserId} is not allow-listed`,
        routeType: "dm",
      };
    }

    case "group":
    case "supergroup": {
      const inTopic = hasThread(ctx);
      const routeType: AccessDecision["routeType"] = inTopic ? "topic" : "group";

      if (!lists.allowedGroupChatIds.includes(ctx.chatId)) {
        return {
          allowed: false,
          reason: `group chat ${ctx.chatId} is not allow-listed`,
          routeType,
        };
      }

      // Topic restrictions are PER-CHAT: only gate this chat's topics when at
      // least one topic entry exists FOR THIS chat. Topic entries for other
      // chats must not restrict this one.
      const topicEntriesForChat = lists.allowedTopicIds.filter(
        (t) => t.chatId === ctx.chatId,
      );
      if (topicEntriesForChat.length > 0) {
        // The operator restricted this chat to specific topics. A message must
        // be in one of them — and a no-thread ("General") message is NOT in an
        // allow-listed topic, so it is denied too (previously it slipped through
        // the group allow-list, leaking the General topic).
        const match =
          inTopic &&
          topicEntriesForChat.some((t) => t.topicId === ctx.messageThreadId);
        if (!match) {
          return {
            allowed: false,
            reason: inTopic
              ? `topic ${ctx.messageThreadId} in chat ${ctx.chatId} is not allow-listed`
              : `chat ${ctx.chatId} is restricted to specific topics; the General topic is not allow-listed`,
            routeType: inTopic ? "topic" : routeType,
          };
        }
        return {
          allowed: true,
          reason: `topic ${ctx.messageThreadId} in chat ${ctx.chatId} is allow-listed`,
          routeType: "topic",
        };
      }

      return {
        allowed: true,
        reason: inTopic
          ? `topic ${ctx.messageThreadId} allowed (group ${ctx.chatId} allow-listed, no topic restriction)`
          : `group chat ${ctx.chatId} is allow-listed`,
        routeType,
      };
    }

    case "channel":
      return {
        allowed: false,
        reason: "channel posts are denied by default",
        routeType: "channel",
      };

    default:
      return {
        allowed: false,
        reason: `unknown chat type "${ctx.chatType}"`,
        routeType: "unknown",
      };
  }
}
