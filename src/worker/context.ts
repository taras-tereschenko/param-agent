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
 * sessions retrieve group memory; DM sessions retrieve session + user memory.
 *
 * In a Telegram private chat the chat id IS the user's id, so we key DM
 * user-scoped memory by `platformChatId`. The memory WRITE path binds the same
 * way (see dispatch.boundMemorySubjectRef), so store and retrieve are
 * consistent. Scope isolation is still enforced downstream in selectMemories.
 */
export function memoryRetrievalContextFromSession(
  session: Pick<Session, "id" | "routeType" | "platformChatId">,
): MemoryRetrievalContext {
  const routeType = session.routeType as MemoryRetrievalContext["routeType"];
  return {
    routeType,
    sessionId: session.id,
    paramUserId: routeType === "dm" ? session.platformChatId : undefined,
    groupChatId:
      routeType === "group" || routeType === "topic"
        ? session.platformChatId
        : undefined,
  };
}
