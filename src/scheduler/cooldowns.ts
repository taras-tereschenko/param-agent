/**
 * Cooldowns, flood guards, and active hours gate whether an ambient wake even
 * FIRES. They never decide what Param says: even when a wake is allowed, the
 * actor still reads the room and may choose to stay quiet (`no_reply`).
 */
export type CooldownContext = {
  lastProactiveAt?: string;
  proactiveMessagesToday: number;
  lastParamMessageAt?: string;
  sessionBusy: boolean;
};

export type CooldownPolicy = {
  minSecondsBetweenProactive: number;
  maxProactivePerDay: number;
  quietIfBusy: boolean;
};

/**
 * Decide whether a proactive wake is permitted right now. Denies when the
 * session is busy (and the policy asks to stay quiet), when the daily cap is
 * reached, or when still inside the min-gap cooldown window.
 */
export function ambientWakeAllowed(
  ctx: CooldownContext,
  policy: CooldownPolicy,
  now: Date,
): { allowed: boolean; reason: string } {
  if (policy.quietIfBusy && ctx.sessionBusy) {
    return { allowed: false, reason: "session_busy" };
  }

  if (ctx.proactiveMessagesToday >= policy.maxProactivePerDay) {
    return { allowed: false, reason: "daily_cap_reached" };
  }

  if (ctx.lastProactiveAt !== undefined) {
    const elapsedSeconds =
      (now.getTime() - new Date(ctx.lastProactiveAt).getTime()) / 1000;
    if (elapsedSeconds < policy.minSecondsBetweenProactive) {
      return { allowed: false, reason: "cooldown_active" };
    }
  }

  return { allowed: true, reason: "ok" };
}

/**
 * Active hours protect people from being woken at weird times. Kept simple:
 * UTC hours with an optional fixed timezone offset (in minutes).
 */
export type ActiveHours = {
  startHour: number;
  endHour: number;
  timezoneOffsetMinutes?: number;
};

/**
 * True when no active hours are configured, or when `now` falls within the
 * half-open window [startHour, endHour). Supports wrap-around windows
 * (e.g. 22 -> 6). A window where start === end is treated as always active.
 */
export function withinActiveHours(
  hours: ActiveHours | undefined,
  now: Date,
): boolean {
  if (hours === undefined) {
    return true;
  }

  const offsetMs = (hours.timezoneOffsetMinutes ?? 0) * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const hour = local.getUTCHours();

  const { startHour, endHour } = hours;
  if (startHour === endHour) {
    return true;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Wrap-around window (overnight): active from startHour to midnight and from
  // midnight to endHour.
  return hour >= startHour || hour < endHour;
}
