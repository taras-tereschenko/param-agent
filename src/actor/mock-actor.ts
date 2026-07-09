import type { ActorOutputDraft } from "../contracts/actor-output";
import type {
  ActorInference,
  ActorInferenceRequest,
  ActorInferenceResult,
  LatestContext,
} from "./inference";

/**
 * Deterministic, rule-based Session Actor used as the default dev/test
 * inference path and as the documented fallback while the Codex chat-brain path
 * is unproven in this environment. It exercises the full loop (reply / react /
 * stay quiet / multiple bubbles) in Param's voice without any model call.
 */
export class MockActor implements ActorInference {
  readonly name = "mock";
  readonly description =
    "deterministic rule-based actor; no model inference, used for dev/tests and as a proven fallback loop";

  isAvailable(): boolean {
    return true;
  }

  async run(request: ActorInferenceRequest): Promise<ActorInferenceResult> {
    const drafts = decideOutputs(request);
    return { drafts, provider: "mock" };
  }
}

const GREETINGS = ["hey", "hi", "hello", "yo", "sup", "what's up", "wassup"];

function decideOutputs(request: ActorInferenceRequest): ActorOutputDraft[] {
  const allowed = new Set(request.allowedOutputs);
  const latest = request.latest ?? {};
  const outputs: ActorOutputDraft[] = [];

  // Internal, non-visible runs never speak.
  if (request.runType === "memory_review" || request.runType === "compaction") {
    if (allowed.has("run_summary")) {
      outputs.push({
        type: "run_summary",
        payload: {
          summary: "reviewed context; no changes",
          decisions: ["no_memory_change"],
        },
      });
    }
    return withDone(outputs, allowed);
  }

  const canMessage = allowed.has("message");
  const canNoReply = allowed.has("no_reply");
  const text = (latest.text ?? "").trim();
  const lower = text.toLowerCase();

  // Ambient wakes stay quiet by default (prefer no_reply over forced content).
  if (request.runType === "ambient_wake") {
    return withDone(quiet(allowed, "not_my_moment"), allowed);
  }

  // Hard controls / stop: acknowledge by staying quiet.
  if (/^\/?(stop|cancel|abort|halt)\b/i.test(lower)) {
    return withDone(quiet(allowed, "not_my_moment"), allowed);
  }

  // In a group, do not answer every message unless pulled in.
  const pulledIn =
    latest.isDirectMessage ||
    latest.mentionsParam ||
    latest.repliesToParam ||
    request.runType === "approval" ||
    request.runType === "task_result";
  if (latest.isGroupMessage && !pulledIn) {
    return withDone(quiet(allowed, "not_my_moment"), allowed);
  }

  if (!canMessage) {
    return withDone(quiet(allowed, "nothing_to_add"), allowed);
  }

  // Greetings get greetings, not briefings.
  if (isGreeting(lower)) {
    outputs.push(message("yo"));
    return withDone(outputs, allowed);
  }

  if (/\b(thanks|thank you|ty|thx)\b/i.test(lower)) {
    outputs.push(message("np"));
    return withDone(outputs, allowed);
  }

  if (text.length === 0) {
    return withDone(quiet(allowed, "nothing_to_add"), allowed);
  }

  // Default: a short, in-voice acknowledgement, optionally as two bubbles to
  // demonstrate multi-message behavior for a longer prompt.
  if (text.length > 140) {
    outputs.push(message("ok give me a sec"));
    outputs.push(message("on it", latest.latestEventId));
  } else {
    outputs.push(message("gotcha", latest.latestEventId));
  }
  return withDone(outputs, allowed);
}

function isGreeting(lower: string): boolean {
  const cleaned = lower.replace(/[^a-z' ]/g, "").trim();
  return GREETINGS.includes(cleaned);
}

function message(text: string, replyToEventId?: string): ActorOutputDraft {
  return {
    type: "message",
    payload: {
      text,
      parseMode: "plain",
      style: "param_chat",
      visible: true,
      ...(replyToEventId ? { replyToEventId } : {}),
    },
  };
}

function quiet(
  allowed: Set<string>,
  reason:
    | "nothing_to_add"
    | "not_my_moment"
    | "chat_busy"
    | "cooldown"
    | "waiting_for_more_context",
): ActorOutputDraft[] {
  if (!allowed.has("no_reply")) {
    return [];
  }
  return [{ type: "no_reply", payload: { reason } }];
}

function withDone(
  outputs: ActorOutputDraft[],
  allowed: Set<string>,
): ActorOutputDraft[] {
  if (allowed.has("done")) {
    outputs.push({ type: "done", payload: { status: "completed" } });
  }
  return outputs;
}
