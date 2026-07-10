import { and, eq, lte } from "drizzle-orm";

import type { ParamDb } from "../client";
import {
  approvalNotifications,
  approvals,
  type Approval,
  type NewApproval,
  type NewApprovalNotification,
} from "../schema";

export async function createApproval(
  db: ParamDb,
  input: NewApproval,
): Promise<Approval> {
  const [row] = await db.insert(approvals).values(input).returning();
  if (!row) {
    throw new Error("approval insert failed");
  }
  return row;
}

export async function getApprovalById(
  db: ParamDb,
  id: string,
): Promise<Approval | undefined> {
  const [row] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, id))
    .limit(1);
  return row;
}

/** Find an existing pending approval for the exact same proposal (dedupe). */
export async function findPendingByHash(
  db: ParamDb,
  sessionId: string,
  proposalHash: string,
): Promise<Approval | undefined> {
  const [row] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.sessionId, sessionId),
        eq(approvals.proposalHash, proposalHash),
        eq(approvals.status, "pending"),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Apply a decision, but only if the approval is still pending. Returns the
 * updated row, or undefined if it was already decided/expired (replay-safe).
 */
export async function decideApproval(
  db: ParamDb,
  id: string,
  input: {
    status: "approved" | "rejected" | "revoked";
    decidedBy: Record<string, unknown>;
    decisionEventId?: string | null;
    now?: Date;
  },
): Promise<Approval | undefined> {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(approvals)
    .set({
      status: input.status,
      decidedBy: input.decidedBy,
      decisionEventId: input.decisionEventId ?? null,
      decidedAt: now,
      updatedAt: now,
    })
    .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
    .returning();
  return row;
}

/** Pending approvals for a session, newest first (for trusted-reply routing). */
export async function findPendingForSession(
  db: ParamDb,
  sessionId: string,
): Promise<Approval[]> {
  return db
    .select()
    .from(approvals)
    .where(
      and(eq(approvals.sessionId, sessionId), eq(approvals.status, "pending")),
    );
}

export async function expireDueApprovals(
  db: ParamDb,
  now: Date = new Date(),
): Promise<Approval[]> {
  return db
    .update(approvals)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(approvals.status, "pending"), lte(approvals.expiresAt, now)))
    .returning();
}

export async function createApprovalNotification(
  db: ParamDb,
  input: NewApprovalNotification,
): Promise<void> {
  await db.insert(approvalNotifications).values(input);
}

export const approvalsRepository = {
  createApproval,
  getApprovalById,
  findPendingByHash,
  findPendingForSession,
  decideApproval,
  expireDueApprovals,
  createApprovalNotification,
};
