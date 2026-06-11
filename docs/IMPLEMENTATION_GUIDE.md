# Param Agent Implementation Guide

This is the navigation layer for implementation agents.

The docs are intentionally detailed, but they are not meant to be loaded all at
once. Read the minimal set for the work in front of you.

## One-Screen Summary

Param is an always-online Telegram-first ambient chat agent.

He should feel like a regular friend in a chat, not a command bot or helpful
assistant.

The system shape:

```text
Telegram / future channels
  -> Channel Adapter
  -> Orchestrator
  -> Context Builder + Prompt Compiler
  -> Session Actor
  -> Validators + Action Review
  -> Delivery / Tools / Runtime Adapters / Memory
```

The most important boundary:

```text
Code decides when an actor is allowed to think.
The actor decides what the moment means.
Code validates what the actor wants to do.
```

## How To Read The Docs

Always read first:

- `DECISIONS.md`
- `DEPENDENCIES.md`
- `PROJECT_STRUCTURE.md`

Read next when scaffolding:

- `CONFIG.md`
- `CONTRACTS.md`
- `DATABASE.md`
- `OPS.md`

Read only when touching that subsystem:

- Telegram/channel work: `CHANNELS.md`, `channels/TELEGRAM.md`
- Actor/prompt work: `PROMPTS.md`, `CONTRACTS.md`
- Memory/compaction: `MEMORY.md`, `DATABASE.md`
- Tool execution: `TOOLS.md`, `ACTION_REVIEW.md`, `SECURITY.md`
- Runtime CLIs: `RUNTIME_ADAPTERS.md`, `TASK_AGENTS.md`
- Scheduled ambient turns: `SCHEDULER.md`
- Generated UI/Mini Apps: `UI.md`
- Observability/debugging: `OBSERVABILITY.md`, `EVALS.md`
- VPS/install/recovery: `OPS.md`

Use `BUILD_SPEC.md` only when you need the full narrative.

Use `REFERENCES.md` only when checking why a decision was made or where an
external fact came from.

## Implementation Order

This order is about reducing risk, not limiting the final product.

### 1. Repo Bootstrap

Create the runnable TypeScript/Bun project:

- `package.json`
- `bun.lockb`
- `tsconfig.json`
- `drizzle.config.ts`
- `.env.example`
- `param.config.ts`
- ignored `param.config.local.ts` template generation script
- `src/` layout from `PROJECT_STRUCTURE.md`

Acceptance check:

```text
bun install
bun run typecheck
bun test
```

### 2. Config And Contracts

Build the typed foundation:

- config loader
- env validation
- redacted config summary
- ids
- internal events
- actor output contracts
- action review contracts
- runtime adapter contracts

Acceptance check:

```text
invalid config fails loudly
sample internal events parse
sample actor outputs parse
```

### 3. Database Foundation

Build persistence before actors:

- Drizzle schema
- Bun SQL client
- migrations
- sessions
- events
- jobs
- audit log
- raw channel payloads

Acceptance check:

```text
migrations run
events persist
jobs can be claimed with locks
reboot recovery query has a test
```

### 4. Telegram Channel Skeleton

Get messages in and out without intelligence first:

- Chat SDK Telegram adapter wiring
- long polling mode
- internal event mapping
- raw payload storage
- outbound text/reaction delivery shell
- dedupe by Telegram update/message ids

Acceptance check:

```text
one Telegram event becomes one Param event
duplicate event is ignored
test delivery writes an outbound record before sending
```

### 5. Orchestrator And Worker Loops

Build deterministic mechanics:

- session resolver
- batching
- one active run per session
- steering buffer
- job enqueue/claim/complete
- worker recovery

Acceptance check:

```text
new event creates or updates one session
same-session event during active run becomes steering
stale output cannot deliver
```

### 6. Mock Actor Path

Connect the full loop with a fake actor before real models:

- context builder
- prompt packet reference
- mock Session Actor
- output validation
- durable output events
- delivery through Telegram adapter shell

Acceptance check:

```text
incoming message -> actor job -> validated output -> delivery record
```

### 7. Real Actor And Style Guard

Add model-backed actor behavior:

- AI SDK direct model calls
- prompt packet compiler
- structured actor output
- visible style guard
- no-reply/reaction/reply/tool decision handling

Acceptance check:

```text
actor can reply, react, stay quiet, and request a tool
visible text follows Param voice rules
```

### 8. Action Review And Tools

Add side-effect safety before powerful tools:

- tool registry
- safe auto-run list
- auto-review
- trusted user approval in DMs and groups
- exact proposal approval
- audit records

Acceptance check:

```text
non-trusted requester cannot execute consequential action directly
trusted approval is tied to sender id and exact proposal
```

### 9. Memory And Compaction

Make Param remember and use memory:

- memory retrieval
- memory review actor
- scoped memory records
- provenance/confidence
- summaries
- recent raw tail after compaction

Acceptance check:

```text
actor receives relevant memory with provenance
group memory does not leak into private user memory
latest messages survive compaction
```

### 10. Runtime Adapters

Add external agent CLIs behind adapters:

- Codex adapter
- OpenCode adapter
- Antigravity adapter
- runtime event stream
- artifact/log capture
- cancellation or steering fallback
- Action Review wrapping

Acceptance check:

```text
runtime cannot bypass Param approval for consequential actions
adapter reports real capabilities for installed runtime version
```

### 11. Scheduler And Proactivity

Add ambient presence:

- scheduled ambient turns
- cron-style jobs
- cooldowns
- active-hour rules
- group quietness rules
- proactive actor decision

Acceptance check:

```text
scheduled wake can produce no_reply
scheduled wake can speak without being a fixed scheduled message
```

### 12. Generated UI And Mini Apps

Add richer Telegram surfaces when needed:

- structured UI specs
- Telegram inline buttons/cards
- Mini App page renderer
- shadcn theme token patches
- callback routing into sessions

Acceptance check:

```text
actor emits UI spec
renderer validates it
callback becomes a session event
consequential callback goes through Action Review
```

### 13. Installer And Operations

Make it survive a real VPS:

- Linux install script
- local Postgres + pgvector setup
- systemd services
- health checks
- backups
- log inspection
- safe service management tools

Acceptance check:

```text
fresh Linux host can install
services start on boot
worker recovers pending jobs after restart
```

## What Not To Do

- Do not start by building every subsystem.
- Do not load every doc into context.
- Do not let Telegram adapter own behavior decisions.
- Do not let runtime CLIs deliver directly to chat.
- Do not let runtime approval replace Param Action Review.
- Do not store memory without retrieval.
- Do not make Mini Apps before basic Telegram messages work.
- Do not introduce Redis, Temporal, Effect, Docker, Next.js, Prisma, LangChain,
  or a dedicated vector DB unless a new decision justifies it.

## When Lost

Use this recovery path:

1. Read `DECISIONS.md`.
2. Read only the subsystem doc for the file you are editing.
3. Check contracts in `CONTRACTS.md`.
4. Add or update a focused test.
5. Keep the change small.
