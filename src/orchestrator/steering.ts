import type { SteeringInboxItem, SteeringPriority } from "../contracts/common";

/**
 * Deterministic steering classification.
 *
 * When same-session activity arrives while an actor run is active, the
 * orchestrator tags it with a priority + routing tags. This is mechanical
 * metadata only — the actor still decides what the message MEANS. Hard controls
 * (stop/cancel/deny/approve) are separated from soft steering.
 */
export type SteeringSignal = {
  text?: string;
  mentionsParam?: boolean;
  repliesToParam?: boolean;
  isApprovalResponse?: boolean;
  hasCommandLikeText?: boolean;
  senderIsTrusted?: boolean;
  targetsActiveRun?: boolean;
  targetsPendingAction?: boolean;
  chatVelocityHigh?: boolean;
};

const HARD_CONTROL_PATTERNS = [
  /^\/?stop\b/i,
  /^\/?cancel\b/i,
  /^\/?abort\b/i,
  /^\/?halt\b/i,
  /^\/?deny\b/i,
  /^\/?reject\b/i,
  /^\/?approve\b/i,
  /^\/?confirm\b/i,
  /\bnevermind\b/i,
  /\bstop it\b/i,
];

export function isHardControl(signal: SteeringSignal): boolean {
  if (signal.isApprovalResponse) {
    return true;
  }
  const text = (signal.text ?? "").trim();
  if (!text) {
    return false;
  }
  return HARD_CONTROL_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifySteeringPriority(
  signal: SteeringSignal,
): SteeringPriority {
  if (isHardControl(signal)) {
    return "hard_control";
  }
  if (
    signal.mentionsParam ||
    signal.repliesToParam ||
    signal.senderIsTrusted ||
    signal.targetsActiveRun ||
    signal.targetsPendingAction
  ) {
    return "strong";
  }
  return "soft";
}

export function steeringTags(signal: SteeringSignal): string[] {
  const tags: string[] = ["message"];
  if (signal.mentionsParam) tags.push("mention");
  if (signal.repliesToParam) tags.push("reply_to_param");
  if (signal.isApprovalResponse) tags.push("approval_response");
  if (signal.hasCommandLikeText) tags.push("command");
  if (signal.senderIsTrusted) tags.push("trusted_sender");
  if (signal.targetsActiveRun) tags.push("targets_active_run");
  if (signal.targetsPendingAction) tags.push("targets_pending_action");
  if (signal.chatVelocityHigh) tags.push("chat_velocity_high");
  return tags;
}

export type SteeringClassification = {
  priority: SteeringPriority;
  tags: string[];
  reason: string;
};

export function classifySteering(
  signal: SteeringSignal,
): SteeringClassification {
  const priority = classifySteeringPriority(signal);
  const tags = steeringTags(signal);
  const reason =
    priority === "hard_control"
      ? "hard control detected (stop/cancel/deny/approve or approval response)"
      : priority === "strong"
        ? "directly targets Param or the active run"
        : "ambient same-session activity";
  return { priority, tags, reason };
}

/**
 * Stale-output guard input: before delivering visible output or performing side
 * effects, compare the run's checkpoint against newer inbox items. Strong
 * steering or hard controls require a pre-send refresh.
 */
export function requiresPreSendRefresh(
  unconsumedItems: Pick<SteeringInboxItem, "priority" | "consumedAt">[],
): boolean {
  return unconsumedItems.some(
    (item) =>
      !item.consumedAt &&
      (item.priority === "strong" || item.priority === "hard_control"),
  );
}

/**
 * True when an active run must be interrupted immediately (hard control),
 * versus merely refreshed before delivery (strong steering).
 */
export function requiresImmediateInterrupt(
  unconsumedItems: Pick<SteeringInboxItem, "priority" | "consumedAt">[],
): boolean {
  return unconsumedItems.some(
    (item) => !item.consumedAt && item.priority === "hard_control",
  );
}
