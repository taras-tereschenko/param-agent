# Param Agent Operations

This file defines how Param runs on a VPS.

Core principle:

```text
Param must survive reboots, crashes, and its own maintenance actions.
```

## Purpose

Operations covers the boring machinery that keeps Param online:

- Linux install script
- local Postgres + pgvector
- systemd services
- directory layout
- `.env` and config files
- health checks
- backups
- logs and artifacts
- startup recovery
- Telegram polling recovery
- worker/job recovery
- safe self-management

The target host is a Hetzner CX23 VPS running native Linux services.

Docker is not part of the default operating model.

## Operating Model

Default deployment:

```text
Hetzner CX23 VPS
Bun
TypeScript
Hono
local Postgres + pgvector
systemd services
Telegram long polling
Tailscale for private admin access
```

Public HTTPS is optional for the core bot.

Public HTTPS becomes required for:

- Telegram webhook mode
- Telegram Mini Apps
- OAuth callbacks
- public artifact links
- any public operator endpoint

## Service Layout

Param should run as native services.

Initial services:

```text
param-app.service
  Hono HTTP/API surface, health checks, operator routes, Chat SDK/webhook handling

param-worker.service
  jobs, actor runs, Telegram polling, scheduler, memory review, compaction,
  task agents, delivery retries

postgresql.service
  local Postgres with pgvector
```

The app and worker can live in one codebase but should be separate processes.

Reasons:

- the HTTP surface can stay responsive while workers are busy
- worker crashes do not necessarily take down health/operator routes
- systemd can restart each process independently
- logs are easier to inspect

## Service User

Default service user:

```text
param
```

The installer should create the user if missing.

Rules:

- do not run Param as root by default
- grant only required directory permissions
- use sudo only for approved server-management actions
- keep runtime workspaces writable by the Param service user
- keep system config changes behind Action Review

## Directory Layout

Repository and source layout lives in `docs/PROJECT_STRUCTURE.md`.

Default paths:

```text
/opt/param-agent
  app checkout or release

/etc/param-agent
  .env and local machine config

/var/lib/param-agent
  durable app data

/var/lib/param-agent/workspaces
  runtime and task workspaces

/var/lib/param-agent/artifacts
  generated files, media, reports, screenshots

/var/lib/param-agent/skills
  installed skills, skills.sh cache, and skill indexes

/var/lib/param-agent/backups/postgres
  local database backups

/var/log/param-agent
  application logs, if not using journald only
```

Postgres stores metadata, events, jobs, and memory.

Large files stay on the filesystem with artifact rows pointing to them.

## Local Postgres

Default database mode:

```text
local-postgres
```

Required extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Recommended extensions:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

The installer should:

- install Postgres packages
- install pgvector package or build/install the extension when needed
- create database user
- create database
- enable extensions
- write `DATABASE_URL`
- run Drizzle migrations
- verify a simple connection
- verify pgvector is available

## Postgres Tuning

CX23 has enough memory for a modest local Postgres.

Use conservative defaults:

```text
shared_buffers = 256MB
max_connections = 20
work_mem = 4MB
maintenance_work_mem = 128MB
```

Param app pooling should also stay small:

```text
pool max = 5-10
```

The real resource risks are:

- runtime agents using RAM
- browser tasks using RAM
- logs/artifacts filling disk
- vector indexes growing
- bad queries scanning too much
- missing backups

Postgres itself is not the scary part if it is tuned modestly.

## Managed Postgres Option

Managed Postgres remains supported.

Supported database modes:

```text
local-postgres
  default VPS install

existing-url
  user provides DATABASE_URL

managed-neon
  optional Neon provisioning

managed-supabase
  optional Supabase provisioning
```

Cloud DB provisioning is a spend/security action when Param performs it for
itself. It requires Action Review.

The app should stay portable across local Postgres, Neon, Supabase, and any
compatible Postgres provider.

## Installer

Param needs an idempotent Linux installer.

Installer script layout lives in `docs/PROJECT_STRUCTURE.md`.

Installer goals:

- prepare a fresh VPS
- avoid overwriting existing state
- support dry-run/check mode
- print clear next steps
- leave Param able to start on boot

Installer responsibilities:

- detect Linux distribution and architecture
- install Bun
- install Git and build tools
- install Postgres and pgvector for `local-postgres`
- install runtime adapter dependencies
- create service user
- create directories
- install app dependencies
- install packages according to `docs/DEPENDENCIES.md`
- create `.env` from `.env.example` when missing
- create `param.config.local.ts` when missing
- create systemd service files
- run migrations
- enable and start services
- run health checks

The installer must not silently overwrite:

- `.env`
- `param.config.local.ts`
- existing service files
- Postgres data
- backups
- workspaces
- artifacts

If a change is risky, installer should ask for explicit confirmation.

## Installer Modes

Database install flags:

```text
--db local-postgres
  install and configure local Postgres + pgvector

--db existing-url
  use an existing DATABASE_URL

--db managed-neon
  provision or connect Neon

--db managed-supabase
  provision or connect Supabase
```

General flags:

```text
--dry-run
  show what would change

--check
  validate current install

--repair
  repair missing safe pieces without overwriting secrets/data

--yes
  accept safe prompts, never destructive prompts
```

`--yes` must not approve destructive operations.

## Environment And Config

Secrets live in `.env`.

Non-secret shared defaults live in:

```text
param.config.ts
```

Per-instance non-secret overrides live in:

```text
param.config.local.ts
```

The installer creates `param.config.local.ts` if missing with comments and an
empty override structure.

The installer creates `.env` from `.env.example` if missing.

Startup should print a redacted config summary.

Never print:

