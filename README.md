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

Database:

```bash
bun run db:generate
bun run db:migrate
bun run db:check
```

`DATABASE_URL` should point at Postgres. Neon is the expected serverless
default. Migrations are committed; do not use `drizzle-kit push` for repo schema
changes.

Run locally:

```bash
bun x eve dev
```

Do not run `eve dev` from automation; it opens an interactive TUI.
