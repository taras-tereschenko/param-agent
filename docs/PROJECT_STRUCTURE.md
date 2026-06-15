# Param Agent Project Structure

This file defines the target repository layout.

## Goal

The repo should make subsystem boundaries obvious.

Param is modular, but it should not become a pile of random folders. Each
directory should map to a subsystem already described in the docs.

Default package choices live in `docs/DEPENDENCIES.md`.

## Top-Level Layout

```text
.
  src/
  scripts/
  drizzle/
  docs/
  references/
  tests/
  evals/
  package.json
  bun.lock
  tsconfig.json
  drizzle.config.ts
  param.config.ts
  param.config.local.ts
  .env.example
  README.md
```

## Dependency Boundaries

Dependencies must serve a subsystem.

Examples:

- Chat SDK packages belong to `src/channels/`.
- Drizzle and Bun SQL belong to `src/db/`.
- AI SDK belongs to `src/actor/`, `src/prompts/`, task agents, and generated UI.
- MCP SDK belongs to `src/tools/mcp/`.
- shadcn-generated components belong to `src/ui/`.

Do not import subsystem-specific dependencies from unrelated modules. Use
Param contracts at module boundaries.

## Source Layout

```text
src/
  app/
  worker/
  config/
  db/
  channels/
  orchestrator/
  actor/
  prompts/
  contracts/
  security/
  memory/
  tools/
  skills/
  runtimes/
  task-agents/
  action-review/
  ui/
  scheduler/
  ops/
  observability/
  artifacts/
  shared/
```

## Runtime Entrypoints

```text
src/app/main.ts
  starts the Hono HTTP process

src/worker/main.ts
  starts workers: Telegram polling, jobs, scheduler, actor runs, delivery

src/config/main.ts
  loads typed config and environment
```

`param-app.service` runs `src/app/main.ts`.

`param-worker.service` runs `src/worker/main.ts`.

The app and worker share modules, config, database access, contracts, and audit
code.

## App Module

```text
src/app/
  main.ts
  server.ts
  routes/
    health.ts
    webhooks.ts
    mini-apps.ts
    operator.ts
```

Responsibilities:

- Hono server
- health checks
- optional Telegram webhook endpoint
- external callback endpoints
- Telegram Mini App pages/assets
- internal operator endpoints behind private access

The app process should not run long actor work directly. It should persist
events and enqueue work.

## Worker Module

```text
src/worker/
  main.ts
  loops/
    telegram-polling.ts
    jobs.ts
    scheduler.ts
    delivery.ts
    memory-review.ts
    compaction.ts
```

Responsibilities:

- Telegram long polling
- durable job execution
- actor runs
- scheduled ambient wakes
- memory review
- compaction
- task-agent supervision
- delivery retries
- reboot recovery

## Config Module

```text
src/config/
  define.ts
  schema.ts
  load.ts
  env.ts
  redact.ts
  defaults.ts
```

Responsibilities:

- load `param.config.ts`
- load optional `param.config.local.ts`
- load `.env`
- validate with Zod
- produce redacted config summaries
- fail loudly on missing required secrets

`param.config.local.ts` is ignored by git and created by setup if missing.

## Database Module

```text
src/db/
  client.ts
  schema/
  migrations/
  repositories/
  transactions.ts
```

Responsibilities:

- Drizzle schema
- migrations
- query helpers
- transaction boundaries
- advisory locks
- typed repositories

Database structure is documented in `docs/DATABASE.md`.

## Contracts Module

```text
src/contracts/
  ids.ts
  events.ts
  actor-output.ts
  tool.ts
  ui.ts
  action-review.ts
  runtime.ts
```

Responsibilities:

- shared TypeScript types
- Zod validators
- event contracts
- actor output contracts
- tool input/result contracts

Nothing should pass between major modules without a contract.

## Security Module

```text
src/security/
  redaction.ts
  secrets.ts
  network-policy.ts
  url-safety.ts
  threat-events.ts
```

Responsibilities:

- shared redaction helpers
- secret reference handling
- network safety checks
- SSRF protections
- URL and redirect validation
- security event helpers

Security behavior is documented in `docs/SECURITY.md`.

## Channels Module

```text
src/channels/
  index.ts
  telegram/
    adapter.ts
    polling.ts
    webhook.ts
    send.ts
    reactions.ts
    callbacks.ts
    mini-apps.ts
    raw-store.ts
```

Responsibilities:

- receive platform events
- normalize events into Param contracts
- preserve raw payloads
- send messages/reactions/files/buttons
- validate platform limits
- keep Telegram details out of core modules

Channel behavior is documented in `docs/CHANNELS.md` and
`docs/channels/TELEGRAM.md`.