- bot tokens
- database passwords
- model API keys
- webhook secrets
- Tailscale/admin tokens
- runtime credentials

## Systemd Services

Service files should:

- run as the Param service user
- load `.env`
- set working directory
- restart on failure
- start after network and Postgres
- write logs to journald
- use conservative restart limits

Example shape:

```text
[Service]
User=param
WorkingDirectory=/opt/param-agent
EnvironmentFile=/etc/param-agent/.env
ExecStart=/usr/local/bin/bun run src/app/main.ts
Restart=on-failure
RestartSec=5
```

`param-worker.service` uses the same shape with:

```text
ExecStart=/usr/local/bin/bun run src/worker/main.ts
```

Exact service files belong in implementation, not this spec.

## Startup Sequence

On startup:

```text
1. Load and validate config.
2. Connect to Postgres.
3. Verify required extensions.
4. Run or verify migrations.
5. Acquire process roles and locks.
6. Start HTTP app.
7. Start worker loops.
8. Run recovery scan.
9. Start Telegram polling if enabled.
10. Start scheduler loop.
```

If a required dependency is missing, Param should fail loudly and stay down
instead of running half-broken.

## Reboot Recovery

After reboot, recovery workers inspect:

- active actor runs with expired locks
- running jobs with expired locks
- task runs without final results
- delivery attempts stuck in running
- tool calls stuck in running
- pending approvals past expiry
- due schedules
- Telegram polling offsets and account locks
- runtime artifacts without linked results

Recovery choices:

- resume if safe
- retry with idempotency key
- mark failed with audit
- wake parent actor with error context
- expire stale approval
- skip stale proactive wake

Recovery writes `system.recovery` events and audit rows for meaningful repairs.

## Telegram Polling Recovery

Telegram polling must not lose or replay updates.

Rules:

- persist update before advancing offset
- dedupe by bot account + `update_id`
- use one active poller per bot account
- release/expire stale polling locks after process death
- do not run polling and webhook mode for same account
- replay stored but unprocessed updates after crash

Detailed Telegram behavior lives in `docs/channels/TELEGRAM.md`.

## Job And Worker Recovery

Jobs live in Postgres.

Workers claim jobs transactionally with expiring locks.

After crash:

```text
running job + expired lock -> claimable again
completed job + same idempotency key -> do not run again
failed retryable job -> retry until max attempts
failed non-retryable job -> store failure and notify when useful
```

Jobs should be small orchestration units. Large blobs live in artifacts or raw
payload refs.

## Runtime Recovery

Runtime adapters may start subprocesses.

Recovery should inspect:

- runtime process still running
- process disappeared
- buffered output not delivered
- workspace with unreported artifacts
- task run waiting on runtime result

No buffered output should be delivered after restart until:

- context refresh passes
- output validation passes
- Action Review passes, if needed
- delivery idempotency check passes

Detailed runtime behavior lives in `docs/RUNTIME_ADAPTERS.md`.

## Backups

Local Postgres needs backups from day one.

Minimum backup plan:

- scheduled `pg_dump`
- write to `/var/lib/param-agent/backups/postgres`
- keep several recent backups
- verify backup command succeeds
- alert trusted/admin session on backup failure
- document restore command

Recommended later:

- off-server encrypted backup copy
- restore test
- backup retention policy
- artifact backup or sync policy

Backups are server-management behavior. Creating/changing backup jobs goes
through Action Review when Param does it itself.

## Logs And Artifacts

Logs should answer what happened without leaking secrets.

Store:

- app logs
- worker logs
- runtime logs
- delivery logs
- tool traces
- action review audit
- recovery audit

Artifacts can include:

- generated images
- file attachments
- reports
- patches
- screenshots
- runtime logs
- task workspaces

Retention policy should prevent disk from filling.

Disk health should be checked by server health schedules.

## Health Checks

Health checks should cover:

- app process alive
- worker process alive
- Postgres connection
- pgvector extension available
- migration state
- Telegram polling freshness
- queue backlog
- failed job rate
- scheduler loop freshness
- disk usage
- backup freshness
- runtime adapter availability

Health checks can be read-only safe auto-run tools.

Repair actions still go through Action Review.

## Self-Management

Param can manage itself and the server, but never by bypassing policy.

Read-only examples:

- check service status
- tail logs
- check disk usage
- check DB connectivity
- inspect queue backlog

Change-making examples:

- restart service
- edit config
- run migration
- install package
- rotate token
- change systemd unit
- modify firewall

Change-making actions require Action Review and usually trusted approval.

Before Param restarts itself:

- persist current state
- verify systemd will bring it back
- record restart reason
- avoid interrupting an unsafe operation
- notify a trusted/admin session when useful

Detailed approval behavior lives in `docs/ACTION_REVIEW.md`.

## Public And Private Access

Tailscale is the default private admin path.

Use Tailscale for internal operator access:

- logs/debug views
- health dashboards
- manual recovery tools
- internal callbacks when possible

Public HTTPS is only needed for public surfaces:

- Telegram webhook mode
- Telegram Mini Apps
- OAuth callbacks
- public artifacts
- external webhooks

Do not expose operator surfaces publicly unless explicitly designed and
approved.

## Tests

Ops tests should cover:

- installer dry-run does not change files
- installer creates missing local config without overwriting existing files
- local Postgres mode creates/validates pgvector extension
- managed `DATABASE_URL` mode skips local Postgres provisioning
- systemd unit templates include restart policy
- startup fails loudly on missing required secrets
- recovery reclaims expired job locks
- recovery does not duplicate delivered messages
- polling offset advances only after persistence
- backup job writes a backup artifact or clear failure
- health check detects DB failure
- self-restart requires Action Review
- redacted config summary hides secrets
