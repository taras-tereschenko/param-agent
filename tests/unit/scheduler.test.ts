import { describe, expect, test } from "bun:test";

import { computeNextFire } from "../../src/scheduler/schedules";
import {
  ambientWakeAllowed,
  withinActiveHours,
  type CooldownContext,
  type CooldownPolicy,
} from "../../src/scheduler/cooldowns";
import {
  buildAmbientWakePayload,
  ambientWakeDedupeKey,
  DEFAULT_ALLOWED_OUTPUTS,
} from "../../src/scheduler/ambient-wakes";
import {
  fireDueSchedules,
  type DueSchedule,
  type JobEnqueue,
} from "../../src/scheduler/due-jobs";

type EnqueueCall = {
  type: string;
  payload: Record<string, unknown>;
  opts: { dueAt: Date; idempotencyKey: string };
};

function recordingEnqueue(): { enqueue: JobEnqueue; calls: EnqueueCall[] } {
  const calls: EnqueueCall[] = [];
  const enqueue: JobEnqueue = {
    async enqueue(type, payload, opts) {
      calls.push({ type, payload, opts });
    },
  };
  return { enqueue, calls };
}

const allowedCooldown: CooldownContext = {
  proactiveMessagesToday: 0,
  sessionBusy: false,
};

const relaxedPolicy: CooldownPolicy = {
  minSecondsBetweenProactive: 3600,
  maxProactivePerDay: 5,
  quietIfBusy: true,
};

describe("computeNextFire", () => {
  const from = new Date("2026-07-10T12:00:00.000Z");

  test("interval fires from + intervalSeconds", () => {
    const next = computeNextFire({ kind: "interval", intervalSeconds: 90 }, from);
    expect(next?.toISOString()).toBe("2026-07-10T12:01:30.000Z");
  });

  test("cron_lite is treated like an interval for now", () => {
    const next = computeNextFire(
      { kind: "cron_lite", intervalSeconds: 60 },
      from,
    );
    expect(next?.toISOString()).toBe("2026-07-10T12:01:00.000Z");
  });

  test("interval without a positive intervalSeconds has no next fire", () => {
    expect(computeNextFire({ kind: "interval" }, from)).toBeNull();
    expect(
      computeNextFire({ kind: "interval", intervalSeconds: 0 }, from),
    ).toBeNull();
  });

  test("once returns atIso when in the future", () => {
    const next = computeNextFire(
      { kind: "once", atIso: "2026-07-10T13:00:00.000Z" },
      from,
    );
    expect(next?.toISOString()).toBe("2026-07-10T13:00:00.000Z");
  });

  test("once in the past has already fired", () => {
    expect(
      computeNextFire({ kind: "once", atIso: "2026-07-10T11:00:00.000Z" }, from),
    ).toBeNull();
  });

  test("once with a lastFiredAt never fires again", () => {
    expect(
      computeNextFire(
        { kind: "once", atIso: "2026-07-10T13:00:00.000Z" },
        from,
        new Date("2026-07-10T13:00:00.000Z"),
      ),
    ).toBeNull();
  });
});

