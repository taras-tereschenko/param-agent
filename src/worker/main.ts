import { hostname } from "node:os";

import { loadConfig } from "../config/load";
import { resolveSecretRef } from "../config/secrets";
import type { SecretRef } from "../config/schema";
import { createDbClient } from "../db/client";
import {
  BotApiTransport,
  TelegramChannelAdapter,
  TelegramSender,
  type TelegramAccessLists,
} from "../channels";
import { scanForRecovery } from "../orchestrator/recovery";
import { logger } from "../observability/logger";
import { resolveInference } from "./inference";
import { handleInbound, runJobsOnce, type WorkerDeps } from "./loops";

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
    };
    const workerDeps = deps;
    adapter = new TelegramChannelAdapter({
      accountId: accountLabel,
      transport,
      accessLists,
      unauthorizedBehavior: telegram.access.unauthorizedBehavior,
      onInbound: async (inbound) => {
        await handleInbound(workerDeps, inbound);
      },
    });
    const me = await transport.getMe().catch(() => undefined);
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
    };
  }

  let offset: number | undefined;
  log.info("worker started", { workerId });

  while (!signal.aborted) {
    try {
      if (adapter) {
        const poll = await adapter.pollOnce(offset);
        offset = poll.nextOffset;
      }
      let processed = true;
      while (processed && !signal.aborted) {
        processed = await runJobsOnce(deps);
      }
    } catch (error) {
      log.error("worker loop error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!adapter) {
      await sleep(1_000, signal);
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
  await startWorker(controller.signal);
}
