import { randomUUID } from "node:crypto";

import { migrate } from "drizzle-orm/bun-sql/migrator";
import { describe, expect, test } from "bun:test";

import { createDbClient } from "../../src/db/client";
import {
  ensureDatabaseExtensions,
  ensureSemanticIndexes,
} from "../../src/db/extensions";
import { ingestInboundEvent } from "../../src/orchestrator/router";
import { startActorRun } from "../../src/orchestrator/run-queue";
import { buildTelegramSessionRoute } from "../../src/orchestrator/session-resolver";
import { createApprovalRequest } from "../../src/action-review/approval-request";
import { resolveApprovalResponse } from "../../src/action-review/approval-response";
import { storeMemory } from "../../src/memory/store";
import { retrieveMemories } from "../../src/memory/retrieve";
import type { ParamConfig } from "../../src/config/schema";
import baseConfig from "../../param.config";

const databaseUrl = Bun.env.PARAM_TEST_DATABASE_URL;

function ingestInputFor(suffix: string, userId: string, chatId: string) {
  const route = buildTelegramSessionRoute({
    accountId: "main",
    chatType: "private",
    platformChatId: chatId,
    platformUserId: userId,
  });
  return {
    platform: "telegram",
    accountLabel: "main",
    eventType: "chat.message.received" as const,
    direction: "inbound" as const,
    visibility: "chat_visible" as const,
    dedupeKey: `telegram:update:main:${suffix}`,
    occurredAt: new Date().toISOString(),
    source: {
      kind: "user" as const,
      platform: "telegram",
      platformUserId: userId,
      displayName: "Test User",
    },
    platformRef: { platform: "telegram", chatId },
    payload: {
      platformMessageId: `msg-${suffix}`,
      text: "yo",
      mechanical: {
        mentionsParam: false,
        repliesToParam: false,
        isDirectMessage: true,
        isGroupMessage: false,
        isTopicMessage: false,
        hasCommandLikeText: false,
      },
    },
    route,
    chatType: "private",
  };
}

if (!databaseUrl) {
  describe("flows integration", () => {
    test("requires PARAM_TEST_DATABASE_URL", () => {
      throw new Error("set PARAM_TEST_DATABASE_URL to run flows integration tests");
    });
  });
} else {
  describe("flows integration", () => {
    const config: ParamConfig = {
      ...baseConfig,
      database: {
        ...baseConfig.database,
        url: { env: "PARAM_TEST_DATABASE_URL" },
      },
    };

    test("ingest dedupe, one-active-run, approvals, memory isolation", async () => {
      const db = createDbClient(config);
      const suffix = randomUUID().slice(0, 8);
      const userId = `u-${suffix}`;
      const chatId = `c-${suffix}`;

      try {
        await ensureDatabaseExtensions(db);
        await migrate(db, { migrationsFolder: "./drizzle/migrations" });
        await ensureSemanticIndexes(db);

        // Ingest + dedupe.
        const first = await ingestInboundEvent(db, ingestInputFor(suffix, userId, chatId));
        expect(first.inserted).toBe(true);
        const dup = await ingestInboundEvent(db, ingestInputFor(suffix, userId, chatId));
        expect(dup.inserted).toBe(false);
        expect(dup.sessionId).toBe(first.sessionId);

        // One active actor run per session.
        const run1 = await startActorRun(db, {
          sessionId: first.sessionId,
          runType: "normal_chat",
          runtime: "mock",
          triggerEventId: first.eventId,
        });
        expect(run1).toBeDefined();
        const run2 = await startActorRun(db, {
          sessionId: first.sessionId,
          runType: "normal_chat",
          runtime: "mock",
        });
        expect(run2).toBeUndefined();

        // Approval request dedupes on exact proposal + resolves once.
        const proposedAction = { tool: "service.restart", target: "param-worker" };
        const req = await createApprovalRequest(db, {
          sessionId: first.sessionId,
          request: {
            approvalId: randomUUID(),
            actionKind: "server_action",
            requesterEventIds: [first.eventId],
            title: "restart worker",
            summary: "restart the worker service",
            exactPreview: "systemctl restart param-worker",
            proposedAction,
            requiredTrustScope: "server_admin",
          },
          requiredTrustScope: "server_admin",
        });
        expect(req.existed).toBe(false);
        const reqAgain = await createApprovalRequest(db, {
          sessionId: first.sessionId,
          request: {
            approvalId: randomUUID(),
            actionKind: "server_action",
            requesterEventIds: [first.eventId],
            title: "restart worker",
            summary: "restart the worker service",
            exactPreview: "systemctl restart param-worker",
            proposedAction,
            requiredTrustScope: "server_admin",
          },
          requiredTrustScope: "server_admin",
        });
        expect(reqAgain.existed).toBe(true);
        expect(reqAgain.approvalId).toBe(req.approvalId);

        const resolved = await resolveApprovalResponse(db, {
          approvalId: req.approvalId,
          decision: "approved",
          approver: { kind: "user", platform: "telegram", platformUserId: "owner" },
          currentProposedAction: proposedAction,
        });
        expect(resolved.status).toBe("approved");
        expect(resolved.action).toEqual(proposedAction);

        const replay = await resolveApprovalResponse(db, {
          approvalId: req.approvalId,
          decision: "approved",
          approver: { kind: "user", platform: "telegram", platformUserId: "owner" },
        });
        expect(replay.status).toBe("already_decided");

        // Memory scope isolation: group memory must not surface in a DM.
        await storeMemory(db, {
          scope: "user",
          subjectRef: { paramUserId: userId },
          text: "prefers espresso",
          provenanceNote: "dm",
          confidence: 0.9,
          sensitivity: "low",
          sourceEventIds: [first.eventId],
        });
        await storeMemory(db, {
          scope: "group",
          subjectRef: { groupChatId: chatId },
          text: "group joke about espresso",
          provenanceNote: "group",
          confidence: 0.9,
          sensitivity: "low",
          sourceEventIds: [first.eventId],
        });

        const dmViews = await retrieveMemories(
          db,
          { routeType: "dm", sessionId: first.sessionId, paramUserId: userId },
          "espresso",
          10,
        );
        expect(dmViews.some((v) => v.text.includes("prefers espresso"))).toBe(true);
        expect(dmViews.some((v) => v.text.includes("group joke"))).toBe(false);
      } finally {
        await db.$client.close();
      }
    });
  });
}
