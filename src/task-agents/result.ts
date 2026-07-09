import {
  taskResultPayloadSchema,
  type TaskResultPayload,
} from "../contracts/events";

/**
 * Build a validated task result. Task agents report back to the Session Actor
 * (never directly to chat); errors are preserved honestly.
 */
export function buildTaskResult(input: TaskResultPayload): TaskResultPayload {
  return taskResultPayloadSchema.parse(input);
}
