import type { ParamConfig, SecretRef } from "../config/schema";
import { resolveSecretRef } from "../config/secrets";
import type {
  ResolvedTrustedUser,
  TrustedUserScope,
} from "../action-review/trusted-users";

type StringOrRef = string | SecretRef;

function resolve(value: StringOrRef): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  try {
    return resolveSecretRef(value);
  } catch {
    return undefined;
  }
}

/**
 * Resolve configured trusted users into the shape Action Review consumes,
 * resolving secret refs to strings. Entries whose id cannot be resolved (e.g.
 * an unset owner env var) are dropped rather than throwing, matching the
 * fail-closed access posture.
 */
export function resolveTrustedUsers(
  config: ParamConfig,
): ResolvedTrustedUser[] {
  const resolved: ResolvedTrustedUser[] = [];
  for (const trusted of config.trustedUsers) {
    const platformUserId = resolve(trusted.platformUserId);
    if (!platformUserId) {
      continue;
    }
    const scopes: TrustedUserScope[] = [];
    for (const scope of trusted.scopes) {
      if (scope.scope === "global") {
        scopes.push({ scope: "global" });
      } else if (scope.scope === "server_admin") {
        scopes.push({ scope: "server_admin" });
      } else if (scope.scope === "chat") {
        const chatId = resolve(scope.chatId);
        if (!chatId) continue;
        scopes.push({
          scope: "chat",
          platform: scope.platform,
          chatId,
          topicId: scope.topicId ? resolve(scope.topicId) : undefined,
        });
      } else if (scope.scope === "project") {
        scopes.push({ scope: "project", projectId: scope.projectId });
      }
    }
    if (scopes.length > 0) {
      resolved.push({
        platform: trusted.platform,
        platformUserId,
        scopes,
        status: "active",
      });
    }
  }
  return resolved;
}
