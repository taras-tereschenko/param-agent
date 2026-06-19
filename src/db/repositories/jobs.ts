import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import type { ParamDb } from "../client";
import { jobs, jobStatuses, type Job, type NewJob } from "../schema";

export const jobStatusSchema = z.enum(jobStatuses);

export type ClaimJobOptions = {
  workerId: string;
  leaseSeconds: number;
  now?: Date;
};

export type ClaimNextJobResult = {
  job: Job | undefined;
  recoveredExpiredJobs: Job[];
};

export async function enqueueJob(db: ParamDb, job: NewJob): Promise<Job> {
  const [inserted] = await db
    .insert(jobs)
    .values(job)
    .onConflictDoUpdate({
      target: jobs.idempotencyKey,
      targetWhere: sql`${jobs.idempotencyKey} is not null`,
      set: {
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!inserted) {
    throw new Error("job insert did not return a row");
  }

  return inserted;
}

export async function claimNextJob(
  db: ParamDb,
  options: ClaimJobOptions,
): Promise<Job | undefined> {
  const result = await claimNextJobWithRecovery(db, options);
  return result.job;
}

export async function claimNextJobWithRecovery(
  db: ParamDb,
  options: ClaimJobOptions,
): Promise<ClaimNextJobResult> {
  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + options.leaseSeconds * 1000);

  return db.transaction(async (tx) => {
    const expiredFinalAttemptJobs = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "running"),
          lte(jobs.lockExpiresAt, now),
          gte(jobs.attemptCount, jobs.maxAttempts),
        ),
      )
      .orderBy(asc(jobs.lockExpiresAt), asc(jobs.createdAt))
      .limit(100)
      .for("update", { skipLocked: true });

    const recoveredExpiredJobs =
      expiredFinalAttemptJobs.length === 0
        ? []
        : await tx
            .update(jobs)
            .set({
              status: "failed",
              lockOwner: null,
              lockExpiresAt: null,
              completedAt: now,
              lastError: {
                kind: "max_attempts_exhausted",
                message: "job lock expired after max attempts",
              },
              updatedAt: now,
            })
            .where(
              inArray(
                jobs.id,
                expiredFinalAttemptJobs.map((job) => job.id),
              ),
            )
            .returning();

    const [claimable] = await tx
      .select()
      .from(jobs)
      .where(
        or(
          and(
            eq(jobs.status, "queued"),
            lte(jobs.dueAt, now),
            lt(jobs.attemptCount, jobs.maxAttempts),
          ),
          and(
            eq(jobs.status, "running"),
            lte(jobs.lockExpiresAt, now),
            lt(jobs.attemptCount, jobs.maxAttempts),
          ),
        ),
      )
      .orderBy(desc(jobs.priority), asc(jobs.dueAt), asc(jobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!claimable) {
      return {
        job: undefined,
        recoveredExpiredJobs,
      };
    }

    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "running",
        lockOwner: options.workerId,
        lockExpiresAt: leaseExpiresAt,
        attemptCount: sql`${jobs.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(eq(jobs.id, claimable.id))
      .returning();

    return {
      job: claimed,
      recoveredExpiredJobs,
    };
  });
}

export type FailExpiredRunningJobsOptions = {
  now?: Date;
  limit?: number;
};

export async function failExpiredRunningJobs(
  db: ParamDb,
  options: FailExpiredRunningJobsOptions = {},
): Promise<Job[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;

  return db.transaction(async (tx) => {
    const expiredJobs = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "running"),
          lte(jobs.lockExpiresAt, now),
          gte(jobs.attemptCount, jobs.maxAttempts),
        ),
      )
      .orderBy(asc(jobs.lockExpiresAt), asc(jobs.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (expiredJobs.length === 0) {
      return [];
    }

    return tx
      .update(jobs)
      .set({
        status: "failed",
        lockOwner: null,
        lockExpiresAt: null,
        completedAt: now,
        lastError: {
          kind: "max_attempts_exhausted",
          message: "job lock expired after max attempts",
        },
        updatedAt: now,
      })
      .where(
        inArray(
          jobs.id,
          expiredJobs.map((job) => job.id),
        ),
      )
      .returning();
  });
}

export type CompleteJobOptions = {
  workerId: string;
  now?: Date;
};

export async function completeJob(
  db: ParamDb,
  jobId: string,
  options: CompleteJobOptions,
): Promise<Job | undefined> {
  const now = options.now ?? new Date();
  const [completed] = await db
    .update(jobs)
    .set({
      status: "completed",
      lockOwner: null,
      lockExpiresAt: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.lockOwner, options.workerId),
        gt(jobs.lockExpiresAt, now),
      ),
    )
    .returning();

  return completed;
}

export type FailJobOptions = {
  workerId: string;
  error: Record<string, unknown>;
  retryAt?: Date;
  now?: Date;
};

export async function failJob(
  db: ParamDb,
  jobId: string,
  options: FailJobOptions,
): Promise<Job | undefined> {
  const now = options.now ?? new Date();

  return db.transaction(async (tx) => {
    const [runningJob] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.status, "running"),
          eq(jobs.lockOwner, options.workerId),
          gt(jobs.lockExpiresAt, now),
        ),
      )
      .limit(1)
      .for("update");

    if (!runningJob) {
      return undefined;
    }

    const shouldRetry =
      options.retryAt !== undefined &&
      runningJob.attemptCount < runningJob.maxAttempts;

    const [failed] = await tx
      .update(jobs)
      .set({
        status: shouldRetry ? "queued" : "failed",
        dueAt: shouldRetry ? options.retryAt : runningJob.dueAt,
        lockOwner: null,
        lockExpiresAt: null,
        completedAt: shouldRetry ? null : now,
        lastError: options.error,
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId))
      .returning();

    return failed;
  });
}

export async function findExpiredRunningJobs(
  db: ParamDb,
  now = new Date(),
  limit = 100,
): Promise<Job[]> {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lte(jobs.lockExpiresAt, now)))
    .orderBy(asc(jobs.lockExpiresAt), asc(jobs.createdAt))
    .limit(limit);
}

export const jobsRepository = {
  claimNextJob,
  claimNextJobWithRecovery,
  completeJob,
  enqueueJob,
  failJob,
  failExpiredRunningJobs,
  findExpiredRunningJobs,
};
