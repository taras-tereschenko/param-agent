/**
 * Deterministic batching policy.
 *
 * Param must batch high-volume chat events without answering every message.
 * This is pure timing logic: given the pending buffer for a session and the
 * clock, decide whether to flush a batch into an actor run. The actor still
 * decides whether to actually reply (it may stay quiet).
 */
export type BatchTrigger = {
  mentionsParam?: boolean;
  repliesToParam?: boolean;
  isDirectMessage?: boolean;
  hasCommandLikeText?: boolean;
};

export type BatchState = {
  pendingCount: number;
  firstPendingAtMs: number;
  lastPendingAtMs: number;
  strongestTrigger?: BatchTrigger;
};

export type BatchPolicy = {
  /** Quiet gap before flushing when Param is directly addressed. */
  directDebounceMs: number;
  /** Quiet gap before flushing ambient group chatter. */
  ambientDebounceMs: number;
  /** Hard cap on how long a batch may buffer before flushing. */
  maxBatchWindowMs: number;
  /** Flush once this many events are pending regardless of timing. */
  maxPendingCount: number;
};

export const defaultBatchPolicy: BatchPolicy = {
  directDebounceMs: 1_500,
  ambientDebounceMs: 12_000,
  maxBatchWindowMs: 60_000,
  maxPendingCount: 25,
};

export type BatchDecision = {
  flush: boolean;
  reason:
    | "empty"
    | "quiet_gap"
    | "max_window"
    | "max_count"
    | "waiting";
};

export function isDirectlyAddressed(trigger?: BatchTrigger): boolean {
  if (!trigger) return false;
  return Boolean(
    trigger.isDirectMessage ||
      trigger.mentionsParam ||
      trigger.repliesToParam ||
      trigger.hasCommandLikeText,
  );
}

export function shouldFlushBatch(
  state: BatchState,
  policy: BatchPolicy,
  nowMs: number,
): BatchDecision {
  if (state.pendingCount <= 0) {
    return { flush: false, reason: "empty" };
  }

  if (state.pendingCount >= policy.maxPendingCount) {
    return { flush: true, reason: "max_count" };
  }

  const debounceMs = isDirectlyAddressed(state.strongestTrigger)
    ? policy.directDebounceMs
    : policy.ambientDebounceMs;

  const quietGapMs = nowMs - state.lastPendingAtMs;
  if (quietGapMs >= debounceMs) {
    return { flush: true, reason: "quiet_gap" };
  }

  const windowMs = nowMs - state.firstPendingAtMs;
  if (windowMs >= policy.maxBatchWindowMs) {
    return { flush: true, reason: "max_window" };
  }

  return { flush: false, reason: "waiting" };
}
