# Param Agent Operations

This file defines how Param runs on native hosts.

Core principle:

```text
Param must survive reboots, crashes, and its own maintenance actions.
```

## Purpose

Operations covers the boring machinery that keeps Param online:

- cross-platform setup flow
- Linux, macOS, and Windows install adapters
- local Postgres + pgvector
- native services
- directory layout
- `.env` and config files
- health checks
- backups
- logs and artifacts
- startup recovery
- Telegram polling recovery
- worker/job recovery
- safe self-management

Linux, macOS, and Windows are first-class supported hosts.

The first production target is still a Hetzner CX23 VPS on Linux. macOS and
Windows support should be real, not an afterthought: the shared runtime and
installer should stay portable, while OS-specific install logic lives behind
host adapters.

## Operating Model

Shared runtime:

```text
Bun
TypeScript
Hono
local Postgres + pgvector
Telegram long polling
Tailscale for private admin access
```

Host-specific service managers:

```text
Linux
  systemd

macOS
  launchd

Windows
  Windows Service
```

Default production deployment:

```text
Hetzner CX23 VPS
Linux
systemd services
local Postgres + pgvector
Telegram long polling
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
param-app
  Hono HTTP/API surface, health checks, operator routes, Chat SDK/webhook handling

param-worker
  jobs, actor runs, Telegram polling, scheduler, memory review, compaction,
  task agents, delivery retries

postgres
  local Postgres with pgvector
```

The app and worker can live in one codebase but should be separate processes.

Reasons:

- the HTTP surface can stay responsive while workers are busy
- worker crashes do not necessarily take down health/operator routes
- the host service manager can restart each process independently
- logs are easier to inspect

Native service mapping:

```text
Linux
  param-app.service
  param-worker.service
  postgresql.service

macOS
  com.param-agent.app.plist
  com.param-agent.worker.plist
  Postgres from the selected package manager/service provider

Windows
  Param Agent App service
  Param Agent Worker service
  PostgreSQL service
```

## Service Account

Default service account:

```text
param
```

The installer should create or configure the service account when the host
supports that safely.

Rules:

- do not run Param as root by default
- grant only required directory permissions
- use sudo only for approved server-management actions
- keep runtime workspaces writable by the Param service user
- keep system config changes behind Action Review

Platform notes:

- Linux uses a dedicated `param` system user by default.
- macOS can run launchd agents as the installing user for local installs, or a
  launch daemon with a dedicated user for server-style installs.
- Windows uses a Windows Service account. The initial implementation may use the
  current user for local development and a dedicated service account for
  production installs.

## Directory Layout

Repository and source layout lives in `docs/PROJECT_STRUCTURE.md`.

Linux production paths:

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

macOS local paths:

```text
~/Library/Application Support/Param Agent
  durable app data, workspaces, artifacts

~/Library/Logs/Param Agent
  local logs
```

Windows local paths:

```text
%LOCALAPPDATA%\Param Agent\Data
  durable app data, workspaces, artifacts

%LOCALAPPDATA%\Param Agent\Logs
  local logs
```

`scripts/setup.ts` should generate OS-appropriate local paths in
`param.config.local.ts`. Production installers can choose service-style paths
for each OS.

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

Param needs an idempotent cross-platform installer.

Installer script layout lives in `docs/PROJECT_STRUCTURE.md`.

Installer goals:

- prepare a fresh or existing supported host
- avoid overwriting existing state
- support dry-run/check mode
- print clear next steps
- leave Param able to start on boot

Installer responsibilities:

- detect host OS, distribution/version, architecture, shell, and package manager
- install Bun
- install Git and build tools
- install Postgres and pgvector for `local-postgres`
- install runtime adapter dependencies
- show an interactive runtime install checklist for Codex, OpenCode, and
  Antigravity when no runtime flags are provided
- create service user
- create directories
- install app dependencies
- install packages according to `docs/DEPENDENCIES.md`
- collect the owner Telegram user id on first install when not already provided
- help discover Telegram owner/group ids when needed
- create `.env` from `.env.example` when missing
- create `param.config.local.ts` when missing
- create native service files for the host
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
--interactive
  ask questions, including runtime install checkboxes

--non-interactive
  never show prompts; use explicit flags and config defaults

--owner-telegram-user-id <id>
  set the first trusted owner and default allowed DM user

--discover-telegram-ids
  run temporary Telegram id discovery before starting services

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

## Installer Prompt UI

Interactive installer input should use `@clack/prompts`.

Use it for:

- checkbox runtime selection
- yes/no confirmation
- simple selects
- short text inputs

Use `@inquirer/prompts` only as a fallback if a specific installer prompt
becomes awkward in Clack.

Use built-in `util.parseArgs` for command-line flags.

Ink is not the default installer prompt layer.

Ink is a good fit for a richer operator/admin terminal UI later, such as:

- live service status
- worker/job queues
- actor run timelines
- runtime health
- log tailing
- approval queue inspection
- keyboard-driven admin actions

That is a different surface from the installer. The installer should stay a
boring script with prompts and flags. If an Ink admin TUI is added later, it
should call the same ops/config/action-review APIs as other admin surfaces.

