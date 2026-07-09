import type { AmbientWakePayload } from "../contracts/events";
import { ambientWakeDedupeKey, buildAmbientWakePayload } from "./ambient-wakes";
import {
  ambientWakeAllowed,
  withinActiveHours,
  type ActiveHours,
  type CooldownContext,
  type CooldownPolicy,
} from "./cooldowns";
import type { ScheduleSpec } from "./schedules";

/**
 * Local port for enqueuing durable jobs. The scheduler does not depend on the
 * orchestrator/worker directly; the caller wires a real queue in.
 */
export interface JobEnqueue {
  enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts: { dueAt: Date; idempotencyKey: string },
  ): Promise<void>;
}

export type DueSchedule = {
  id: string;
  sessionId: string;
  intent: AmbientWakePayload["intent"];
  nextFireAt: string;
  spec: ScheduleSpec;
  cooldown: CooldownContext;
  cooldownPolicy: CooldownPolicy;
  activeHours?: ActiveHours;
};

/**
 * Fire every schedule that is due (nextFireAt <= now).
 *
 * For each due schedule: check active hours, then cooldown/flood guards. If the
 * wake is allowed, enqueue a durable "ambient_wake" job keyed by a stable
 * dedupe idempotency key (schedule + planned_for + session) so a retry or a
 * post-restart re-scan can never enqueue the same wake twice. Otherwise record
 * the schedule as skipped with a reason.
 *
 * Pure except for the injected `enqueue` effect.
 */
export async function fireDueSchedules(
  schedules: DueSchedule[],
  enqueue: JobEnqueue,
  now: Date,
): Promise<{ fired: string[]; skipped: { id: string; reason: string }[] }> {
  const fired: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const schedule of schedules) {
    const plannedFor = new Date(schedule.nextFireAt);
    if (plannedFor.getTime() > now.getTime()) {
      skipped.push({ id: schedule.id, reason: "not_due" });
      continue;
    }

    if (!withinActiveHours(schedule.activeHours, now)) {
      skipped.push({ id: schedule.id, reason: "outside_active_hours" });
      continue;
    }

    const gate = ambientWakeAllowed(
      schedule.cooldown,
      schedule.cooldownPolicy,
      now,
    );
    if (!gate.allowed) {
      skipped.push({ id: schedule.id, reason: gate.reason });
      continue;
    }

    const payload = buildAmbientWakePayload({
      intent: schedule.intent,
      reason: `scheduled ${schedule.intent}`,
      scheduleId: schedule.id,
      sessionId: schedule.sessionId,
      cooldown: schedule.cooldown,
    });

    const idempotencyKey = ambientWakeDedupeKey(
      schedule.id,
      schedule.nextFireAt,
      schedule.sessionId,
    );

    await enqueue.enqueue(
      "ambient_wake",
      { ...payload, sessionId: schedule.sessionId },
      { dueAt: plannedFor, idempotencyKey },
    );

    fired.push(schedule.id);
  }

  return { fired, skipped };
}
