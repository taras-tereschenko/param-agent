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
import { idempotencyKeys, newId, nowIso } from "../contracts/ids";
import type { PromptRunType } from "../contracts/prompt";
import { logger } from "../observability/logger";
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
};

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

  await runsRepository.markRunStatus(db, run.id, "running");

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
      knownEventIds: ctx.knownEventIds,
    });

    // Persist every structured output (visible + internal).
    let sequence = 0;
    for (const draft of turn.drafts) {
      const seq = sequence;
      sequence += 1;
      const isVisible =
        draft.type === "message" || draft.type === "react_to_message";
      await runsRepository.insertActorOutput(db, {
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
    }

    // Deliver visible messages.
    let delivered = 0;
    const target = {
      chatId: session.platformChatId,
      messageThreadId: session.messageThreadId ?? undefined,
    };
    for (const message of turn.visibleMessages) {
      const replyToPlatformMessageId = message.replyToEventId
        ? platformMessageIds.get(message.replyToEventId)
        : undefined;
      try {
        const sent = await deps.delivery.sendText(message.text, {
          ...target,
          replyToPlatformMessageId,
        });
        delivered += 1;
        await ingestInternalEvent(db, {
          sessionId: run.sessionId,
          eventType: "delivery.succeeded",
          dedupeKey: `delivery.succeeded:${run.id}:${delivered}:${sent.messageId}`,
          source: { kind: "param" },
          actorRunId: run.id,
          payload: {
            outputId: run.id,
            platformMessageId: sent.messageId,
            deliveredAt: nowIso(),
            adapter: "telegram",
          },
        });
      } catch (error) {
        await ingestInternalEvent(db, {
          sessionId: run.sessionId,
          eventType: "delivery.failed",
          dedupeKey: `delivery.failed:${run.id}:${newId()}`,
          source: { kind: "param" },
          actorRunId: run.id,
          payload: {
            outputId: run.id,
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
    for (const reaction of turn.reactions) {
      const pmid = platformMessageIds.get(reaction.targetEventId);
      if (pmid) {
        try {
          await deps.delivery.react(session.platformChatId, pmid, reaction.emoji);
        } catch (error) {
          logger.warn("reaction delivery failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    await runsRepository.markRunStatus(db, run.id, "completed");
    await sessionsRepository.setActiveRun(db, run.sessionId, null);
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
