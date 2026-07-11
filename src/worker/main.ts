import { hostname } from "node:os";

import type { TelegramUpdate } from "@chat-adapter/telegram";

import { loadConfig } from "../config/load";
import { resolveSecretRef } from "../config/secrets";
import type { SecretRef } from "../config/schema";
import { createDbClient } from "../db/client";
import {
  BotApiTransport,
  buildRawPayloadRef,
  TelegramChannelAdapter,
  TelegramSender,
  type TelegramAccessLists,
} from "../channels";
import { scanForRecovery } from "../orchestrator/recovery";
import { logger } from "../observability/logger";
import { TaskAgentRegistry } from "../task-agents/registry";
import { buildTaskExecutors } from "../task-agents/executor";
import { resolveInference } from "./inference";
import {
  handleInbound,
  runJobsOnce,
  runMaintenanceOnce,
  type WorkerDeps,
} from "./loops";
import { buildDefaultToolset, type DispatchDeps, dispatchOutputs } from "./dispatch";
import { buildApprovalKeyboard } from "../action-review/approval-buttons";
import { resolveTrustedUsers } from "./trusted";

type StringOrRef = string | SecretRef;

function resolveMaybe(value: StringOrRef): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  try {
    return resolveSecretRef(value);
  } catch {
    return undefined;
  }
}

function resolveIdList(values: StringOrRef[]): string[] {
  return values
    .map(resolveMaybe)
    .filter((v): v is string => v !== undefined && v.length > 0);
}

