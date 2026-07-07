# Deploying Param

Concrete steps to run Param (an Eve app) and wire up Telegram. High-level
rationale is in `GOAL.md`; the full env-var list with comments is in
`.env.example`.

**Where Param runs:** inference goes through your Codex (ChatGPT Plus/Pro)
subscription via the Codex CLI (`ai-sdk-provider-codex-cli`). That CLI is a local
binary, so Param must run on a host where it's installed and logged in — a VM,
server, or container with a persistent process (`eve start`), **not** a Vercel
serverless function. (Serverless can't spawn the CLI. If you ever want the
serverless deploy back, switch `agent/agent.ts` to a gateway/API model.)

## 1. Prerequisites (you provide)

- A Telegram bot from [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`;
  note its username and numeric id.
- A host you control with a **public HTTPS URL** (domain, reverse proxy, or
  tunnel) for the Telegram webhook.
- The **Codex CLI**, installed and logged in on that host:
  `npm i -g @openai/codex && codex login` (stores tokens in `~/.codex/auth.json`).
- A strong random string for `TELEGRAM_WEBHOOK_SECRET_TOKEN` (you choose it).
- For persistent memory and Action Review audit: a managed Postgres (e.g. Neon)
  → `DATABASE_URL`. Param runs without it, but memory won't persist and audit is
  disabled.
- Your Telegram user id(s) for the allow/trust lists.

## 2. Set up the host

```bash
git clone <repo> && cd param-agent
bun install
npm i -g @openai/codex && codex login   # if not already done
cp .env.example .env                     # then fill it in (next section)
```

## 3. Environment variables

Fill `.env` (or export in the process environment). Required:

- `PARAM_CODEX_MODEL` (e.g. `gpt-5.5`) and `PARAM_CODEX_CONTEXT_WINDOW` (feeds compaction)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_ID`
- `PARAM_PUBLIC_BASE_URL` — the host's public origin (used to register the webhook)
- `PARAM_ALLOWED_TELEGRAM_USER_IDS`, `PARAM_TRUSTED_TELEGRAM_USER_IDS`
  (keep allowed ≠ trusted)

Recommended: `DATABASE_URL`, plus `PARAM_INTERNAL_API_SECRET` and
`PARAM_INTERNAL_API_ORIGIN` (the internal memory API). Optional:
`PARAM_PROACTIVE_TELEGRAM_CHAT_IDS`, `PARAM_TELEGRAM_MAX_MESSAGES`.

Fail-closed: with no `TELEGRAM_WEBHOOK_SECRET_TOKEN`, the webhook rejects every
update, so the bot stays silent.

## 4. Database (if using memory/audit)

```bash
bun run db:migrate
bun run db:smoke     # optional sanity check
```

## 5. Build and run

```bash
bun run build        # eve build
bun run start        # eve start — serves /eve/v1/telegram and runs the proactive cron in-process
```

Keep this process alive (systemd, pm2, a container, etc.) and expose its port
behind your public HTTPS URL.

## 6. Register the Telegram webhook

With `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, and
`PARAM_PUBLIC_BASE_URL` set:

```bash
bun run telegram:webhook:set
bun run telegram:webhook:get          # verify url + pending count
```

This registers `<PARAM_PUBLIC_BASE_URL>/eve/v1/telegram` with the secret token
and `allowed_updates: [message, callback_query]`.

## 7. Verify

- DM the bot from an allowed user → Param replies (the first turn also confirms
  Codex auth is working; watch the process logs).
- Exercise a reaction or a `[[param:link:…]]` button.
- Set `PARAM_PROACTIVE_TELEGRAM_CHAT_IDS` to enable proactive wakes.

## Not implemented yet

Vercel Workflows, memory-review, pgvector search, adapter runners, and Mini Apps
remain unbuilt (see `GOAL.md` → "Current Known Gaps").
