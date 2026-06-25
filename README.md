# Param

Param is an ambient Telegram-first chat friend built on Eve.

He is not a helpful assistant. He should feel like a real participant in chats:
casual, concise, witty, sometimes sarcastic, able to reply, react, stay quiet,
remember, use tools, and spawn helper agents.

Read [PARAM.md](./PARAM.md) for the current product vision, feature set, and
architecture.

## Stack

- Eve
- TypeScript
- Bun for package management and scripts
- Telegram webhooks
- Vercel/Eve durable agent runtime
- Sandboxes or runtime adapters for native work

## Setup

Eve requires Node.js 24.

```bash
bun install
```

Set env vars from `.env.example`.

Telegram:

```bash
bun run telegram:me
```

Copy the printed `TELEGRAM_BOT_ID` and `TELEGRAM_BOT_USERNAME` values into
your env. Configure `PARAM_ALLOWED_TELEGRAM_USER_IDS`,
`PARAM_ALLOWED_TELEGRAM_CHAT_IDS`, and `PARAM_TRUSTED_TELEGRAM_USER_IDS` before
testing with real chats. Empty allowed lists deny Telegram traffic unless
`PARAM_ALLOW_UNRESTRICTED_TELEGRAM=true`.

Set `PARAM_TRUSTED_TELEGRAM_MENTIONS` to comma-separated Telegram handles, like
`@alice,@bob`, so group approval prompts can ping the trusted reviewers. The
IDs in `PARAM_TRUSTED_TELEGRAM_USER_IDS` are still the authority check.

After deployment, set `PARAM_PUBLIC_BASE_URL` to the public HTTPS app origin,
then register the webhook:

```bash
bun run telegram:webhook:set
bun run telegram:webhook:get
```

The Telegram channel receives updates at `/eve/v1/telegram`.
If `TELEGRAM_WEBHOOK_URL` is set instead, it must be the full URL ending in
`/eve/v1/telegram`.

Database:

```bash
bun run db:migrate
bun run db:check
bun run db:smoke
```

`DATABASE_URL` should point at Neon/serverless Postgres for the current runtime
client. Migrations are committed; do not use `drizzle-kit push` for repo schema
changes.

`db:smoke` writes a temporary profile plus private and shared memory, verifies
that context loading can see them, then deletes the temporary rows.

When changing schema, run `bun run db:generate` and commit the generated
migration.

Run locally:

```bash
bun x eve dev
```

Do not run `eve dev` from automation; it opens an interactive TUI.
