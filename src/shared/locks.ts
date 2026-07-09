import { createHash } from "node:crypto";

/**
 * Deterministic 63-bit advisory-lock key derived from a namespace + id. Used
 * for Postgres advisory locks (pg_advisory_xact_lock) that serialize work per
 * session without a dedicated lock table.
 */
export function advisoryLockKey(namespace: string, id: string): bigint {
  const digest = createHash("sha256")
    .update(`${namespace}:${id}`)
    .digest();
  // Take the first 8 bytes and clear the top bit so it fits a signed bigint.
  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value = (value << 8n) | BigInt(digest[i] ?? 0);
  }
  return value & 0x7fffffffffffffffn;
}
