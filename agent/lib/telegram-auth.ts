export interface SessionAuthLike {
  readonly attributes: Readonly<Record<string, string | readonly string[]>>;
  readonly principalId: string;
}

export function csvList(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

export function csvSet(name: string) {
  const values = csvList(name);
  return values.length > 0 ? new Set(values) : undefined;
}

function jsonStringListMap(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return {};

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object of string arrays`);
  }

  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
      throw new Error(`${name}.${key} must be a string array`);
    }

    const entries = value.map(item => item.trim()).filter(Boolean);
    if (entries.length > 0) {
      result[key] = entries;
    }
  }

  return result;
}

export function envFlag(name: string, fallback = false) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export function telegramUserIdFromAuth(auth: SessionAuthLike | null | undefined) {
  const attribute = auth?.attributes.user_id;
  if (typeof attribute === "string" && attribute.length > 0) return attribute;

  const principalId = auth?.principalId;
  if (!principalId?.startsWith("telegram:")) return undefined;

  const parts = principalId.split(":");
  return parts.at(-1);
}

export function isTrustedTelegramUserId(userId: string | null | undefined) {
  return Boolean(userId && trustedTelegramUserIdSet().has(userId));
}

export function isTrustedTelegramReviewerForChat(
  userId: string | null | undefined,
  chatId: string | null | undefined,
) {
  if (!userId) return false;

  const chatReviewerIds = trustedTelegramUserIdsForChat(chatId);
  if (chatReviewerIds.length > 0) {
    return chatReviewerIds.includes(userId);
  }

  return isTrustedTelegramUserId(userId);
}

export function isTrustedTelegramAuth(auth: SessionAuthLike | null | undefined) {
  return isTrustedTelegramUserId(telegramUserIdFromAuth(auth));
}

export function isUnrestrictedTelegramAccessAllowed() {
  return envFlag("PARAM_ALLOW_UNRESTRICTED_TELEGRAM", false);
}

export function isAllowedTelegramPrivateUserId(userId: string | null | undefined) {
  const allowedUsers = csvSet("PARAM_ALLOWED_TELEGRAM_USER_IDS");
  if (!allowedUsers) return isUnrestrictedTelegramAccessAllowed();
  return Boolean(userId && allowedUsers.has(userId));
}

export function isAllowedTelegramChatId(chatId: string | null | undefined) {
  const allowedChats = csvSet("PARAM_ALLOWED_TELEGRAM_CHAT_IDS");
  if (!allowedChats) return isUnrestrictedTelegramAccessAllowed();
  return Boolean(chatId && allowedChats.has(chatId));
}

export function trustedTelegramUserIds() {
  return csvList("PARAM_TRUSTED_TELEGRAM_USER_IDS");
}

export function trustedTelegramUserIdSet() {
  return new Set(trustedTelegramUserIds());
}

export function trustedTelegramUserIdsForChat(chatId: string | null | undefined) {
  if (!chatId) return [];
  return jsonStringListMap("PARAM_TRUSTED_TELEGRAM_USER_IDS_BY_CHAT")[chatId] ?? [];
}

export function trustedTelegramMentionsForChat(chatId: string | null | undefined) {
  if (!chatId) return [];
  return jsonStringListMap("PARAM_TRUSTED_TELEGRAM_MENTIONS_BY_CHAT")[chatId] ?? [];
}

export function trustedTelegramMentions(chatId?: string | null) {
  const chatMentions = trustedTelegramMentionsForChat(chatId);
  if (chatMentions.length > 0) return chatMentions;

  return csvList("PARAM_TRUSTED_TELEGRAM_MENTIONS");
}
