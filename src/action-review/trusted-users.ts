import type { TrustScope } from "../contracts/action-review";

/**
 * A resolved trusted user (config secret refs already resolved to strings).
 * Trusted users are configuration/security state, NOT memory.
 */
export type ResolvedTrustedUser = {
  platform: string;
  platformUserId: string;
  scopes: TrustedUserScope[];
  status?: "active" | "revoked";
};

export type TrustedUserScope =
  | { scope: "global" }
  | { scope: "server_admin" }
  | { scope: "chat"; platform: string; chatId: string; topicId?: string }
  | { scope: "project"; projectId: string };

export type TrustContext = {
  platform: string;
  chatId?: string;
  topicId?: string;
  projectId?: string;
};

/** Does a single trusted-user scope satisfy the required trust scope + context? */
export function scopeSatisfies(
  scope: TrustedUserScope,
  required: TrustScope,
  ctx: TrustContext,
): boolean {
  // Global trust satisfies everything.
  if (scope.scope === "global") {
    return true;
  }
  if (required === "server_admin") {
    return scope.scope === "server_admin";
  }
  if (required === "chat") {
    if (scope.scope !== "chat") return false;
    if (scope.platform !== ctx.platform) return false;
    if (scope.chatId !== ctx.chatId) return false;
    // A topic-scoped trust only applies within its topic.
    if (scope.topicId !== undefined && scope.topicId !== ctx.topicId) {
      return false;
    }
    return true;
  }
  if (required === "project") {
    return scope.scope === "project" && scope.projectId === ctx.projectId;
  }
  // required === "global": only a global scope (handled above) satisfies it.
  return false;
}

/** Is this platform user trusted for the required scope in this context? */
export function isTrustedForScope(
  platformUserId: string,
  required: TrustScope,
  ctx: TrustContext,
  trustedUsers: ResolvedTrustedUser[],
): boolean {
  const user = trustedUsers.find(
    (u) =>
      u.platform === ctx.platform &&
      u.platformUserId === platformUserId &&
      (u.status ?? "active") === "active",
  );
  if (!user) {
    return false;
  }
  return user.scopes.some((scope) => scopeSatisfies(scope, required, ctx));
}

/** Trusted approvers present in a given chat/topic (for in-chat approval). */
export function trustedApproversInChat(
  requiredScope: TrustScope,
  ctx: TrustContext,
  participantsPlatformUserIds: string[],
  trustedUsers: ResolvedTrustedUser[],
): string[] {
  return participantsPlatformUserIds.filter((id) =>
    isTrustedForScope(id, requiredScope, ctx, trustedUsers),
  );
}
