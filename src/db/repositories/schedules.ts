import { and, eq, isNotNull, lte } from "drizzle-orm";

import type { AmbientWakePayload } from "../../contracts/events";
import type { ActiveHours, CooldownPolicy } from "../../scheduler/cooldowns";
import type { DueSchedule } from "../../scheduler/due-jobs";
import { computeNextFire, type ScheduleSpec } from "../../scheduler/schedules";
import type { ParamDb } from "../client";
import { schedules, sessions } from "../schema";

const DEFAULT_COOLDOWN: CooldownPolicy = {
  minSecondsBetweenProactive: 3600,
  maxProactivePerDay: 6,
  quietIfBusy: true,
};

/**
 * Load active schedules whose nextFireAt has passed, shaped for
 * fireDueSchedules. sessionBusy is derived from the session's active run so a
 * proactive wake never fires mid-turn (the cooldown policy also gates it).
 */
async function listDueSchedules(db: ParamDb, now: Date): Promise<DueSchedule[]> {
  const rows = await db
    .select({
      id: schedules.id,
      sessionId: schedules.sessionId,
      intent: schedules.intent,
      nextFireAt: schedules.nextFireAt,
      scheduleSpec: schedules.scheduleSpec,
      activeHours: schedules.activeHours,
      cooldownPolicy: schedules.cooldownPolicy,
      lastFiredAt: schedules.lastFiredAt,
      activeRunId: sessions.activeRunId,
    })
    .from(schedules)
    .innerJoin(sessions, eq(schedules.sessionId, sessions.id))
    .where(
      and(
        eq(schedules.status, "active"),
        isNotNull(schedules.nextFireAt),
        lte(schedules.nextFireAt, now),
      ),
    )
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    intent: row.intent as AmbientWakePayload["intent"],
    nextFireAt: (row.nextFireAt as Date).toISOString(),
    spec: (row.scheduleSpec ?? {}) as ScheduleSpec,
    activeHours: (row.activeHours ?? undefined) as ActiveHours | undefined,
    cooldownPolicy: {
      ...DEFAULT_COOLDOWN,
      ...((row.cooldownPolicy ?? {}) as Partial<CooldownPolicy>),
    },
    cooldown: {
      lastProactiveAt: row.lastFiredAt
        ? (row.lastFiredAt as Date).toISOString()
        : undefined,
      proactiveMessagesToday: 0,
      sessionBusy: row.activeRunId != null,
    },
  }));
}

/** Advance a schedule after it fires: record lastFiredAt + the next fire time
 *  (or complete a one-shot with no next fire). */
async function recordScheduleFired(
  db: ParamDb,
  scheduleId: string,
  spec: ScheduleSpec,
  now: Date,
): Promise<void> {
  const next = computeNextFire(spec, now, now);
  await db
    .update(schedules)
    .set({
      lastFiredAt: now,
      nextFireAt: next,
      status: next ? "active" : "completed",
      updatedAt: now,
    })
    .where(eq(schedules.id, scheduleId));
}

export const schedulesRepository = { listDueSchedules, recordScheduleFired };
