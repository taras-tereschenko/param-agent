import type { DynamicResolveContext } from "eve/instructions";
import type { SessionAuthLike } from "../telegram-auth.js";

function stringAttr(auth: SessionAuthLike | null | undefined, name: string) {
  const value = auth?.attributes[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isGroupChatType(chatType: string | undefined) {
  return chatType === "group" || chatType === "supergroup";
}

export function telegramScopeFromAuth(auth: SessionAuthLike | null | undefined) {
  const chatId = stringAttr(auth, "chat_id");
  const chatType = stringAttr(auth, "chat_type");
  if (!chatId || !isGroupChatType(chatType)) return undefined;

  const threadId = stringAttr(auth, "message_thread_id");
  return threadId ? `telegram:${chatId}:topic:${threadId}` : `telegram:${chatId}`;
}

function telegramScopeFromContinuationToken(token: string | undefined) {
  if (!token) return undefined;

  const raw = token.startsWith("telegram:") ? token.slice("telegram:".length) : token;
  const [chatId, threadId] = raw.split(":");
  if (!chatId) return undefined;

  return threadId ? `telegram:${chatId}:topic:${threadId}` : `telegram:${chatId}`;
}

export function telegramScopeFromDynamicContext(ctx: DynamicResolveContext) {
  const fromAuth = telegramScopeFromAuth(ctx.session.auth.current ?? ctx.session.auth.initiator);
  if (fromAuth) return fromAuth;

  const chatId = ctx.channel.metadata?.chatId;
  if (typeof chatId === "string" && chatId.length > 0) {
    return telegramScopeFromContinuationToken(ctx.channel.continuationToken) ?? `telegram:${chatId}`;
  }

  return telegramScopeFromContinuationToken(ctx.channel.continuationToken);
}

export function allowedMemoryScopesForAuth(auth: SessionAuthLike | null | undefined) {
  const scopes = ["principal"];
  const telegramScope = telegramScopeFromAuth(auth);
  if (telegramScope) scopes.push(telegramScope);
  return scopes;
}

export function normalizeRequestedMemoryScope(
  requested: string | undefined,
  auth: SessionAuthLike | null | undefined,
) {
  const scope = requested?.trim() || "principal";
  const allowed = allowedMemoryScopesForAuth(auth);

  if (!allowed.includes(scope)) {
    return {
      allowed,
      error: `memory scope "${scope}" is not available in the current session`,
      scope: undefined,
    };
  }

  return { allowed, scope };
}

export function memoryOwnerPrincipalId(principalId: string, scope: string) {
  return scope === "principal" ? principalId : `scope:${scope}`;
}
