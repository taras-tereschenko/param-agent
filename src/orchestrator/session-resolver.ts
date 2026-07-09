/**
 * Deterministic session keys.
 *
 * A session is one durable conversation context. DMs, groups, group topics,
 * task agents, and generated UI surfaces get separate sessions. Keys are
 * deterministic so concurrent workers converge on one session row.
 */
export type SessionRouteType = "dm" | "group" | "topic" | "task" | "ui_surface";

export type SessionRouteInput = {
  platform: string;
  accountId: string;
  routeType: SessionRouteType;
  platformChatId?: string;
  platformUserId?: string;
  messageThreadId?: string;
  surfaceId?: string;
  taskSessionRef?: string;
};

export function deriveSessionKey(input: SessionRouteInput): string {
  const p = input.platform;
  const a = input.accountId;
  switch (input.routeType) {
    case "dm":
      requireField(input.platformUserId, "platformUserId", "dm");
      return `${p}:dm:${a}:${input.platformUserId}`;
    case "group":
      requireField(input.platformChatId, "platformChatId", "group");
      return `${p}:group:${a}:${input.platformChatId}`;
    case "topic":
      requireField(input.platformChatId, "platformChatId", "topic");
      requireField(input.messageThreadId, "messageThreadId", "topic");
      return `${p}:topic:${a}:${input.platformChatId}:${input.messageThreadId}`;
    case "task":
      requireField(input.taskSessionRef, "taskSessionRef", "task");
      return `${p}:task:${input.taskSessionRef}`;
    case "ui_surface":
      requireField(input.surfaceId, "surfaceId", "ui_surface");
      return `${p}:ui:${a}:${input.surfaceId}`;
    default: {
      const exhaustive: never = input.routeType;
      throw new Error(`unknown route type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Map a Telegram chat type + optional topic thread into a Param route type.
 * A topic message routes to its own session, separate from the parent group.
 */
export function resolveTelegramRoute(
  chatType: string,
  messageThreadId?: string,
): SessionRouteType {
  if (chatType === "private") {
    return "dm";
  }
  if (chatType === "group" || chatType === "supergroup") {
    return messageThreadId ? "topic" : "group";
  }
  // channels and unknown types default to group routing.
  return "group";
}

/** Build the fields needed to upsert a session row for a Telegram route. */
export function buildTelegramSessionRoute(input: {
  accountId: string;
  chatType: string;
  platformChatId: string;
  platformUserId?: string;
  messageThreadId?: string;
}): {
  routeType: SessionRouteType;
  sessionKey: string;
  platform: "telegram";
  platformChatId: string;
  messageThreadId?: string;
} {
  const routeType = resolveTelegramRoute(input.chatType, input.messageThreadId);
  const sessionKey = deriveSessionKey({
    platform: "telegram",
    accountId: input.accountId,
    routeType,
    platformChatId: input.platformChatId,
    platformUserId: input.platformUserId,
    messageThreadId: input.messageThreadId,
  });
  return {
    routeType,
    sessionKey,
    platform: "telegram",
    platformChatId: input.platformChatId,
    messageThreadId: input.messageThreadId,
  };
}

function requireField(
  value: string | undefined,
  field: string,
  routeType: string,
): asserts value is string {
  if (!value) {
    throw new Error(`${routeType} session requires ${field}`);
  }
}
