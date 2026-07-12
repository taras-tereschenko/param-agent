import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { MockActor } from "../../src/actor/mock-actor";
import type { NormalizedInbound } from "../../src/channels";
import { createDbClient } from "../../src/db/client";
import { TaskAgentRegistry } from "../../src/task-agents/registry";
import type { DeliveryPort } from "../../src/worker/actor-invocation";
import {
  buildDefaultToolset,
  dispatchOutputs,
  type DispatchContext,
  type DispatchDeps,
} from "../../src/worker/dispatch";
import { handleInbound, runJobsOnce, type WorkerDeps } from "../../src/worker/loops";
import type { ActorOutputDraft } from "../../src/contracts/actor-output";
import type { ParamConfig } from "../../src/config/schema";
import baseConfig from "../../param.config";

const databaseUrl = Bun.env.PARAM_TEST_DATABASE_URL;

/**
 * Full-loop proof: a real inbound DM, driven through the ACTUAL worker path
 * (handleInbound -> ingest -> job enqueue -> claim -> runActorInvocation ->
 * brain -> delivery) against a real Postgres, must produce a delivered reply.
 * The brain is the deterministic MockActor (guaranteed to reply) so this proves
 * the PIPELINE, independent of which real brain is configured.
 */
if (!databaseUrl) {
  describe("e2e loop", () => {
    test("requires PARAM_TEST_DATABASE_URL", () => {
      throw new Error("set PARAM_TEST_DATABASE_URL to run the e2e loop test");
    });
  });
} else {
  describe("e2e: inbound DM -> delivered reply", () => {
    test(
      "a DM flows through the worker and a reply is actually sent",
      async () => {
        const config: ParamConfig = {
          ...baseConfig,
          database: {
            ...baseConfig.database,
            url: { env: "PARAM_TEST_DATABASE_URL" },
          },
        };
        const db = createDbClient(config);
        const suffix = randomUUID().slice(0, 8);
        const userId = `e2e-${suffix}`;
        const chatId = userId; // private chat: chat id == user id

        const sent: string[] = [];
        const delivery: DeliveryPort = {
          async sendText(text) {
            sent.push(text);
            return { messageId: `m-${sent.length}` };
          },
          async react() {
            /* no-op */
          },
          async sendUi(surface) {
            sent.push(surface.text);
            return { messageId: `ui-${sent.length}` };
          },
        };

        const toolset = buildDefaultToolset();
        const dispatchDeps: DispatchDeps = {
          db,
          config,
          trustedUsers: [],
          toolRegistry: toolset.registry,
          toolHandlers: toolset.handlers,
          taskAgentRegistry: new TaskAgentRegistry(),
        };
        const deps: WorkerDeps = {
          db,
          inference: new MockActor(),
          delivery,
          config,
          workerId: `w-${suffix}`,
          accountLabel: "main",
          trustedUsers: [],
          toolset,
          dispatchOutputs: (ctx: DispatchContext, drafts: ActorOutputDraft[]) =>
            dispatchOutputs(dispatchDeps, ctx, drafts),
        };

        const inbound: NormalizedInbound = {
          kind: "chat.message.received",
          dedupeKey: `tg:${suffix}`,
          occurredAt: new Date().toISOString(),
          source: {
            kind: "user",
            platform: "telegram",
            platformUserId: userId,
            displayName: "Tester",
          },
          platform: { platform: "telegram", chatId },
          payload: {
            platformMessageId: `msg-${suffix}`,
            text: "hey you around?",
            mechanical: {
              mentionsParam: false,
              repliesToParam: false,
              isDirectMessage: true,
              isGroupMessage: false,
              isTopicMessage: false,
              hasCommandLikeText: false,
            },
          },
          access: { chatType: "private", chatId, fromUserId: userId },
        };

        // Ingest the message; a run is enqueued with a ~1.5s debounce.
        await handleInbound(deps, inbound);

        // Drain jobs until the reply is delivered (debounce + run) or timeout.
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline && sent.length === 0) {
          await runJobsOnce(deps);
          if (sent.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        }

        expect(sent.length).toBeGreaterThan(0);
        expect(sent[0]!.trim().length).toBeGreaterThan(0);

        await db.$client.close();
      },
      30_000,
    );
  });
}
