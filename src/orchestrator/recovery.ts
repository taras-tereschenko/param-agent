import type { ParamDb } from "../db/client";
import {
  auditRepository,
  jobsRepository,
  runsRepository,
  sessionsRepository,
} from "../db/repositories";
import { ingestInternalEvent } from "./router";
import { newId } from "../contracts/ids";

export type RecoveryReport = {
  failedExpiredJobs: number;
  interruptedRuns: number;
  stuckDeliveries: number;
};

/**
 * Reboot/crash recovery scan (docs/OPS.md, docs/DATABASE.md "Recovery Queries").
 * Fails jobs whose lock expired past max attempts, interrupts actor runs whose
 * lock expired, and records the repairs as audit + system.recovery events.
 * Idempotent: safe to run repeatedly.
 */
export async function scanForRecovery(
  db: ParamDb,
  now: Date = new Date(),
): Promise<RecoveryReport> {
  const failedJobs = await jobsRepository.failExpiredRunningJobs(db, { now });

  const expiredRuns = await runsRepository.findExpiredActiveRuns(db, now);
  for (const run of expiredRuns) {
    await runsRepository.markRunStatus(db, run.id, "interrupted", now);
    await sessionsRepository.setActiveRun(db, run.sessionId, null);
    await ingestInternalEvent(db, {
      sessionId: run.sessionId,
      eventType: "system.recovery",
      dedupeKey: `system.recovery:run:${run.id}:${run.lockExpiresAt?.toISOString() ?? now.toISOString()}`,
      source: { kind: "system", component: "recovery" },
      payload: {
        kind: "actor_run_interrupted",
        summary: `actor run ${run.id} interrupted after lock expiry`,
        repaired: [run.id],
      },
    });
    await auditRepository.writeAudit(db, {
      eventType: "recovery.run_interrupted",
      sessionId: run.sessionId,
      actorRunId: run.id,
      summary: `interrupted stale actor run ${run.id}`,
    });
  }

  const stuckDeliveries = await runsRepository.findStuckDeliveryAttempts(db);
  for (const attempt of stuckDeliveries) {
    await runsRepository.failDeliveryAttempt(
      db,
      attempt.id,
      { code: "recovery", message: "delivery interrupted by restart", retryable: true },
      now,
    );
  }

  if (failedJobs.length > 0 || expiredRuns.length > 0) {
    await auditRepository.writeAudit(db, {
      eventType: "recovery.scan",
      summary: `recovery scan repaired ${failedJobs.length} jobs and ${expiredRuns.length} runs`,
      metadata: {
        scanId: newId(),
        failedJobs: failedJobs.length,
        interruptedRuns: expiredRuns.length,
        stuckDeliveries: stuckDeliveries.length,
      },
    });
  }

  return {
    failedExpiredJobs: failedJobs.length,
    interruptedRuns: expiredRuns.length,
    stuckDeliveries: stuckDeliveries.length,
  };
}
