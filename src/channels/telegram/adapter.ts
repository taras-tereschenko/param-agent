/**
 * Telegram channel adapter.
 *
 * Owns the polling loop and the inbound pipeline: fetch updates -> normalize
 * -> evaluate access -> hand allowed inbound to the caller. Access-denied and
 * unsupported updates are dropped. Delivery is delegated to `TelegramSender`.
 */

import type { TelegramUpdate } from "@chat-adapter/telegram";

import {
  evaluateTelegramAccess,
  type TelegramAccessLists,
} from "./policy";
import {
  normalizeTelegramUpdate,
  type NormalizedInbound,
} from "./normalize";
import { TelegramSender } from "./send";
import type { TelegramTransport } from "./transport";

export type InboundHandler = (
  inbound: NormalizedInbound,
  raw: TelegramUpdate,
) => Promise<void>;

export type TelegramChannelAdapterOptions = {
  accountId: string;
  transport: TelegramTransport;
  accessLists: TelegramAccessLists;
  onInbound: InboundHandler;
  unauthorizedBehavior: "ignore" | "audit_minimal";
  longPollTimeoutSeconds?: number;
  botUserId?: string;
  botUsername?: string;
};

export type PollResult = {
  nextOffset: number;
  handled: number;
  skipped: number;
};

const DEFAULT_LONG_POLL_TIMEOUT_SECONDS = 30;
const TRANSIENT_ERROR_DELAY_MS = 1000;

export class TelegramChannelAdapter {
  private readonly opts: TelegramChannelAdapterOptions;
  private readonly _sender: TelegramSender;

  constructor(opts: TelegramChannelAdapterOptions) {
    this.opts = opts;
    this._sender = new TelegramSender(opts.transport);
  }

  get sender(): TelegramSender {
    return this._sender;
  }

  async getMe(): Promise<{ id: string; username?: string }> {
    return this.opts.transport.getMe();
  }

  async pollOnce(offset?: number): Promise<PollResult> {
    const timeout =
      this.opts.longPollTimeoutSeconds ?? DEFAULT_LONG_POLL_TIMEOUT_SECONDS;
    const updates = await this.opts.transport.getUpdates(offset, timeout);

    let handled = 0;
    let skipped = 0;
    let maxUpdateId = offset !== undefined ? offset - 1 : -1;

    for (const update of updates) {
      if (update.update_id > maxUpdateId) {
        maxUpdateId = update.update_id;
      }

      const inbound = normalizeTelegramUpdate(update, {
        accountId: this.opts.accountId,
        botUserId: this.opts.botUserId,
        botUsername: this.opts.botUsername,
      });
      if (!inbound) {
        skipped += 1;
        continue;
      }

      const decision = evaluateTelegramAccess(
        inbound.access,
        this.opts.accessLists,
      );
      if (!decision.allowed) {
        // Both "ignore" and "audit_minimal" drop the update here. The audit
        // sink is wired in a higher layer; the adapter never surfaces the
        // content of unauthorized traffic.
        skipped += 1;
        continue;
      }

      await this.opts.onInbound(inbound, update);
      handled += 1;
    }

    const nextOffset = maxUpdateId >= 0 ? maxUpdateId + 1 : (offset ?? 0);
    return { nextOffset, handled, skipped };
  }

  async runPollingLoop(signal: AbortSignal): Promise<void> {
    let offset: number | undefined;
    while (!signal.aborted) {
      try {
        const result = await this.pollOnce(offset);
        offset = result.nextOffset;
      } catch {
        // Swallow transient transport/normalize errors and back off briefly so
        // the loop stays alive across network blips.
        await delay(TRANSIENT_ERROR_DELAY_MS);
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
