import type {
  ActionReviewDecision,
  RiskLabel,
  TrustScope,
} from "../contracts/action-review";
import { hashJson } from "../shared/json";
import type { RiskClassification } from "./classify";

const RISK_RANK: Record<RiskLabel, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function riskAtMost(risk: RiskLabel, ceiling: RiskLabel): boolean {
  return RISK_RANK[risk] <= RISK_RANK[ceiling];
}

export type ActionReviewInput = {
  classification: RiskClassification;
  /** Sender identity was verified (id matches the requesting event). */
  requesterVerified: boolean;
  /** Requester is a trusted user whose scope covers the required scope. */
  requesterTrustedInScope: boolean;
  /** The tool call is on the small explicit safe auto-run list. */
  isSafeAutoRun: boolean;
  /** Max risk a trusted-in-scope requester may auto-run (default "medium"). */
  autoReviewMaxRiskForTrusted?: RiskLabel;
};

/**
 * The auto-review pass. It ALWAYS verifies sender id, action target, trust
 * scope, risk, and policy. Trusted users get auto-review mode within their trust
 * scope for lower-risk actions; high/critical actions still require explicit
 * approval. Non-trusted consequential requests need approval. This is Param's
 * own review — runtime-native approvals never replace it.
 */
export function decideActionReview(
  input: ActionReviewInput,
): ActionReviewDecision {
  const { classification } = input;
  const ceiling = input.autoReviewMaxRiskForTrusted ?? "medium";

  const base = {
    risk: classification.risk,
    requiredTrustScope: classification.requiredTrustScope,
    senderVerified: input.requesterVerified,
    requesterIsTrusted: input.requesterTrustedInScope,
  };

  if (!input.requesterVerified) {
    return {
      ...base,
      decision: "denied",
      reasonCode: "sender_unverified",
      reason: "could not verify the requesting sender id",
    };
  }

  if (!classification.consequential) {
    return {
      ...base,
      decision: "auto_allowed",
      reasonCode: "safe_read_only",
      reason: "read-only safe action",
    };
  }

  if (input.isSafeAutoRun && classification.risk === "safe") {
    return {
      ...base,
      decision: "auto_allowed",
      reasonCode: "safe_auto_run_list",
      reason: "tool is on the explicit safe auto-run list",
    };
  }

  if (
    input.requesterTrustedInScope &&
    riskAtMost(classification.risk, ceiling)
  ) {
    return {
      ...base,
      decision: "auto_allowed",
      reasonCode: "trusted_auto_review_in_scope",
      reason: `trusted user auto-review within scope (risk ${classification.risk} <= ${ceiling})`,
    };
  }

  return {
    ...base,
    decision: "needs_approval",
    reasonCode: "consequential_needs_approval",
    reason: `consequential action (risk ${classification.risk}) requires trusted approval`,
  };
}

/** Exact-proposal hash: approval is only valid for this exact action. */
export function computeProposalHash(proposedAction: unknown): string {
  return hashJson(proposedAction);
}

/**
 * True when the proposed action changed from what was approved, requiring a
 * fresh approval (docs/ACTION_REVIEW.md exact-proposal rule).
 */
export function proposalChanged(
  approvedHash: string,
  currentProposedAction: unknown,
): boolean {
  return approvedHash !== computeProposalHash(currentProposedAction);
}

export type ApproverRoutingInput = {
  trustedApproverIdsInChat: string[];
  configuredDmApproverIds: string[];
};

export type ApproverRouting = {
  mode: "in_chat" | "dm";
  approverPlatformUserIds: string[];
  reason: string;
};

/**
 * In a group, a non-trusted requester's change asks trusted approvers present
 * in the same chat/topic. If none are present, Param DMs configured trusted
 * users. Requester and approver are always separate.
 */
export function chooseApprovers(
  input: ApproverRoutingInput,
): ApproverRouting {
  if (input.trustedApproverIdsInChat.length > 0) {
    return {
      mode: "in_chat",
      approverPlatformUserIds: input.trustedApproverIdsInChat,
      reason: "trusted approver present in this conversation",
    };
  }
  return {
    mode: "dm",
    approverPlatformUserIds: input.configuredDmApproverIds,
    reason: "no trusted approver present; requesting approval by DM",
  };
}
