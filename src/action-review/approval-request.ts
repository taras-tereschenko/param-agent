import type { ParamDb } from "../db/client";
import { approvalsRepository, auditRepository } from "../db/repositories";
import type { ActorRef } from "../contracts/common";
import type { ApprovalRequestOutputPayload } from "../contracts/action-review";
import { computeProposalHash } from "./policy";

export type CreateApprovalRequestInput = {
  sessionId: string;
  actorRunId?: string | null;
  request: ApprovalRequestOutputPayload;
  requestedBy?: ActorRef;
  requiredTrustScope: string;
  expiresAt?: Date | null;
};

export type CreateApprovalRequestResult = {
  approvalId: string;
  proposalHash: string;
  existed: boolean;
};

/**
 * Create (or reuse) a pending approval for an exact proposed action. Dedupes on
 * the exact-proposal hash within the session so a repeated request does not
 * create a second pending approval.
 */
export async function createApprovalRequest(
  db: ParamDb,
  input: CreateApprovalRequestInput,
): Promise<CreateApprovalRequestResult> {
  const proposalHash = computeProposalHash(input.request.proposedAction);

  const existing = await approvalsRepository.findPendingByHash(
    db,
    input.sessionId,
    proposalHash,
  );
  if (existing) {
    return { approvalId: existing.id, proposalHash, existed: true };
  }

  const approval = await approvalsRepository.createApproval(db, {
    sessionId: input.sessionId,
    requesterEventIds: input.request.requesterEventIds,
    requestedBy: (input.requestedBy ?? input.request.requestedBy) as
      | Record<string, unknown>
      | undefined,
    actionKind: String(input.request.actionKind),
    title: input.request.title,
    summary: input.request.summary,
    exactPreview: input.request.exactPreview,
    proposedAction: input.request.proposedAction,
    proposalHash,
    requiredTrustScope: input.requiredTrustScope,
    status: "pending",
    createdByRunId: input.actorRunId ?? null,
    expiresAt: input.expiresAt ?? null,
  });

  await auditRepository.writeAudit(db, {
    eventType: "action_review.requested",
    sessionId: input.sessionId,
    approvalId: approval.id,
    actorRunId: input.actorRunId ?? null,
    summary: `approval requested: ${input.request.title}`,
    target: { actionKind: input.request.actionKind, proposalHash },
  });

  return { approvalId: approval.id, proposalHash, existed: false };
}
