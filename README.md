# Param Agent

Param is an always-online ambient chat agent.

The first target is Telegram. The long-term shape supports more communication
channels, persistent memory, task agents, generated UI, runtime adapters for
agent CLIs, and reviewed server self-management.

Param is intended to run natively on Linux, macOS, and Windows. The first
production target is still a Linux VPS, but local setup and host-install design
should stay cross-platform from the start.

Param should feel like a regular friend in a chat, not a command bot or a
helpful-assistant helpdesk.

## Start Here

For implementation agents:

```text
AGENTS.md
docs/IMPLEMENTATION_GUIDE.md
docs/DECISIONS.md
docs/DEPENDENCIES.md
docs/PROJECT_STRUCTURE.md
```

For humans:

```text
docs/README.md
docs/IMPLEMENTATION_GUIDE.md
docs/DECISIONS.md
```

Do not read every doc before implementing. The docs are reference material.
Load only the subsystem docs needed for the current change.

## Current State

This repo currently contains architecture docs plus the first runnable Bun /
TypeScript scaffold:

```text
bun run setup
bun run doctor
bun run check
```

`setup` creates missing local `.env` and `param.config.local.ts` files.
`doctor` prints the effective config in redacted form.
`check` runs typecheck and tests.

The referenced systems live in:

```text
references/hermes-agent
references/openclaw
```

Those directories are reference submodules. Treat them as read-only unless a
task explicitly says otherwise.

## Default Stack

```text
Bun
TypeScript
Hono
Drizzle
Bun SQL
local Postgres + pgvector
Vercel Chat SDK
Codex CLI runtime adapter
MCP TypeScript SDK
Zod
```

Detailed package choices live in `docs/DEPENDENCIES.md`.
