import "dotenv/config";

type TelegramCommand = "me" | "webhook:get" | "webhook:set" | "webhook:delete";

interface TelegramApiResponse<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
  readonly error_code?: number;
}

interface TelegramUserResult {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name?: string;
  readonly username?: string;
}

interface TelegramWebhookInfo {
  readonly url?: string;
  readonly has_custom_certificate?: boolean;
  readonly pending_update_count?: number;
  readonly last_error_date?: number;
  readonly last_error_message?: string;
  readonly max_connections?: number;
  readonly allowed_updates?: readonly string[];
}

const command = process.argv[2] as TelegramCommand | undefined;

function usage() {
  console.log(`Usage:
  bun run telegram:me
  bun run telegram:webhook:get
  bun run telegram:webhook:set
  bun run telegram:webhook:delete

Required env:
  TELEGRAM_BOT_TOKEN

Required for webhook:set:
  TELEGRAM_WEBHOOK_SECRET_TOKEN
  PARAM_PUBLIC_BASE_URL or TELEGRAM_WEBHOOK_URL`);
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requireEnv(name: string) {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function boolEnv(name: string, fallback = false) {
  const value = optionalEnv(name)?.toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function publicBaseUrl() {
  const raw =
    optionalEnv("PARAM_PUBLIC_BASE_URL")
    ?? optionalEnv("VERCEL_PROJECT_PRODUCTION_URL")
    ?? optionalEnv("VERCEL_URL");

  if (!raw) {
    throw new Error("PARAM_PUBLIC_BASE_URL or TELEGRAM_WEBHOOK_URL is required for webhook:set");
  }

  const withProtocol = /^https?:\/\//u.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/u, "");
}

function requireHttpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`Telegram webhook URL must use https: ${value}`);
  }
  return url.toString();
}

function webhookUrl() {
  const explicit = optionalEnv("TELEGRAM_WEBHOOK_URL");
  if (explicit) {
    const url = new URL(requireHttpsUrl(explicit));
    if (!url.pathname.endsWith("/eve/v1/telegram")) {
      throw new Error(
        "TELEGRAM_WEBHOOK_URL must be the full webhook URL ending in /eve/v1/telegram. Use PARAM_PUBLIC_BASE_URL for an app origin.",
      );
    }
    return url.toString();
  }

  return requireHttpsUrl(`${publicBaseUrl()}/eve/v1/telegram`);
}

async function telegramApi<T>(method: string, body?: Record<string, unknown>) {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json().catch(() => undefined)) as
    | TelegramApiResponse<T>
    | undefined;

  if (!response.ok || !payload?.ok) {
    const description = payload?.description ?? response.statusText;
    const code = payload?.error_code ?? response.status;
    throw new Error(`Telegram API ${method} failed (${code}): ${description}`);
  }

  return payload.result as T;
}

async function run() {
  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === "me") {
    const me = await telegramApi<TelegramUserResult>("getMe");
    console.log(JSON.stringify(me, null, 2));
    if (me.username) {
      console.log(`\n.env values:`);
      console.log(`TELEGRAM_BOT_ID=${me.id}`);
      console.log(`TELEGRAM_BOT_USERNAME=${me.username}`);
    }
    return;
  }

  if (command === "webhook:get") {
    const info = await telegramApi<TelegramWebhookInfo>("getWebhookInfo");
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (command === "webhook:set") {
    const url = webhookUrl();
    const result = await telegramApi<boolean>("setWebhook", {
      url,
      secret_token: requireEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN"),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: boolEnv("TELEGRAM_DROP_PENDING_UPDATES", false),
    });
    console.log(JSON.stringify({ ok: result, url }, null, 2));
    return;
  }

  if (command === "webhook:delete") {
    const result = await telegramApi<boolean>("deleteWebhook", {
      drop_pending_updates: boolEnv("TELEGRAM_DROP_PENDING_UPDATES", false),
    });
    console.log(JSON.stringify({ ok: result }, null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