## Orchestrator Module

```text
src/orchestrator/
  router.ts
  session-resolver.ts
  batching.ts
  locks.ts
  steering.ts
  run-queue.ts
  recovery.ts
```

Responsibilities:

- deterministic routing
- session resolution
- batching
- active-run locks
- live steering inbox
- run enqueueing
- restart recovery

The orchestrator is deterministic code, not an LLM.

## Actor Module

```text
src/actor/
  runner.ts
  context-builder.ts
  prompt-compiler.ts
  output-parser.ts
  output-validator.ts
  style-guard.ts
  run-summary.ts
```

Responsibilities:

- build context packets
- include memory, skills, tools, platform capabilities, and steering
- compile prompt layers
- call model/runtime when needed
- parse and validate actor outputs
- ensure visible output passes voice/style checks

Prompt behavior is documented in `docs/PROMPTS.md`.

## Memory Module

```text
src/memory/
  retrieve.ts
  review.ts
  store.ts
  forget.ts
  embeddings.ts
  scopes.ts
```

Responsibilities:

- retrieve relevant memory
- review conversations for memory candidates
- store and forget memory
- enforce scope and provenance
- call embeddings
- track `memoryUsed` and `ignoredMemory`

Memory behavior is documented in `docs/MEMORY.md`.

## Tools Module

```text
src/tools/
  registry.ts
  discovery.ts
  executor.ts
  policy.ts
  result.ts
  mcp/
  local/
    system.ts
    logs.ts
    fs.ts
    git.ts
    shell.ts
    packages.ts
    service.ts
    telegram.ts
    artifact.ts
    image.ts
    skills.ts
```

Responsibilities:

- normalize local/MCP/runtime/channel tools
- expose tool metadata to actors
- validate tool inputs and results
- apply policy before execution
- route tool calls through Action Review
- produce `tool.result` events

Tool behavior is documented in `docs/TOOLS.md`.

## Skills Module

```text
src/skills/
  registry.ts
  discovery.ts
  installer.ts
  indexer.ts
  loader.ts
  trust.ts
  skills-sh.ts
```

Responsibilities:

- skills.sh search and metadata
- install/update skills through reviewed actions
- index installed skills
- load skill summaries and full content progressively
- enforce skill trust/scope policy

Skills behavior is documented in `docs/SKILLS.md`.

## Runtime Adapters Module

```text
src/runtimes/
  index.ts
  base.ts
  codex/
  opencode/
  antigravity/
  image/
  browser/
  custom-cli/
```

Responsibilities:

- call Codex/OpenCode/Antigravity/other runtimes
- prepare workspaces
- buffer output
- handle live steering when supported
- normalize runtime results
- prevent runtime-specific approval from bypassing Param policy

Runtime behavior is documented in `docs/RUNTIME_ADAPTERS.md`.

## Task Agents Module

```text
src/task-agents/
  registry.ts
  spawn.ts
  supervisor.ts
  context.ts
  result.ts
```

Responsibilities:

- spawn helper agents
- enforce budgets and tool scopes
- isolate task sessions
- report results back to the Session Actor

Task-agent behavior is documented in `docs/TASK_AGENTS.md`.

## Action Review Module

```text
src/action-review/
  classify.ts
  policy.ts
  approval-request.ts
  approval-response.ts
  trusted-users.ts
  audit.ts
```

Responsibilities:

- classify risk
- verify requester and approver identities
- enforce trusted scopes
- create approval requests
- resume approved actions
- deny unsafe actions

Action Review behavior is documented in `docs/ACTION_REVIEW.md`.

## UI Module

```text
src/ui/
  renderer.ts
  schemas/
  telegram/
    buttons.ts
    cards.ts
    mini-apps.ts
  theme/
    shadcn-tokens.ts
    validator.ts
```

Responsibilities:

- validate `render_ui` specs
- render Telegram messages/buttons/cards
- render Telegram Mini App pages when needed
- validate callbacks
- validate shadcn theme-token patches

UI behavior is documented in `docs/UI.md`.

## Scheduler Module

```text
src/scheduler/
  schedules.ts
  ambient-wakes.ts
  cooldowns.ts
  due-jobs.ts
```

Responsibilities:

- scheduled ambient wakes
- cooldowns
- catch-up after reboot
- schedule changes through Action Review

Scheduler behavior is documented in `docs/SCHEDULER.md`.

## Ops Module

```text
src/ops/
  health.ts
  service-status.ts
  backups.ts
  self-management.ts
  install/
```

Responsibilities:

- health checks
- service status
- backup/restore helpers
- self-management tools
- install-script helpers

Ops behavior is documented in `docs/OPS.md`.

## Observability Module

