const SECRET_KEY = /token|secret|key|password|passwd|authorization|cookie|bearer/i;
const BEARER = /\bbearer\s+[A-Za-z0-9._-]+/gi;
// Includes `-`/`_` so modern keys (sk-proj-…, sk-svcacct-…) are masked, not
// just the legacy sk-<alnum> form.
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
// Telegram bot token: <digits>:<~35 char secret>. The ':' breaks a \b boundary
// so this needs its own pattern (LONG_TOKEN alone misses it).
const TELEGRAM_BOT_TOKEN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;
// Password in a URL userinfo (postgresql://user:pass@host, redis://…, http
// basic auth). Auto-generated DB passwords are short and slip past LONG_TOKEN,
// so mask the userinfo password explicitly, regardless of length. Keeps the
// scheme + user visible, drops the secret.
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s/@]+@/gi;

const REDACTED = "<redacted>";

/** Mask secret-looking substrings in a string (logs, prompts, artifacts). */
export function redactString(input: string): string {
  return input
    .replace(URL_USERINFO, "$1:<redacted>@")
    .replace(BEARER, "bearer <redacted>")
    .replace(TELEGRAM_BOT_TOKEN, REDACTED)
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
