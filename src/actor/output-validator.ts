import type { ActorOutputDraft } from "../contracts/actor-output";

export type OutputValidationContext = {
  allowedOutputs: string[];
  /** Event ids the actor may legitimately reference (from its context). */
  sessionKnownEventIds?: Set<string>;
  /** Max visible `message` bubbles per run. */
  maxVisibleMessages: number;
  /** Telegram available reactions, when the platform reports them. */
  availableReactions?: string[];
};

export type RejectedOutput = {
  draft: ActorOutputDraft;
  reason: string;
};

export type OutputValidationResult = {
  accepted: ActorOutputDraft[];
  rejected: RejectedOutput[];
  needsRepair: boolean;
  hasDone: boolean;
  visibleMessageCount: number;
};

/**
 * Structural validation of actor output drafts against the run contract:
 * allowed output types, referenced event ids belonging to the session, reaction
 * validity, and the per-run visible-message cap. Style (voice) is checked
 * separately by the style guard.
 */
export function validateActorOutputs(
  drafts: ActorOutputDraft[],
  ctx: OutputValidationContext,
): OutputValidationResult {
  const accepted: ActorOutputDraft[] = [];
  const rejected: RejectedOutput[] = [];
  const allowed = new Set(ctx.allowedOutputs);
  const known = ctx.sessionKnownEventIds;
  let visibleMessageCount = 0;
  let hasDone = false;

  for (const draft of drafts) {
    if (!allowed.has(draft.type)) {
      rejected.push({
        draft,
        reason: `output type "${draft.type}" not allowed for this run`,
      });
      continue;
    }

    if (draft.type === "done") {
      hasDone = true;
    }

    if (draft.type === "message") {
      if (visibleMessageCount >= ctx.maxVisibleMessages) {
        rejected.push({
          draft,
          reason: `exceeds max ${ctx.maxVisibleMessages} visible messages`,
        });
        continue;
      }
      const replyTo = draft.payload.replyToEventId;
      if (replyTo && known && known.size > 0 && !known.has(replyTo)) {
        rejected.push({
          draft,
          reason: `replyToEventId ${replyTo} is not in this session`,
        });
        continue;
      }
      visibleMessageCount += 1;
    }

    if (draft.type === "react_to_message") {
      const target = draft.payload.targetEventId;
      if (known && known.size > 0 && !known.has(target)) {
        rejected.push({
          draft,
          reason: `react target ${target} is not in this session`,
        });
        continue;
      }
      if (
        ctx.availableReactions &&
        ctx.availableReactions.length > 0 &&
        !ctx.availableReactions.includes(draft.payload.emoji)
      ) {
        rejected.push({
          draft,
          reason: `reaction ${draft.payload.emoji} not available in this chat`,
        });
        continue;
      }
    }

    accepted.push(draft);
  }

  return {
    accepted,
    rejected,
    needsRepair: rejected.length > 0,
    hasDone,
    visibleMessageCount,
  };
}
