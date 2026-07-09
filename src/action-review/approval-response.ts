import type { ParamDb } from "../db/client";
import { approvalsRepository, auditRepository } from "../db/repositories";
import type { ActorRef } from "../contracts/common";
import { proposalChanged } from "./policy";

export type ApprovalResponseInput = {
  approvalId: string;
  decision: "approved" | "rejected" | "revoked";
  approver: ActorRef;
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
    | "proposal_changed";
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