describe("ambientWakeAllowed", () => {
  const now = new Date("2026-07-10T14:00:00.000Z");

  test("allows when nothing gates the wake", () => {
    const result = ambientWakeAllowed(allowedCooldown, relaxedPolicy, now);
    expect(result.allowed).toBe(true);
  });

  test("denies within the cooldown window", () => {
    const ctx: CooldownContext = {
      proactiveMessagesToday: 0,
      sessionBusy: false,
      lastProactiveAt: "2026-07-10T13:30:00.000Z", // 30 min ago < 60 min gap
    };
    const result = ambientWakeAllowed(ctx, relaxedPolicy, now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cooldown_active");
  });

  test("allows once the cooldown window has passed", () => {
    const ctx: CooldownContext = {
      proactiveMessagesToday: 0,
      sessionBusy: false,
      lastProactiveAt: "2026-07-10T12:00:00.000Z", // 2h ago > 60 min gap
    };
    expect(ambientWakeAllowed(ctx, relaxedPolicy, now).allowed).toBe(true);
  });

  test("denies over the daily cap", () => {
    const ctx: CooldownContext = {
      proactiveMessagesToday: 5,
      sessionBusy: false,
    };
    const result = ambientWakeAllowed(ctx, relaxedPolicy, now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily_cap_reached");
  });

  test("denies when the session is busy and policy asks to stay quiet", () => {
    const ctx: CooldownContext = {
      proactiveMessagesToday: 0,
      sessionBusy: true,
    };
    const result = ambientWakeAllowed(ctx, relaxedPolicy, now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("session_busy");
  });

  test("busy does not block when quietIfBusy is false", () => {
    const ctx: CooldownContext = {
      proactiveMessagesToday: 0,
      sessionBusy: true,
    };
    expect(
      ambientWakeAllowed(ctx, { ...relaxedPolicy, quietIfBusy: false }, now)
        .allowed,
    ).toBe(true);
  });
});

describe("withinActiveHours", () => {
  test("no active hours means always active", () => {
    expect(withinActiveHours(undefined, new Date("2026-07-10T03:00:00Z"))).toBe(
      true,
    );
  });

  test("inside and outside a simple UTC window", () => {
    const hours = { startHour: 10, endHour: 23 };
    expect(withinActiveHours(hours, new Date("2026-07-10T14:00:00Z"))).toBe(
      true,
    );
    expect(withinActiveHours(hours, new Date("2026-07-10T02:00:00Z"))).toBe(
      false,
    );
  });

  test("timezone offset shifts the window", () => {
    const hours = { startHour: 10, endHour: 23, timezoneOffsetMinutes: 60 };
    // 09:30 UTC + 60 min = 10:30 local -> inside
    expect(withinActiveHours(hours, new Date("2026-07-10T09:30:00Z"))).toBe(
      true,
    );
  });

  test("wrap-around overnight window", () => {
    const hours = { startHour: 22, endHour: 6 };
    expect(withinActiveHours(hours, new Date("2026-07-10T23:00:00Z"))).toBe(
      true,
    );
    expect(withinActiveHours(hours, new Date("2026-07-10T03:00:00Z"))).toBe(
      true,
    );
    expect(withinActiveHours(hours, new Date("2026-07-10T12:00:00Z"))).toBe(
      false,
    );
  });
});

describe("buildAmbientWakePayload", () => {
  test("validates and stamps a scheduler createdBy", () => {
    const payload = buildAmbientWakePayload({
      intent: "check_in",
      reason: "quiet since morning",
      scheduleId: "sched-1",
      sessionId: "sess-1",
      cooldown: allowedCooldown,
    });

    expect(payload.intent).toBe("check_in");
    expect(payload.createdBy).toEqual({
      kind: "scheduler",
      scheduleId: "sched-1",
    });
    expect(payload.scheduleId).toBe("sched-1");
    expect(payload.maxVisibleMessages).toBe(2);
    expect(payload.allowedOutputs).toEqual([...DEFAULT_ALLOWED_OUTPUTS]);
    expect(payload.cooldownContext.sessionBusy).toBe(false);
  });

  test("respects explicit allowedOutputs", () => {
    const payload = buildAmbientWakePayload({
      intent: "joke_drop",
      reason: "chat is dead",
      scheduleId: "sched-2",
      sessionId: "sess-2",
      cooldown: allowedCooldown,
      allowedOutputs: ["no_reply", "react_to_message"],
    });
    expect(payload.allowedOutputs).toEqual(["no_reply", "react_to_message"]);
  });
});

describe("fireDueSchedules", () => {
  const now = new Date("2026-07-10T14:00:00.000Z");

  function dueSchedule(overrides: Partial<DueSchedule> = {}): DueSchedule {
    return {
      id: "sched-1",
      sessionId: "sess-1",
      intent: "check_in",
      nextFireAt: "2026-07-10T13:00:00.000Z",
      spec: { kind: "interval", intervalSeconds: 3600 },
      cooldown: allowedCooldown,
      cooldownPolicy: relaxedPolicy,
      ...overrides,
    };
  }

  test("enqueues an allowed due schedule with a stable dedupe key", async () => {
    const { enqueue, calls } = recordingEnqueue();
    const result = await fireDueSchedules([dueSchedule()], enqueue, now);

    expect(result.fired).toEqual(["sched-1"]);
    expect(result.skipped).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("ambient_wake");
    expect(calls[0]!.payload.sessionId).toBe("sess-1");
    expect(calls[0]!.opts.idempotencyKey).toBe(
      "ambient:sched-1:2026-07-10T13:00:00.000Z:sess-1",
    );
    expect(calls[0]!.opts.idempotencyKey).toBe(
      ambientWakeDedupeKey("sched-1", "2026-07-10T13:00:00.000Z", "sess-1"),
    );
  });

  test("a duplicate planned_for produces the same key (restart de-dup)", async () => {
    const { enqueue, calls } = recordingEnqueue();
    // Simulate a re-scan after restart: the same due fire is processed twice.
    await fireDueSchedules([dueSchedule()], enqueue, now);
    await fireDueSchedules([dueSchedule()], enqueue, now);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.opts.idempotencyKey).toBe(calls[1]!.opts.idempotencyKey);
  });

  test("skips schedules that are not yet due", async () => {
    const { enqueue, calls } = recordingEnqueue();
    const result = await fireDueSchedules(
      [dueSchedule({ nextFireAt: "2026-07-10T15:00:00.000Z" })],
      enqueue,
      now,
    );
    expect(result.fired).toEqual([]);
    expect(result.skipped).toEqual([{ id: "sched-1", reason: "not_due" }]);
    expect(calls).toHaveLength(0);
  });

  test("skips gated schedules with a reason and does not enqueue", async () => {
    const { enqueue, calls } = recordingEnqueue();
    const result = await fireDueSchedules(
      [
        dueSchedule({
          id: "busy",
          cooldown: { proactiveMessagesToday: 0, sessionBusy: true },
        }),
        dueSchedule({
          id: "night",
          activeHours: { startHour: 22, endHour: 6 },
        }),
      ],
      enqueue,
      now,
    );

    expect(result.fired).toEqual([]);
    expect(result.skipped).toEqual([
      { id: "busy", reason: "session_busy" },
      { id: "night", reason: "outside_active_hours" },
    ]);
    expect(calls).toHaveLength(0);
  });

  test("fires allowed and skips gated in one pass", async () => {
    const { enqueue, calls } = recordingEnqueue();
    const result = await fireDueSchedules(
      [
        dueSchedule({ id: "ok", sessionId: "s-ok" }),
        dueSchedule({
          id: "capped",
          cooldown: { proactiveMessagesToday: 5, sessionBusy: false },
        }),
      ],
      enqueue,
      now,
    );

    expect(result.fired).toEqual(["ok"]);
    expect(result.skipped).toEqual([
      { id: "capped", reason: "daily_cap_reached" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.payload.sessionId).toBe("s-ok");
  });
});
