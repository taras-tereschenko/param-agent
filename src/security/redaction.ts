const SECRET_KEY = /token|secret|key|password|passwd|authorization|cookie|bearer/i;
const BEARER = /\bbearer\s+[A-Za-z0-9._-]+/gi;
const OPENAI_KEY = /\bsk-[A-Za-z0-9]{8,}\b/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;

const REDACTED = "<redacted>";

/** Mask secret-looking substrings in a string (logs, prompts, artifacts). */
export function redactString(input: string): string {
  return input
    .replace(BEARER, "bearer <redacted>")
    .replace(OPENAI_KEY, REDACTED)
    .replace(LONG_TOKEN, REDACTED);
}

/**
 * Recursively redact values whose key looks secret, and mask secret-looking
 * strings anywhere. Used before writing logs, traces, or audit metadata.
 */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(item);
    }
    return out;
  }
  return value;
}