```text
src/observability/
  logger.ts
  audit.ts
  traces.ts
  metrics.ts
  decisions.ts
  health.ts
  redaction.ts
```

Responsibilities:

- structured logs
- audit records
- redacted traces
- metrics
- decision records
- health snapshots
- explain why Param replied, stayed quiet, or acted

Observability behavior is documented in `docs/OBSERVABILITY.md`.

## Artifacts Module

```text
src/artifacts/
  store.ts
  paths.ts
  metadata.ts
  cleanup.ts
```

Responsibilities:

- generated files
- images
- reports
- screenshots
- Mini App public artifacts, when configured

## Shared Module

```text
src/shared/
  errors.ts
  ids.ts
  time.ts
  json.ts
  locks.ts
  result.ts
```

Only truly cross-cutting utilities belong here.

Do not turn `shared/` into a junk drawer.

## Scripts

```text
scripts/
  setup.ts
  install.ts
  install/
    linux.ts
    macos.ts
    windows.ts
  installer-prompts.ts
  runtime-install.ts
  telegram-id-discovery.ts
  doctor.ts
  service-control.ts
  db-migrate.ts
  db-backup.ts
  db-restore.ts
  create-local-config.ts
```

Script responsibilities:

- run the first local setup pass through `scripts/setup.ts`
- install dependencies on fresh or existing Linux, macOS, and Windows hosts
- install/check selected CLI runtimes from setup checklist
- display installer prompts and checkboxes through `@clack/prompts`
- help discover Telegram owner/group ids during setup
- create directories and service user/account
- create `.env` and `param.config.local.ts` if missing
- install/configure local Postgres + pgvector
- run Drizzle migrations
- install native service files
- check health
- manage safe service operations

Scripts should be idempotent. They must not silently overwrite data, secrets,
service files, or local config.

`scripts/setup.ts` is the early interactive local setup entrypoint. It creates
missing `.env` and `param.config.local.ts` files and checks selected runtimes.
It does not install Linux packages, create service users, configure Postgres, or
write native service files.

## Install Script Contract

`scripts/install.ts` is the main installer entrypoint.

Host-specific behavior lives under:

```text
scripts/install/linux.ts
scripts/install/macos.ts
scripts/install/windows.ts
```

The shared installer owns prompts, flags, action planning, validation, and
idempotency rules. Host adapters own package managers, service managers, path
conventions, shell differences, service accounts, and OS-specific commands.

It should support:

```text
--dry-run
--yes
--mode local-postgres
--mode existing-url
--skip-systemd
--skip-service
--skip-postgres
--create-local-config
--owner-telegram-user-id <id>
--discover-telegram-ids
--runtime codex
--runtime opencode
--runtime antigravity
--runtime all
--runtime none
--check
```

Installer phases:

1. Detect OS, version, architecture, shell, and package manager.
2. Verify Bun is installed or install it after approval.
3. Install system packages.
4. Ask runtime install checklist unless runtime flags are provided.
5. Install/check selected CLI runtimes.
6. Create service user/account if needed.
7. Create directories.
8. Collect owner Telegram user id when missing.
9. Create `.env` from `.env.example` if missing.
10. Create `param.config.local.ts` if missing.
11. Install/configure Postgres when using local mode.
12. Enable pgvector.
13. Run migrations.
14. Install native services.
15. Start services.
16. Run doctor checks.

The installer should print an action plan before making changes.

## Tests And Evals Layout

```text
tests/
  unit/
  integration/
  fixtures/

evals/
  scenarios/
  fixtures/
  rubrics/
  reports/
```

Testing and eval behavior is documented in `docs/EVALS.md`.

## Import Rules

Recommended dependency direction:

```text
contracts/shared
  <- db/config/security/observability
  <- tools/skills/memory/ui/channels/runtimes
  <- actor/orchestrator/action-review/task-agents/scheduler
  <- app/worker/scripts
```

Rules:

- channel modules should not import actor internals
- runtime adapters should not bypass Tool Registry or Action Review
- tools should not call actor code
- skills should not execute tools directly
- UI Renderer should not decide chat meaning
- orchestrator should not contain prompt/personality logic
- `shared/` should stay boring and small

## Naming

Use kebab-case for directories.

Use clear file names over vague buckets:

```text
good: action-review/policy.ts
bad: utils/stuff.ts
```

Use `index.ts` only for exports. Do not hide meaningful behavior in barrel
files.

## References

- Operations: `docs/OPS.md`
- Config: `docs/CONFIG.md`
- Database: `docs/DATABASE.md`
- Contracts: `docs/CONTRACTS.md`
- Tools: `docs/TOOLS.md`
- Skills: `docs/SKILLS.md`
