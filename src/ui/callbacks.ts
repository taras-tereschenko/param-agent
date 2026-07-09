/**
 * Durable, validated callback tokens for Telegram inline buttons.
 *
 * Telegram `callback_data` is capped at 64 bytes. We encode a compact,
 * delimiter-safe token `cb:<surfaceId>:<actionId>[:<value>]`. When embedding a
 * value would exceed the byte cap we drop it and fall back to the bare token
 * form, relying on stored surface metadata to recover the original intent.
 */

export const CALLBACK_PREFIX = "cb";
export const MAX_CALLBACK_BYTES = 64;

export function buildCallbackData(
  surfaceId: string,
  actionId: string,
  value?: Record<string, unknown>,
): string {
  const token = `${CALLBACK_PREFIX}:${encodeURIComponent(
    surfaceId,
  )}:${encodeURIComponent(actionId)}`;

  if (value && Object.keys(value).length > 0) {
    const full = `${token}:${encodeURIComponent(JSON.stringify(value))}`;
    if (byteLength(full) <= MAX_CALLBACK_BYTES) return full;
  }
  return token;
}

export function parseCallbackData(data: string): {
  surfaceId?: string;
  actionId: string;
  raw: string;
} {
  const parts = data.split(":");
  if (parts[0] === CALLBACK_PREFIX && parts.length >= 3) {
    return {
      surfaceId: safeDecode(parts[1] ?? ""),
      actionId: safeDecode(parts[2] ?? ""),
      raw: data,
    };
  }
  return { actionId: data, raw: data };
}

/**
 * A received callback must match a known/allowed action for the surface.
 * Consequential (requiresApproval) callbacks are still gated by Action Review
 * downstream; this only checks that the action itself is durable + expected.
 */
export function validateCallback(
  actionId: string,
  allowed: { actionId: string }[],
): boolean {
  return allowed.some((entry) => entry.actionId === actionId);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
