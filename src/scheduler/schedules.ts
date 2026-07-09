import { addSeconds } from "../shared/time";

/**
 * A schedule's timing specification.
 *
 * - `interval`: fires every `intervalSeconds`.
 * - `once`: fires a single time at `atIso`.
 * - `cron_lite`: reserved for calendar-style recurrence. For now it is treated
 *   exactly like `interval` (see doc note in computeNextFire); a real cron
 *   parser can replace this without changing callers.
 */
export type ScheduleSpec = {
  kind: "interval" | "cron_lite" | "once";
  intervalSeconds?: number;
  atIso?: string;
};

/**
 * Compute the next fire time for a schedule, or null when there is no next
 * fire (e.g. a one-shot that already fired or whose time is in the past).
 */
export function computeNextFire(
  spec: ScheduleSpec,
  from: Date,
  lastFiredAt?: Date,
): Date | null {
  switch (spec.kind) {
    case "interval":
    // NOTE: cron_lite is treated like a fixed interval until a real cron_lite
    // parser lands. This keeps recurring schedules working today.
    case "cron_lite": {
      if (spec.intervalSeconds === undefined || spec.intervalSeconds <= 0) {
        return null;
      }
      return addSeconds(from, spec.intervalSeconds);
    }
    case "once": {
      if (spec.atIso === undefined) {
        return null;
      }
      // A one-shot fires at most once.
      if (lastFiredAt !== undefined) {
        return null;
      }
      const at = new Date(spec.atIso);
      return at.getTime() > from.getTime() ? at : null;
    }
    default:
      return null;
  }
}
