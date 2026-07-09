/**
 * Channel adapters.
 *
 * `ChannelAdapter` is a minimal marker for platform adapters; the Telegram
 * module is the first concrete implementation.
 */

export interface ChannelAdapter {
  platform: string;
}

export * from "./telegram/policy";
export * from "./telegram/normalize";
export * from "./telegram/transport";
export * from "./telegram/send";
export * from "./telegram/adapter";
export * from "./telegram/raw-store";
