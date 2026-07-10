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
PARAM.md
GOAL.md
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

The full VPS/native system is implemented as modular subsystems with a
deterministic orchestrator, an LLM-pluggable Session Actor, Action Review,
scoped memory, runtime adapters, scheduler, UI renderer, task agents, and
end-to-end worker wiring.

One-shot bootstrap on a fresh host (installs deps + bun, clones, installs local
Postgres+pgvector, runs the config questions, migrates — see `docs/DEPLOY_VPS.md`):

```text
curl -fsSL https://raw.githubusercontent.com/taras-tereschenko/param-agent/feat/param-implementation/scripts/bootstrap.sh -o bootstrap.sh && bash bootstrap.sh --with-postgres
```

Or the individual scripts:

```text
bun install
bun run setup          # create missing .env + param.config.local.ts, check runtimes
bun run check          # typecheck + unit tests (no live Telegram/Postgres needed)
bun run host-install --dry-run   # print the cross-platform install action plan
bun run db:migrate     # apply schema + pgcrypto/vector + semantic indexes
bun run db:check       # verify extensions + core/extended tables
bun run test:db        # integration tests (needs PARAM_TEST_DATABASE_URL)
bun run discover-telegram   # print recent Telegram ids (needs TELEGRAM_BOT_TOKEN)
bun run start          # Hono app (health/webhook/mini-app/operator)
bun run start:worker   # polling + jobs + actor runs + recovery
```

Implemented subsystems: `src/contracts` (typed event/output/tool/UI/runtime
contracts), `src/db` (Drizzle schema + migrations + repositories),
`src/prompts` (compiler with the verbatim human-text base), `src/orchestrator`
(session keys, batching, steering, locks, recovery), `src/channels/telegram`
(access policy, normalization, transport, delivery), `src/actor` (inference
interface, MockActor, validation, style guard, runner), `src/action-review`,
`src/memory` (scope isolation, ranking, review, compaction), `src/tools`
(registry, policy, executor, MCP), `src/runtimes` (Codex/OpenCode/Antigravity
adapters + placeholders), `src/skills`, `src/scheduler`, `src/ui`,
`src/task-agents`, `src/ops`, `src/observability`, `src/security`.

`docs/IMPLEMENTATION_STATUS.md` records exactly what is wired end-to-end versus
staged, so the target-architecture docs never conflict with the code.

### Session Actor inference

The Codex CLI chat-brain path is a first-class target but is unproven in this
build environment. See `docs/CODEX_CHAT_BRAIN_PROOF.md` for the gate result,
exact blockers, and the safe pluggable fallback (the deterministic `MockActor`
drives the full loop until a real inference path is configured).

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
Codex / OpenCode / Antigravity runtime adapters
MCP TypeScript SDK
Zod
```

Detailed package choices live in `docs/DEPENDENCIES.md`.

Important: the actor inference path must be proven before building large
features. Runtime CLIs are task adapters by default, not guaranteed chat model
providers.
