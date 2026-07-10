import type { ParamConfig } from "../config/schema";
import type { ActorInference } from "../actor/inference";
import { buildContext } from "../actor/context-builder";
import { runActorTurn } from "../actor/runner";
import type { ParamDb } from "../db/client";
import {
  auditRepository,
  eventsRepository,
  runsRepository,
  sessionsRepository,
} from "../db/repositories";
import { retrieveMemories } from "../memory/retrieve";
import { buildMemoryContextText } from "../memory/review";
import { ingestInternalEvent } from "../orchestrator/router";
import { startActorRun } from "../orchestrator/run-queue";
import { classifySteering } from "../orchestrator/steering";
import { idempotencyKeys, newId, nowIso } from "../contracts/ids";
import type { ActorOutputDraft } from "../contracts/actor-output";
import type { ActorRef } from "../contracts/common";
import type { PromptRunType } from "../contracts/prompt";
import { logger } from "../observability/logger";
import type { DispatchContext } from "./dispatch";
import {
  approvalPolicyFromConfig,
  memoryRetrievalContextFromSession,
  styleGuardFromConfig,
  telegramCapabilities,
} from "./context";

/** Delivery port satisfied by the Telegram sender; injectable for tests. */
export interface DeliveryPort {
  sendText(
    text: string,
    target: { chatId: string; messageThreadId?: string; replyToPlatformMessageId?: string },
  ): Promise<{ messageId: string }>;
  react(chatId: string, messageId: string, emoji: string): Promise<void>;
}

export type ActorInvocationDeps = {
  db: ParamDb;
  inference: ActorInference;
  delivery: DeliveryPort;
  config: ParamConfig;
  workerId?: string;
  /**
   * Routes non-visible outputs (tool_call / approval_request / spawn /
   * memory_candidate) through their safety pipelines. Injected by the worker so
   * this module stays decoupled from tools/action-review.
   */
  dispatchOutputs?: (
    ctx: DispatchContext,
    drafts: ActorOutputDraft[],
  ) => Promise<{ ranTool: boolean }>;
};

/** Max tool->result->actor re-wakes in one chain, so the agentic loop can't run away. */
const MAX_TOOL_CONTINUATIONS = 4;

export type ActorInvocationResult = {
  ran: boolean;
  delivered: number;
  stayedQuiet: boolean;
};

/**
 * Run one queued actor invocation end to end: build context + memory, run the
 * actor turn, persist structured outputs, and deliver visible messages/reactions
 * through the channel. Delivery records are written before/after send so nothing
 * is marked delivered until the adapter confirms.
 */
