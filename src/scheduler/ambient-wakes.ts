import {
  ambientWakePayloadSchema,
  type AmbientWakePayload,
} from "../contracts/events";
import { idempotencyKeys } from "../contracts/ids";
import type { CooldownContext } from "./cooldowns";

/**
 * A Scheduled Ambient Turn wakes the actor so it can DECIDE whether to speak.
 * The payload below is what the actor sees; it never contains an instruction to
 * send a message. Quiet (`no_reply`) is a valid outcome.
 */
export const DEFAULT_ALLOWED_OUTPUTS: AmbientWakePayload["allowedOutputs"] = [
  "message",
  "react_to_message",
  "no_reply",
  "spawn_task_agent",
  "tool_call",
  "render_ui",
  "run_summary",
  "done",
];

export const DEFAULT_MAX_VISIBLE_MESSAGES = 2;

export function buildAmbientWakePayload(input: {
  intent: AmbientWakePayload["intent"];
  reason: string;
  scheduleId: string;
  sessionId: string;
  cooldown: CooldownContext;
  allowedOutputs?: string[];
}): AmbientWakePayload {
  const payload = {
    intent: input.intent,
    reason: input.reason,
    allowedOutputs: input.allowedOutputs ?? [...DEFAULT_ALLOWED_OUTPUTS],
    maxVisibleMessages: DEFAULT_MAX_VISIBLE_MESSAGES,
    cooldownContext: input.cooldown,
    createdBy: { kind: "scheduler" as const, scheduleId: input.scheduleId },
    scheduleId: input.scheduleId,
  };

  return ambientWakePayloadSchema.parse(payload);
}

/**
 * Stable dedupe key for a planned fire. The same schedule + planned_for +
 * session always produces the same key, so retries and post-restart replays do
 * not create duplicate wakes (or duplicate visible messages).
 */
export function ambientWakeDedupeKey(
  scheduleId: string,
  plannedForIso: string,
  sessionId: string,
): string {
  return idempotencyKeys.ambientWake(scheduleId, plannedForIso, sessionId);
}