export async function startWorker(signal: AbortSignal): Promise<void> {
  const config = await loadConfig();
  const db = createDbClient(config);
  const workerId = `${hostname()}:${process.pid}`;
  const log = logger.child("worker");

  const { inference, note } = await resolveInference(config);
  log.info("actor inference resolved", { provider: inference.name, note });

  // Production safety: consequential actions MUST require trusted approval.
  if (
    config.app.environment === "production" &&
    !config.actionReview.trustedApprovalRequiredForConsequentialActions
  ) {
    throw new Error(
      "production requires actionReview.trustedApprovalRequiredForConsequentialActions = true",
    );
  }

  const trustedUsers = resolveTrustedUsers(config);
  const toolset = buildDefaultToolset();
  const taskAgentRegistry = new TaskAgentRegistry();
  // Runtime executors for spawned task agents (codex/opencode CLI, scrubbed env).
  const taskExecutors = buildTaskExecutors(config);
  const dispatchDeps: DispatchDeps = {
    db,
    config,
    trustedUsers,
    toolRegistry: toolset.registry,
    toolHandlers: toolset.handlers,
    taskAgentRegistry,
  };
  const dispatch = (
    ...args: Parameters<NonNullable<WorkerDeps["dispatchOutputs"]>>
  ) => dispatchOutputs(dispatchDeps, ...args);

  // Reboot/crash recovery before processing anything.
  const recovery = await scanForRecovery(db);
  log.info(
    "recovery scan complete",
    recovery as unknown as Record<string, unknown>,
  );

  const telegram = config.channels.telegram;
  const accountLabel = telegram?.defaultAccountId ?? "main";

  let adapter: TelegramChannelAdapter | undefined;
  let deps: WorkerDeps;

  const telegramAccount = telegram?.accounts[accountLabel];
  const token = telegramAccount ? resolveMaybe(telegramAccount.botToken) : undefined;

  if (telegram?.enabled && token) {
    const transport = new BotApiTransport(token);
    const sender = new TelegramSender(transport);
    // Deliver approval prompts as inline Approve/Deny buttons (resolved by
    // approval id on tap — see maybeHandleApprovalCallback).
    dispatchDeps.sendApprovalPrompt = async (p) => {
      await transport
        .sendMessage({
          chat_id: p.chatId,
          text: `${p.title}\n${p.summary}\n\nApprove this action?`,
          message_thread_id: p.messageThreadId,
          reply_markup: buildApprovalKeyboard(p.approvalId),
        })
        .catch(() => undefined);
    };
    const accessLists: TelegramAccessLists = {
      allowedPrivateUserIds: resolveIdList(
        telegram.access.allowedPrivateUserIds,
      ),
      allowedGroupChatIds: resolveIdList(telegram.access.allowedGroupChatIds),
      allowedTopicIds: telegram.access.allowedTopicIds.map((entry) => ({
        chatId: resolveMaybe(entry.chatId) ?? "",
        topicId: resolveMaybe(entry.topicId) ?? "",
      })),
    };
    deps = {
      db,
      inference,
      delivery: sender,
      config,
      workerId,
      accountLabel,
      trustedUsers,
      toolset,
      taskExecutors,
      dispatchOutputs: dispatch,
      answerCallback: (callbackId: string) => sender.answerCallback(callbackId),
      // Set below once the adapter exists (webhook intake reuses it).
      processWebhookUpdate: undefined,
    };
    const workerDeps = deps;
    // Resolve the bot's identity FIRST so the normalizer can detect @mentions
    // and replies-to-Param in groups (without it, groups never read as
    // "addressed" and get the slow ambient debounce / get missed).
    const me = await transport.getMe().catch(() => undefined);
    adapter = new TelegramChannelAdapter({
      accountId: accountLabel,
      transport,
      accessLists,
      unauthorizedBehavior: telegram.access.unauthorizedBehavior,
      botUserId: me?.id,
      botUsername: me?.username,
      onInbound: async (inbound, raw) => {
        await handleInbound(workerDeps, inbound, buildRawPayloadRef(raw));
      },
      onError: (error) =>
        log.warn("inbound update failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
    });
    // Webhook intake (app process enqueues telegram_webhook_update) reuses the
    // adapter's normalize/access/ingest path so both transports behave alike.
    const webhookAdapter = adapter;
    workerDeps.processWebhookUpdate = async (update) => {
      await webhookAdapter.handleUpdate(update as TelegramUpdate);
    };
    log.info("telegram polling ready", { bot: me?.username ?? "unknown" });
  } else {
    if (telegram?.enabled) {
      log.warn("telegram enabled but bot token unavailable; polling disabled");
    }
    deps = {
      db,
      inference,
      delivery: noopDelivery(),
      config,
      workerId,
      accountLabel,
      trustedUsers,
      toolset,
      taskExecutors,
      dispatchOutputs: dispatch,
    };
  }

  // Only long-poll in polling mode. In webhook mode the app process feeds
  // updates via telegram_webhook_update jobs, and calling getUpdates would hit
  // Telegram's single-consumer 409 (a webhook is registered). The adapter is
  // still built (its handleUpdate powers webhook intake).
  const pollAdapter =
    adapter && telegramAccount?.mode !== "webhook" ? adapter : undefined;
  if (adapter && !pollAdapter) {
    log.info("telegram webhook mode: long-polling disabled; draining jobs");
  }

  let offset: number | undefined;
  let lastMaintenanceMs = 0;
  log.info("worker started", { workerId });

  while (!signal.aborted) {
    // Poll step is isolated: a getUpdates failure (409/429/revoked token/blip)
    // must NOT skip job processing below, or the whole worker wedges (webhook
    // jobs, deliveries, actor runs would never drain).
    let pollFailed = false;
    if (pollAdapter) {
      try {
        const poll = await pollAdapter.pollOnce(offset);
        offset = poll.nextOffset;
      } catch (error) {
        pollFailed = true;
        log.error("telegram poll error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    try {
      let processed = true;
      while (processed && !signal.aborted) {
        processed = await runJobsOnce(deps);
      }
      // Periodic maintenance (expire overdue approvals) at most every 60s.
      if (Date.now() - lastMaintenanceMs > 60_000) {
        lastMaintenanceMs = Date.now();
        await runMaintenanceOnce(deps);
      }
    } catch (error) {
      log.error("worker job loop error", {
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(2_000, signal);
      continue;
    }
    // Pacing: an active long-poll already blocks ~30s. Without one (webhook mode
    // or no adapter) poll jobs on a short timer; after a poll failure back off
    // so a persistent transport error can't busy-spin.
    if (!pollAdapter) {
      await sleep(1_000, signal);
    } else if (pollFailed) {
      await sleep(2_000, signal);
    }
  }

  await db.$client.close();
  log.info("worker stopped", { workerId });
}

function noopDelivery(): WorkerDeps["delivery"] {
  return {
    async sendText() {
      throw new Error("no delivery channel configured");
    },
    async react() {
      /* no-op */
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

if (import.meta.main) {
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());
  // Guard boot: a DB-down/misconfig at startup should exit cleanly (for the
  // service manager to restart with backoff), not surface as an unhandled
  // rejection.
  startWorker(controller.signal).catch((error) => {
    logger.child("worker").error("worker boot failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