export async function runActorInvocation(
  deps: ActorInvocationDeps,
  actorRunId: string,
): Promise<ActorInvocationResult> {
  const { db } = deps;
  const run = await runsRepository.getActorRunById(db, actorRunId);
  if (!run) {
    return { ran: false, delivered: 0, stayedQuiet: true };
  }
  const activeStatuses = new Set([
    "queued",
    "building_context",
    "running",
    "waiting_tool",
    "waiting_approval",
    "compacting",
  ]);
  if (!activeStatuses.has(run.status)) {
    return { ran: false, delivered: 0, stayedQuiet: true };
  }

  const session = await sessionsRepository.getSessionById(db, run.sessionId);
  if (!session) {
    await runsRepository.failRun(db, run.id, { code: "no_session" });
    return { ran: false, delivered: 0, stayedQuiet: true };
  }

  // Retry safety: if this run already produced outputs (a crash re-claimed the
  // job), do NOT re-run inference. But re-drive any visible message that was
  // persisted yet never delivered (a crash between persist and send) so the
  // reply is not lost. Only "pending" outputs are re-sent (delivered ones are
  // marked succeeded), so at most the narrow send-then-crash-before-status
  // window can duplicate — an accepted trade to never drop a reply.
  const priorOutputs = await runsRepository.listOutputsForRun(db, run.id);
  if (priorOutputs.length > 0) {
    let redelivered = 0;
    for (const prior of priorOutputs) {
      if (prior.type !== "message" || prior.deliveryStatus !== "pending") {
        continue;
      }
      const text = (prior.payload as { text?: string }).text;
      if (!text) continue;
      try {
        await deps.delivery.sendText(text, {
          chatId: session.platformChatId,
          messageThreadId: session.messageThreadId ?? undefined,
        });
        await runsRepository.setOutputDelivery(db, prior.id, "succeeded");
        redelivered += 1;
      } catch {
        // leave pending; a later pass can retry
      }
    }
    await runsRepository.markRunStatus(db, run.id, "completed");
    await sessionsRepository.setActiveRun(db, run.sessionId, null);
    return {
      ran: false,
      delivered: redelivered,
      stayedQuiet: redelivered === 0,
    };
  }

  await runsRepository.markRunStatus(db, run.id, "running");
  // Refresh the lease from processing-start so recovery only reclaims a run
  // whose worker actually died, not one that is legitimately running.
  if (deps.workerId) {
    await runsRepository.heartbeatRun(db, run.id, deps.workerId, 300);
  }

  try {
    const events = await eventsRepository.listSessionEvents(db, run.sessionId, 60);
    const contextEvents = events.map((event) => ({
      id: event.id,
      type: event.type,
      payload: event.payload,
      source: event.source,
      occurredAt: event.occurredAt,
    }));
    const ctx = buildContext(contextEvents);

    // Map event id -> platform message id for reply/react targeting.
    const platformMessageIds = new Map<string, string>();
    for (const event of events) {
      const pmid = (event.payload as { platformMessageId?: string })
        .platformMessageId;
      if (pmid) {
        platformMessageIds.set(event.id, pmid);
      }
    }

    // Scoped memory retrieval (best-effort; isolation enforced in selectMemories).
    let memoryContextText = "";
    try {
      const memViews = await retrieveMemories(
        db,
        memoryRetrievalContextFromSession(session),
        ctx.latest?.text ?? "",
        6,
      );
      memoryContextText = buildMemoryContextText(memViews);
    } catch (error) {
      logger.warn("memory retrieval failed", {
        sessionId: run.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Steering: same-session messages that arrived AFTER this run's trigger are
    // steering signals — a hard control ("stop"/"cancel") interrupts and drops
    // stale visible output; strong steering forces a pre-send refresh.
    const triggerAt = run.triggerEventId
      ? events.find((event) => event.id === run.triggerEventId)?.occurredAt
      : undefined;
    const steering: { priority: string; text?: string }[] = [];
    if (triggerAt) {
      for (const event of events) {
        if (event.id === run.triggerEventId) continue;
        if (event.type !== "chat.message.received") continue;
        if (!(event.occurredAt > triggerAt)) continue;
        const payload = event.payload as {
          text?: string;
          mechanical?: Record<string, boolean>;
        };
        const classification = classifySteering({
          text: payload.text,
          mentionsParam: payload.mechanical?.mentionsParam,
          repliesToParam: payload.mechanical?.repliesToParam,
          hasCommandLikeText: payload.mechanical?.hasCommandLikeText,
        });
        steering.push({ priority: classification.priority, text: payload.text });
      }
    }

    const turn = await runActorTurn(deps.inference, {
      actorRunId: run.id,
      sessionId: run.sessionId,
      runType: run.runType as PromptRunType,
      platformCapabilities: telegramCapabilities(),
      styleGuard: styleGuardFromConfig(deps.config),
      approvalPolicy: approvalPolicyFromConfig(deps.config),
      latest: ctx.latest,
      sessionContextText: ctx.sessionContextText,
      memoryContextText,
      steering: steering.length > 0 ? steering : undefined,
      knownEventIds: ctx.knownEventIds,
    });

    // Store a redacted prompt snapshot (layer ids/titles/versions only — no
    // content, so no secrets) for audit and debugging.
    await runsRepository.setRunSnapshot(db, run.id, {
      promptSnapshotRef: turn.promptPacket.promptId,
      snapshot: {
        runType: run.runType,
        layers: turn.promptPacket.layers.map((layer) => ({
          id: layer.id,
          title: layer.title,
          verbatim: layer.verbatim,
        })),
        allowedOutputs: turn.promptPacket.allowedOutputs,
        styleGuardVersion: turn.promptPacket.styleGuard.version,
        provider: turn.provider,
      },
    });

    // Persist every structured output (visible + internal), capturing the row
    // ids of visible outputs so delivery can be tracked per output.
    const messagesToDeliver: {
      outputId: string;
      text: string;
      replyToEventId?: string;
    }[] = [];
    const reactionsToDeliver: {
      outputId: string;
      targetEventId: string;
      emoji: string;
    }[] = [];
    let sequence = 0;
    for (const draft of turn.drafts) {
      const seq = sequence;
      sequence += 1;
      const isVisible =
        draft.type === "message" || draft.type === "react_to_message";
      const { output, inserted } = await runsRepository.insertActorOutput(db, {
        id: newId(),
        type: draft.type,
        sessionId: run.sessionId,
        actorRunId: run.id,
        sequence: seq,
        idempotencyKey: idempotencyKeys.actorOutput(run.id, seq),
        payload: draft.payload as Record<string, unknown>,
        validationStatus: "valid",
        deliveryStatus: isVisible ? "pending" : "not_applicable",
      });
      // Only deliver outputs THIS run created. If the row already existed
      // (idempotency-key conflict from a concurrently re-claimed run under a
      // multi-worker deploy), the other worker owns delivery — skip, so a
      // visible message is never sent twice.
      if (!inserted) {
        continue;
      }
      if (draft.type === "message") {
        messagesToDeliver.push({
          outputId: output.id,
          text: draft.payload.text,
          replyToEventId: draft.payload.replyToEventId,
        });
      } else if (draft.type === "react_to_message") {
        reactionsToDeliver.push({
          outputId: output.id,
          targetEventId: draft.payload.targetEventId,
          emoji: draft.payload.emoji,
        });
      }
    }

    // Strong steering arrived during the turn: the prepared reply is stale — do
    // not deliver it; the fresh run enqueued below recomputes with the newer
    // context. (A hard control already dropped visible output in the runner.)
    if (turn.preSendRefreshRequired) {
      messagesToDeliver.length = 0;
      reactionsToDeliver.length = 0;
    }

    // Deliver visible messages, tracking delivery status per output.
    let delivered = 0;
    const target = {
      chatId: session.platformChatId,
      messageThreadId: session.messageThreadId ?? undefined,
    };
    for (const message of messagesToDeliver) {
      const replyToPlatformMessageId = message.replyToEventId
        ? platformMessageIds.get(message.replyToEventId)
        : undefined;
      try {
        const sent = await deps.delivery.sendText(message.text, {
          ...target,
          replyToPlatformMessageId,
        });
        delivered += 1;
        await runsRepository.setOutputDelivery(db, message.outputId, "succeeded");
        await ingestInternalEvent(db, {
          sessionId: run.sessionId,
          eventType: "delivery.succeeded",
          dedupeKey: idempotencyKeys.delivery(message.outputId, "telegram"),
          source: { kind: "param" },
          actorRunId: run.id,
          payload: {
            outputId: message.outputId,
            platformMessageId: sent.messageId,
            deliveredAt: nowIso(),
            adapter: "telegram",
          },
        });
      } catch (error) {
        await runsRepository.setOutputDelivery(db, message.outputId, "failed");
        await ingestInternalEvent(db, {
          sessionId: run.sessionId,
          eventType: "delivery.failed",
          dedupeKey: `${idempotencyKeys.delivery(message.outputId, "telegram")}:failed:${newId()}`,
          source: { kind: "param" },
          actorRunId: run.id,
          payload: {
            outputId: message.outputId,
            failedAt: nowIso(),
            adapter: "telegram",
            error: {
              code: "delivery_error",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
        });
      }
    }

    // Deliver reactions.
    for (const reaction of reactionsToDeliver) {
      const pmid = platformMessageIds.get(reaction.targetEventId);
      if (pmid) {
        try {
          await deps.delivery.react(session.platformChatId, pmid, reaction.emoji);
          await runsRepository.setOutputDelivery(
            db,
            reaction.outputId,
            "succeeded",
          );
        } catch (error) {
          await runsRepository.setOutputDelivery(db, reaction.outputId, "failed");
          logger.warn("reaction delivery failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Route non-visible outputs (tool_call / approval_request / spawn /
    // memory_candidate) through their safety pipelines.
    let dispatchResult: { ranTool: boolean } | undefined;
    if (deps.dispatchOutputs) {
      // SECURITY: the requester for the Action Review trust decision must be
      // the user who triggered THIS run, not the latest speaker (in a group,
      // a trusted user speaking mid-debounce must not authorize an untrusted
      // user's action). Bind to the run's trigger event; fail closed (no
      // requester -> consequential actions denied) if it is not in the window.
      const triggerEvent = run.triggerEventId
        ? events.find((event) => event.id === run.triggerEventId)
        : undefined;
      dispatchResult = await deps.dispatchOutputs(
        {
          runId: run.id,
          sessionId: run.sessionId,
          routeType: session.routeType,
          platformChatId: session.platformChatId,
          messageThreadId: session.messageThreadId ?? undefined,
          requester: triggerEvent
            ? (triggerEvent.source as unknown as ActorRef)
            : undefined,
          requesterEventIds: triggerEvent ? [triggerEvent.id] : [],
        },
        turn.drafts,
      );
    }
    if (turn.styleDropped > 0) {
      logger.warn("dropped style-failing visible messages", {
        runId: run.id,
        count: turn.styleDropped,
      });
    }

    await runsRepository.markRunStatus(db, run.id, "completed");
    await sessionsRepository.setActiveRun(db, run.sessionId, null);

    // Pre-send refresh: strong steering means we suppressed this turn's reply;
    // recompute against the newest message (its own trigger, so this doesn't
    // loop). startActorRun is a no-op if a run is already active.
    if (turn.preSendRefreshRequired && ctx.latest?.latestEventId) {
      await startActorRun(db, {
        sessionId: run.sessionId,
        runType: "normal_chat",
        runtime: deps.config.actor.defaultRuntime,
        triggerEventId: ctx.latest.latestEventId,
        dueAt: new Date(Date.now() + 300),
      });
    }

    // Agentic loop: a tool executed this turn -> re-wake the actor so it sees
    // the tool.result and can continue (reply, or chain another step). Bounded
    // by MAX_TOOL_CONTINUATIONS so a tool loop can't run away.
    const continuationDepth = Number(
      (run as { metadata?: Record<string, unknown> }).metadata
        ?.continuationDepth ?? 0,
    );
    if (
      dispatchResult &&
      dispatchResult.ranTool &&
      continuationDepth < MAX_TOOL_CONTINUATIONS
    ) {
      await startActorRun(db, {
        sessionId: run.sessionId,
        runType: "normal_chat",
        runtime: deps.config.actor.defaultRuntime,
        triggerEventId: run.triggerEventId,
        metadata: { continuationDepth: continuationDepth + 1 },
        dueAt: new Date(Date.now() + 500),
      });
    }

    if (ctx.latest?.latestEventId) {
      await sessionsRepository.setLastEventSeenByActor(
        db,
        run.sessionId,
        ctx.latest.latestEventId,
        run.id,
      );
    }
    await auditRepository.writeDecision(db, {
      actorRunId: run.id,
      sessionId: run.sessionId,
      triggerEventId: run.triggerEventId,
      decision: turn.stayedQuiet ? "no_reply" : "reply",
      reasonCode: turn.interrupted ? "interrupted_by_hard_control" : "actor_turn",
      shortReason: turn.stayedQuiet
        ? "stayed quiet"
        : `sent ${delivered} message(s) via ${turn.provider}`,
    });

    return { ran: true, delivered, stayedQuiet: turn.stayedQuiet };
  } catch (error) {
    await runsRepository.failRun(db, run.id, {
      code: "actor_invocation_failed",
      message: error instanceof Error ? error.message : String(error),
    });
    await sessionsRepository.setActiveRun(db, run.sessionId, null);
    throw error;
  }
}
