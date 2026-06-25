export interface SessionAuthLike {
  readonly attributes: Readonly<Record<string, string | readonly string[]>>;
  readonly principalId: string;
}

export function csvSet(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;

  return new Set(
    raw
      .split(",")
      .map(part => part.trim())
      .filter(Boolean),
  );
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
  const trusted = csvSet("PARAM_TRUSTED_TELEGRAM_USER_IDS");
  return Boolean(userId && trusted?.has(userId));
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
