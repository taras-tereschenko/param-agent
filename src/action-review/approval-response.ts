import type { ParamDb } from "../db/client";
import { approvalsRepository, auditRepository } from "../db/repositories";
import type { ActorRef } from "../contracts/common";
import { proposalChanged } from "./policy";

export type ApprovalResponseInput = {
  approvalId: string;
  decision: "approved" | "rejected" | "revoked";
  approver: ActorRef;
  /**
   * Whether the approver was verified as a trusted user for the approval's
   * required scope. The caller MUST compute this (isTrustedForScope); an
   * approval is never resolved by an untrusted sender.
   */
  approverIsTrusted: boolean;
  decisionEventId?: string | null;
  /** If the live proposed action changed, approval is invalid — needs a new one. */
  currentProposedAction?: unknown;
  now?: Date;
};

export type ApprovalResolution = {
  status:
    | "approved"
    | "rejected"
    | "revoked"
    | "not_found"
    | "already_decided"
    | "proposal_changed"
    | "not_trusted"
    | "self_approval";
  /** The exact approved action, only when status === "approved". */
  action?: Record<string, unknown>;
  reason: string;
};

/**
 * Apply a trusted-user decision to a pending approval. Enforces exact-proposal
 * approval (a changed proposal invalidates the approval) and is replay-safe
 * (a second decision on an already-decided approval is a no-op).
 */
export async function resolveApprovalResponse(
  db: ParamDb,
  input: ApprovalResponseInput,
): Promise<ApprovalResolution> {
  const approval = await approvalsRepository.getApprovalById(
    db,
    input.approvalId,
  );
  if (!approval) {
    return { status: "not_found", reason: "approval not found" };
  }
  if (!input.approverIsTrusted) {
    // Only trusted users with the required scope can resolve an approval.
    // A merely-allowed (untrusted) sender never approves a consequential action.
    return {
      status: "not_trusted",
      reason: "approver is not a trusted user for the required scope",
    };
  }
  // Two-person rule: the requester must not APPROVE their own request. (Denying
  // your own request only cancels it, so that is allowed.)
  if (input.decision === "approved" && input.approver.kind === "user") {
    const requester = approval.requestedBy as
      | { platform?: string; platformUserId?: string }
      | null
      | undefined;
    if (
      requester?.platformUserId &&
      requester.platform === input.approver.platform &&
      requester.platformUserId === input.approver.platformUserId
    ) {
      return {
        status: "self_approval",
        reason:
          "the requester cannot approve their own request; a different trusted user must approve",
      };
    }
  }
  if (approval.status !== "pending") {
    return {
      status: "already_decided",
      reason: `approval already ${approval.status}`,
    };
  }
  if (
    input.currentProposedAction !== undefined &&
    proposalChanged(approval.proposalHash, input.currentProposedAction)
  ) {
    return {
      status: "proposal_changed",
      reason: "proposed action changed; a fresh approval is required",
    };
  }

  const updated = await approvalsRepository.decideApproval(db, input.approvalId, {
    status: input.decision,
    decidedBy: input.approver as unknown as Record<string, unknown>,
    decisionEventId: input.decisionEventId ?? null,
    now: input.now,
  });
  if (!updated) {
    // Lost the race — someone else decided it first.
    return { status: "already_decided", reason: "approval already decided" };
  }

  await auditRepository.writeAudit(db, {
    eventType: `action_review.${input.decision}`,
    sessionId: approval.sessionId,
    approvalId: approval.id,
    actor: input.approver as unknown as Record<string, unknown>,
    summary: `approval ${input.decision}: ${approval.title}`,
  });

  return {
    status: input.decision,
    action:
      input.decision === "approved"
        ? (approval.proposedAction as Record<string, unknown>)
        : undefined,
    reason: `approval ${input.decision}`,
  };
}
