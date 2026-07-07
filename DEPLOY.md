# Deploying Param

Concrete steps to deploy Param (an Eve app) to Vercel and wire up Telegram.
High-level rationale lives in `GOAL.md` → "Deployment Direction". Full env-var
list with comments is in `.env.example`.

Deploying is also what unblocks the infra-gated roadmap: Vercel provides
Workflows, a linked Postgres unlocks memory/pgvector, and env vars turn on the
proactive schedule and runtime adapters.

## 1. Prerequisites (you provide)

- A Telegram bot from [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`;
  note its username and numeric id.
- A Vercel account and project.
- An AI model key for the Vercel AI Gateway → `AI_GATEWAY_API_KEY`. The default
  model is `openai/gpt-5.4-mini`; override with `PARAM_EVE_MODEL`.
- A strong random string for `TELEGRAM_WEBHOOK_SECRET_TOKEN` (you choose it).
- For persistent memory and Action Review audit: a managed Postgres (e.g. Neon)
  → `DATABASE_URL`. Param runs without it, but memory won't persist and audit is
  disabled.
- Your Telegram user id(s) for the allow/trust lists.

## 2. Link and preview-deploy

```bash
vercel link          # create/link the Vercel project
vercel deploy        # preview build — validates the Eve build on Vercel
```

`eve build` produces the Vercel output. The Telegram webhook mounts at
`/eve/v1/telegram`, and `agent/schedules/proactive.ts` registers as a Vercel
Cron Job.

## 3. Environment variables

Set in Vercel (Settings → Environment Variables, or `vercel env add`).

Required:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `AI_GATEWAY_API_KEY` (and `PARAM_EVE_MODEL` if not using the default)
- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_ID`
- `PARAM_ALLOWED_TELEGRAM_USER_IDS`, `PARAM_TRUSTED_TELEGRAM_USER_IDS`
  (keep allowed ≠ trusted)

(`PARAM_PUBLIC_BASE_URL` is not read by the deployed app — it's only needed
locally for the webhook-registration step below.)

Recommended:

- `DATABASE_URL`, plus `PARAM_INTERNAL_API_SECRET` and `PARAM_INTERNAL_API_ORIGIN`
  (the internal memory API)

Optional:

- `PARAM_PROACTIVE_TELEGRAM_CHAT_IDS`, `PARAM_TELEGRAM_MAX_MESSAGES`,
  adapter creds (`PARAM_CODEX_API_KEY`, …)

Fail-closed: with no `TELEGRAM_WEBHOOK_SECRET_TOKEN`, the webhook rejects every
update, so the bot stays silent.

## 4. Database (if using memory/audit)

```bash
DATABASE_URL=... bun run db:migrate
DATABASE_URL=... bun run db:smoke     # optional sanity check
```

## 5. Register the Telegram webhook

With `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, and
`PARAM_PUBLIC_BASE_URL` set locally:

```bash
bun run telegram:webhook:set
bun run telegram:webhook:get          # verify url + pending count
```

This registers `<PARAM_PUBLIC_BASE_URL>/eve/v1/telegram` with the secret token
and `allowed_updates: [message, callback_query]`.

## 6. Verify

- DM the bot from an allowed user → Param replies.
- Exercise a reaction or a `[[param:link:…]]` button; watch Vercel logs.
- Vercel → Observability → Cron Jobs should list `proactive`.

## 7. Promote and enable extras

```bash
vercel deploy --prod                  # promote once the preview checks out
```

- Set `PARAM_PROACTIVE_TELEGRAM_CHAT_IDS` to enable proactive wakes.
- Adapter runners, Vercel Workflows, and pgvector search are not implemented yet
  (see `GOAL.md` → "Current Known Gaps"); deploying provides the platform they
  need, but the features still have to be built.
