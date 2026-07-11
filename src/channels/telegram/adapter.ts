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
  /** Called when a single update fails to normalize/handle (non-fatal). */
  onError?: (error: unknown, update: TelegramUpdate) => void;
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
      // Advance the offset for every update BEFORE any fallible work so a
      // single poison update (bad payload, transient handler error) can never
      // stall the whole poll loop by re-fetching the same update forever.
      if (update.update_id > maxUpdateId) {
        maxUpdateId = update.update_id;
      }

      if (await this.handleUpdate(update)) {
        handled += 1;
      } else {
        skipped += 1;
      }
    }

    const nextOffset = maxUpdateId >= 0 ? maxUpdateId + 1 : (offset ?? 0);
    return { nextOffset, handled, skipped };
  }

  /**
   * Normalize + access-check + hand off ONE update through the same pipeline as
   * polling. Returns true when the update was handed to onInbound, false when
   * it was skipped (unsupported, access-denied, or a non-fatal handler error).
   * Reused by both the poll loop and the webhook intake path so there is a
   * single normalize/access implementation.
   */
  async handleUpdate(update: TelegramUpdate): Promise<boolean> {
    try {
      const inbound = normalizeTelegramUpdate(update, {
        accountId: this.opts.accountId,
        botUserId: this.opts.botUserId,
        botUsername: this.opts.botUsername,
      });
      if (!inbound) {
        return false;
      }

      const decision = evaluateTelegramAccess(
        inbound.access,
        this.opts.accessLists,
      );
      if (!decision.allowed) {
        // Both "ignore" and "audit_minimal" drop the update here. The audit
        // sink is wired in a higher layer; the adapter never surfaces the
        // content of unauthorized traffic.
        return false;
      }

      await this.opts.onInbound(inbound, update);
      return true;
    } catch (error) {
      // One bad update must not block newer ones. Drop it and keep going.
      this.opts.onError?.(error, update);
      return false;
    }
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
