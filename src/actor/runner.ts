import type { ActorOutputDraft } from "../contracts/actor-output";
import type {
  PlatformCapabilitySummary,
  PromptApprovalPolicy,
  PromptPacket,
  PromptRunType,
  StyleGuardPolicy,
} from "../contracts/prompt";
import { compilePromptPacket, renderPromptPacket } from "../prompts/compiler";
import { runContract } from "../prompts/contracts";
import type { LatestContext, ActorInference } from "./inference";
import { validateActorOutputs } from "./output-validator";
import type { OutputValidationResult } from "./output-validator";
import { guardVisibleText } from "./style-guard";

export type SteeringInput = { priority: string; text?: string };

export type ActorTurnInput = {
  actorRunId: string;
  sessionId: string;
  runType: PromptRunType;
  platformCapabilities: PlatformCapabilitySummary;
  styleGuard: StyleGuardPolicy;
  approvalPolicy: PromptApprovalPolicy;
  runtimeFrame?: string;
  latest?: LatestContext;
  sessionContextText?: string;
  skillContextText?: string;
  memoryContextText?: string;
  steering?: SteeringInput[];
  knownEventIds?: string[];
  allowedOutputsOverride?: string[];
};

export type VisibleMessage = { text: string; replyToEventId?: string };
export type Reaction = { targetEventId: string; emoji: string };

export type ActorTurnResult = {
  promptPacket: PromptPacket;
  renderedPrompt: string;
  provider: string;
  /** Drafts accepted for persistence (post structural + style checks). */
  drafts: ActorOutputDraft[];
  visibleMessages: VisibleMessage[];
  reactions: Reaction[];
  stayedQuiet: boolean;
  styleAdjusted: boolean;
  /** Count of visible messages dropped because style could not be repaired. */
  styleDropped: number;
  /** True when strong steering means the worker should refresh before delivery. */
  preSendRefreshRequired: boolean;
  /** True when a hard control forced the run to drop stale visible output. */
  interrupted: boolean;
  validation: OutputValidationResult;
};

/**
 * Run one Session Actor turn: compile the prompt packet, call the inference
 * path, validate + style-guard the outputs, and apply the stale-output/steering
 * guard. Pure with respect to the DB — the worker persists the result and
 * performs delivery. Never returns stale visible output when a hard control is
 * present.
 */
export async function runActorTurn(
  inference: ActorInference,
  input: ActorTurnInput,
): Promise<ActorTurnResult> {
  const contract = runContract(input.runType);
  const allowedOutputs =
    input.allowedOutputsOverride ?? contract.allowedOutputs.map((o) => o);

  const promptPacket = compilePromptPacket({
    actorRunId: input.actorRunId,
    sessionId: input.sessionId,
    runType: input.runType,
    runtimeFrame: input.runtimeFrame,
    platformCapabilities: input.platformCapabilities,
    styleGuard: input.styleGuard,
    approvalPolicy: input.approvalPolicy,
    sessionContextText: input.sessionContextText,
    skillContextText: input.skillContextText,
    memoryContextText: input.memoryContextText,
    steeringText: input.steering && input.steering.length > 0
      ? renderSteering(input.steering)
      : undefined,
    allowedOutputs: input.allowedOutputsOverride,
    contextRefs: {
      eventIds: input.knownEventIds ?? [],
      memoryIds: [],
    },
  });
  const renderedPrompt = renderPromptPacket(promptPacket);

  const result = await inference.run({
    promptPacket,
    renderedPrompt,
    runType: input.runType,
    allowedOutputs,
    latest: input.latest,
    steering: input.steering,
  });

  const validation = validateActorOutputs(result.drafts, {
    allowedOutputs,
    sessionKnownEventIds: new Set(input.knownEventIds ?? []),
    maxVisibleMessages: input.styleGuard.maxVisibleMessagesPerRun,
    availableReactions: input.platformCapabilities.availableReactions,
  });

  const hardInterrupt = hasHardControl(input.steering);
  const preSendRefreshRequired =
    !hardInterrupt && hasStrongSteering(input.steering);

  const drafts: ActorOutputDraft[] = [];
  const visibleMessages: VisibleMessage[] = [];
  const reactions: Reaction[] = [];
  let styleAdjusted = false;
  let styleDropped = 0;

  for (const draft of validation.accepted) {
    if (draft.type === "message") {
      // A hard control makes any prepared visible output stale: do not deliver.
      if (hardInterrupt) {
        continue;
      }
      let text = draft.payload.text;
      // Only enforce style when the guard is enabled. When disabled, pass the
      // message through unchanged — disabling the guard must not DROP messages.
      if (input.styleGuard.enabled) {
        const guarded = guardVisibleText(text, {
          rewriteOnFailure: input.styleGuard.rewriteOnFailure,
        });
        if (!guarded.ok) {
          // Could not make it Param-voiced; drop rather than deliver bad output.
          styleAdjusted = true;
          styleDropped += 1;
          continue;
        }
        if (guarded.text !== text) {
          styleAdjusted = true;
        }
        text = guarded.text;
      }
      const fixedDraft: ActorOutputDraft = {
        type: "message",
        payload: { ...draft.payload, text },
      };
      drafts.push(fixedDraft);
      visibleMessages.push({
        text,
        replyToEventId: draft.payload.replyToEventId,
      });
      continue;
    }

    if (draft.type === "react_to_message") {
      if (hardInterrupt) {
        continue;
      }
      drafts.push(draft);
      reactions.push({
        targetEventId: draft.payload.targetEventId,
        emoji: draft.payload.emoji,
      });
      continue;
    }

    drafts.push(draft);
  }

  const stayedQuiet = visibleMessages.length === 0 && reactions.length === 0;

  return {
    promptPacket,
    renderedPrompt,
    provider: result.provider,
    drafts,
    visibleMessages,
    reactions,
    stayedQuiet,
    styleAdjusted,
    styleDropped,
    preSendRefreshRequired,
    interrupted: hardInterrupt,
    validation,
  };
}

function renderSteering(steering: SteeringInput[]): string {
  return steering
    .map((s) => `- [${s.priority}] ${s.text ?? "(activity)"}`)
    .join("\n");
}

function hasHardControl(steering?: SteeringInput[]): boolean {
  return (steering ?? []).some((s) => s.priority === "hard_control");
}

function hasStrongSteering(steering?: SteeringInput[]): boolean {
  return (steering ?? []).some((s) => s.priority === "strong");
}