Do not build a custom full-screen TUI for the installer. The installer should
feel like a normal terminal setup script: clear prompts, explicit defaults,
dry-run support, and a printed action plan before changes.

Prompt rules:

- interactive prompts require a TTY
- `--non-interactive` never prompts
- CI/non-TTY mode never prompts
- missing required choices in non-interactive mode fail with a clear message
- every prompt must have an equivalent flag or config value
- secrets should be requested through `.env` creation/editing, not echoed in
  visible prompts
- `Ctrl+C` should exit cleanly without a stack trace

Runtime install flags:

```text
--runtime codex
  install/check Codex CLI runtime

--runtime opencode
  install/check OpenCode CLI runtime

--runtime antigravity
  install/check Antigravity CLI runtime

--runtime all
  install/check all target CLI runtimes

--runtime none
  skip CLI runtime installation
```

`--runtime` can be repeated.

When no runtime flag is provided in interactive mode, the installer should show
a terminal checklist:

```text
select runtimes to install/check:
[x] Codex CLI
[x] OpenCode CLI
[x] Antigravity CLI
```

Default interactive selection is all three runtimes checked.

Checklist behavior:

- checked means install if missing, then verify command availability
- unchecked means do not install; keep runtime availability as configured
- Codex is the first/default actor runtime and should normally stay checked
- OpenCode and Antigravity are enabled target runtimes and should be easy to
  install at setup time
- exact install commands belong in implementation/runtime installer manifests
  and must be verified against current official docs
- failed installation of a `require` runtime fails setup
- failed installation of a `warn` runtime records a warning and keeps setup
  moving

Installing or changing host-level CLI runtimes after initial setup is a
server-changing action and goes through Action Review.

## First Owner Setup

On the first VPS install, Param needs one trusted owner.

Interactive setup should ask for:

```text
owner Telegram user id
```

The installer writes that value to `.env` as:

```dotenv
PARAM_OWNER_TELEGRAM_USER_ID=...
```

That id is used for two different things:

- default allowed DM user, so the owner can talk to Param privately
- first trusted user, with `global` and `server_admin` scopes

Allowed groups are separate. The installer must not treat the owner's id as an
allowed group, and it must not treat allowed groups as trusted users.

In non-interactive mode, setup must receive the owner id through
`--owner-telegram-user-id` or an existing `PARAM_OWNER_TELEGRAM_USER_ID`.

## Telegram Id Discovery

The installer should provide a safe helper for finding Telegram ids.

Flow:

```text
1. User provides TELEGRAM_BOT_TOKEN.
2. Installer starts a temporary discovery poller.
3. Owner sends /start or another setup phrase to the bot in DM.
4. Helper prints the sender Telegram user id.
5. Optional: owner adds the bot to an allowed group and sends a setup phrase.
6. Helper prints the group chat id and topic id, if present.
7. Helper stops before normal Param services start.
```

Discovery mode should:

- use the bot token only for setup
- avoid creating normal sessions or actor runs
- store no full chat history
- print exact ids the user can put into config
- never mark an allowed group as trusted
- never mark the owner id as an allowed group

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

Setup-created `.env` files should be treated as secret files:

- write values with quoting/escaping so special characters do not break env
  parsing
- on Linux and macOS, create `.env` exclusively with `0600` permissions
- on Windows local setup, create `.env` in the current user's project directory
  using the current user's default file ACL
- on Windows service installs, the host adapter must set an explicit ACL that
  grants access only to the configured service account and trusted admins
- never silently rewrite or chmod an existing `.env`; report that it already
  exists and leave it alone

Never print:

- bot tokens
- database passwords
- model API keys
- webhook secrets
- Tailscale/admin tokens
- runtime credentials

## Native Services

All native service definitions should:

- run as the Param service account
- load `.env`
- set working directory
- restart on failure
- start after network and Postgres when the host manager supports dependencies
- write logs through the host's normal service logging path
- use conservative restart limits

Linux systemd example shape:

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

macOS launchd plist files should:

- use `ProgramArguments` for Bun and the Param entrypoint
- set `WorkingDirectory`
- set environment variables or point to generated env loading wrapper scripts
- use `KeepAlive` for long-running services
- write stdout/stderr to the configured log directory
- run as a launch agent for local installs or launch daemon for server-style
  installs

Windows service definitions should:

- use the selected Windows service wrapper or service API implementation
- set working directory
- pass environment values from `.env` or generated service environment config
- restart on failure
- write logs to files and/or Windows Event Log
- run as the configured service account

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
- write to the configured host backup directory
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
- change native service definition
- modify firewall

Change-making actions require Action Review and usually trusted approval.

Before Param restarts itself:

- persist current state
- verify the native service manager will bring it back
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
- Linux systemd templates include restart policy
- macOS launchd templates include keep-alive behavior
- Windows service templates include restart policy
- startup fails loudly on missing required secrets
- recovery reclaims expired job locks
- recovery does not duplicate delivered messages
- polling offset advances only after persistence
- backup job writes a backup artifact or clear failure
- health check detects DB failure
- self-restart requires Action Review
- redacted config summary hides secrets
