import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { describe, expect, test } from "bun:test";

import { createDbClient } from "../src/db/client";
import {
  checkDatabaseConnection,
  ensureDatabaseExtensions,
  listMissingDatabaseExtensions,
} from "../src/db/extensions";
import { eventsRepository, jobsRepository } from "../src/db/repositories";
import {
  auditLog,
  channelAccounts,
  platformChats,
  sessionParticipants,
  sessions,
  userAccounts,
  users,
  jobs,
} from "../src/db/schema";
import type { ParamConfig } from "../src/config/schema";
import baseConfig from "../param.config";

const databaseUrl = Bun.env.PARAM_TEST_DATABASE_URL;

if (!databaseUrl) {
  describe("database integration", () => {
    test("requires PARAM_TEST_DATABASE_URL", () => {
      throw new Error(
        "set PARAM_TEST_DATABASE_URL to run database integration tests",
      );
    });
  });
} else {
  describe("database integration", () => {
    test("persists events, claims jobs, and records audit logs", async () => {
      const config: ParamConfig = {
        ...baseConfig,
        database: {
          ...baseConfig.database,
          url: { env: "PARAM_TEST_DATABASE_URL" },
        },
      };
      const db = createDbClient(config);
      const suffix = randomUUID();

      try {
        await checkDatabaseConnection(db);
        await ensureDatabaseExtensions(db);
        await migrate(db, { migrationsFolder: "./drizzle/migrations" });

        expect(await listMissingDatabaseExtensions(db)).toEqual([]);

        const [user] = await db
          .insert(users)
          .values({ displayName: "Param test user" })
          .returning();
        expect(user).toBeDefined();

        const [userAccount] = await db
          .insert(userAccounts)
          .values({
            userId: user!.id,
            platform: "telegram",
            platformUserId: `user-${suffix}`,
          })
          .returning();
        expect(userAccount).toBeDefined();

        const [channelAccount] = await db
          .insert(channelAccounts)
          .values({
            platform: "telegram",
            label: `test-${suffix}`,
            config: { botToken: { env: "TELEGRAM_BOT_TOKEN" } },
          })
          .returning();
        expect(channelAccount).toBeDefined();

        const [platformChat] = await db
          .insert(platformChats)
          .values({
            platform: "telegram",
            accountId: channelAccount!.id,
            platformChatId: `chat-${suffix}`,
            chatType: "private",
          })
          .returning();
        expect(platformChat).toBeDefined();

        const [session] = await db
          .insert(sessions)
          .values({
            sessionKey: `telegram:dm:${suffix}`,
            platform: "telegram",
            routeType: "dm",
            platformChatId: platformChat!.platformChatId,
          })
          .returning();
        expect(session).toBeDefined();

        const [participant] = await db
          .insert(sessionParticipants)
          .values({
            sessionId: session!.id,
            userId: user!.id,
            platformUserId: userAccount!.platformUserId,
          })
          .returning();
        expect(participant).toBeDefined();

        const rawPayload = await eventsRepository.insertRawPayload(db, {
          provider: "telegram",
          kind: "update",
          storage: "inline",
          json: { updateId: suffix },
        });
        expect(rawPayload.id).toBeTruthy();

        const eventInput = {
          type: "chat.message.received",
          sessionId: session!.id,
          direction: "inbound",
          visibility: "chat_visible",
          occurredAt: new Date(),
          receivedAt: new Date(),
          source: {
            kind: "user",
            platform: "telegram",
            platformUserId: userAccount!.platformUserId,
          },
          platform: {
            platform: "telegram",
            chatId: platformChat!.platformChatId,
          },
          dedupeKey: `telegram:update:${suffix}`,
          payload: { text: "yo" },
          raw: {
            provider: "telegram",
            kind: "update",
            storage: "database",
            ref: rawPayload.id,
          },
        } as const;

        const firstEvent = await eventsRepository.insertEvent(db, eventInput);
        const duplicateEvent = await eventsRepository.insertEvent(db, eventInput);
        expect(firstEvent.inserted).toBe(true);
        expect(duplicateEvent.inserted).toBe(false);
        expect(duplicateEvent.event.id).toBe(firstEvent.event.id);

        const newestEvent = await eventsRepository.insertEvent(db, {
          ...eventInput,
          occurredAt: new Date(Date.now() + 1000),
          dedupeKey: `telegram:update:newest:${suffix}`,
          payload: { text: "newest" },
        });
        expect(newestEvent.inserted).toBe(true);

        const sharedOccurredAt = new Date(Date.now() + 2000);
        const olderPersistedEvent = await eventsRepository.insertEvent(db, {
          ...eventInput,
          occurredAt: sharedOccurredAt,
          persistedAt: new Date("2026-01-01T00:00:00.000Z"),
          dedupeKey: `telegram:update:same-time-older:${suffix}`,
          payload: { text: "same time older persisted" },
        });
        const newerPersistedEvent = await eventsRepository.insertEvent(db, {
          ...eventInput,
          occurredAt: sharedOccurredAt,
          persistedAt: new Date("2026-01-01T00:00:01.000Z"),
          dedupeKey: `telegram:update:same-time-newer:${suffix}`,
          payload: { text: "same time newer persisted" },
        });
        expect(olderPersistedEvent.inserted).toBe(true);
        expect(newerPersistedEvent.inserted).toBe(true);

        const sessionEvents = await eventsRepository.listSessionEvents(
          db,
          session!.id,
        );
        expect(sessionEvents.map((event) => event.id)).toContain(
          firstEvent.event.id,
        );
        const recentSessionEvents = await eventsRepository.listSessionEvents(
          db,
          session!.id,
          1,
        );
        expect(recentSessionEvents[0]?.id).toBe(newerPersistedEvent.event.id);

        const enqueuedJob = await jobsRepository.enqueueJob(db, {
          type: "actor_invocation",
          payload: { sessionId: session!.id },
          idempotencyKey: `job:${suffix}`,
        });
        expect(enqueuedJob.status).toBe("queued");

        const claimedJob = await jobsRepository.claimNextJob(db, {
          workerId: `worker-${suffix}`,
          leaseSeconds: 60,
        });
        expect(claimedJob?.id).toBe(enqueuedJob.id);
        expect(claimedJob?.status).toBe("running");

        await db
          .update(jobs)
          .set({ lockExpiresAt: new Date(Date.now() - 1000) })
          .where(eq(jobs.id, enqueuedJob.id));

        const expiredJobs = await jobsRepository.findExpiredRunningJobs(db);
        expect(expiredJobs.map((job) => job.id)).toContain(enqueuedJob.id);
        await db
          .update(jobs)
          .set({
            status: "failed",
            lockOwner: null,
            lockExpiresAt: null,
            completedAt: new Date(),
          })
          .where(eq(jobs.id, enqueuedJob.id));

        const finalizableJob = await jobsRepository.enqueueJob(db, {
          type: "delivery_retry",
          payload: { sessionId: session!.id },
          idempotencyKey: `job:complete:${suffix}`,
        });
        const claimedFinalizableJob = await jobsRepository.claimNextJob(db, {
          workerId: `worker-complete-${suffix}`,
          leaseSeconds: 60,
        });
        expect(claimedFinalizableJob?.id).toBe(finalizableJob.id);
        expect(
          await jobsRepository.completeJob(db, finalizableJob.id, {
            workerId: `stale-worker-${suffix}`,
          }),
        ).toBeUndefined();

        const completedJob = await jobsRepository.completeJob(
          db,
          finalizableJob.id,
          {
            workerId: `worker-complete-${suffix}`,
          },
        );
        expect(completedJob?.status).toBe("completed");

        const retryJob = await jobsRepository.enqueueJob(db, {
          type: "delivery_retry",
          payload: { sessionId: session!.id },
          idempotencyKey: `job:retry:${suffix}`,
          maxAttempts: 1,
        });
        const claimedRetryJob = await jobsRepository.claimNextJob(db, {
          workerId: `worker-retry-${suffix}`,
          leaseSeconds: 60,
        });
        expect(claimedRetryJob?.id).toBe(retryJob.id);

        const failedRetryJob = await jobsRepository.failJob(db, retryJob.id, {
          workerId: `worker-retry-${suffix}`,
          error: { message: "boom" },
          retryAt: new Date(),
        });
        expect(failedRetryJob?.status).toBe("failed");

        const crashedFinalAttemptJob = await jobsRepository.enqueueJob(db, {
          type: "delivery_retry",
          payload: { sessionId: session!.id },
          idempotencyKey: `job:crashed-final:${suffix}`,
          maxAttempts: 1,
        });
        const claimedCrashedFinalAttemptJob =
          await jobsRepository.claimNextJob(db, {
            workerId: `worker-crashed-final-${suffix}`,
            leaseSeconds: 60,
          });
        expect(claimedCrashedFinalAttemptJob?.id).toBe(
          crashedFinalAttemptJob.id,
        );
        await db
          .update(jobs)
          .set({ lockExpiresAt: new Date(Date.now() - 1000) })
          .where(eq(jobs.id, crashedFinalAttemptJob.id));
        expect(
          await jobsRepository.claimNextJob(db, {
            workerId: `worker-after-crash-${suffix}`,
            leaseSeconds: 60,
          }),
        ).toBeUndefined();
        const [recoveredCrashedFinalAttemptJob] = await db
          .select()
          .from(jobs)
          .where(eq(jobs.id, crashedFinalAttemptJob.id))
          .limit(1);
        expect(recoveredCrashedFinalAttemptJob?.status).toBe("failed");

        const [auditRecord] = await db
          .insert(auditLog)
          .values({
            eventType: "system.recovery",
            actor: { kind: "system", component: "test" },
            sessionId: session!.id,
            eventId: firstEvent.event.id,
            summary: "integration test audit record",
          })
          .returning();
        expect(auditRecord?.id).toBeTruthy();
      } finally {
        await db.$client.close();
      }
    });
  });
}
