import type { ParamConfig } from "../config/schema";
import type {
  PlatformCapabilitySummary,
  PromptApprovalPolicy,
  StyleGuardPolicy,
} from "../contracts/prompt";
import { promptVersions } from "../contracts/prompt";
import type { Session } from "../db/repositories/sessions";
import type { MemoryRetrievalContext } from "../memory/scopes";

export function telegramCapabilities(
  availableReactions?: string[],
): PlatformCapabilitySummary {
  return {
    platform: "telegram",
    supportsText: true,
    supportsReactions: true,
    availableReactions,
    supportsReplies: true,
    supportsFiles: true,
    supportsInlineButtons: true,
    supportsRichMessage: true,
    supportsMiniApps: false,
    notes: ["polling transport; Mini Apps require public HTTPS"],
  };
}

export function styleGuardFromConfig(config: ParamConfig): StyleGuardPolicy {
  return {
    version: promptVersions.styleGuard,
    enabled: config.actor.styleGuard.enabled,
    rewriteOnFailure: config.actor.styleGuard.rewriteOnFailure,
    maxVisibleMessagesPerRun: config.actor.maxVisibleMessagesPerRun,
  };
}

export function approvalPolicyFromConfig(
  config: ParamConfig,
): PromptApprovalPolicy {
  return {
    requireApprovalForConsequential:
      config.actionReview.trustedApprovalRequiredForConsequentialActions,
    safeAutoRunTools: config.actionReview.safeAutoRunTools,
  };
}

/**
 * Derive a scope-safe memory retrieval context from a session. Group/topic
 * sessions retrieve group memory; DM sessions retrieve session (+ user when the
 * partner's Param user id is known). Scope isolation is enforced downstream.
 */
export function memoryRetrievalContextFromSession(
  session: Pick<Session, "id" | "routeType" | "platformChatId">,
  paramUserId?: string,
): MemoryRetrievalContext {
  const routeType = session.routeType as MemoryRetrievalContext["routeType"];
  return {
    routeType,
    sessionId: session.id,
    paramUserId: routeType === "dm" ? paramUserId : undefined,
    groupChatId:
      routeType === "group" || routeType === "topic"
        ? session.platformChatId
        : undefined,
  };
}
