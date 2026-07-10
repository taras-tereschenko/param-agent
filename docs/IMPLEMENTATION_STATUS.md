# Param Implementation Status

The subsystem docs describe the **target** architecture. This file records what
is actually **wired into the live loop** versus what is **staged** (implemented
as tested building blocks but not yet connected, or intentionally deferred), so
the docs and the code are never in conflict.

Last reviewed against a full audit + review pass.

## Wired and working (end to end, deterministic tests)

- Config load/validation, secret refs, redacted config view, startup secret checks.
- Postgres/Drizzle schema + migrations (0000–0002) + pgvector/full-text/GIN
  index bootstrap; `db:check` verifies extensions + core/extended tables.
- Deterministic session keys; ingest of Telegram updates → durable events with
  raw-payload persistence + dedupe; per-update poll resilience.
- Orchestrator: batching (debounced run scheduling), one active run per session,
  soft/strong/hard-control steering + pre-send stale guard, advisory locks,
  reboot/crash recovery with actor-run leases.
- Prompt compiler with the **verbatim** human-text base (byte-for-byte, tested)
  and per-run contracts; prompt snapshot ref stored per run.
- Session Actor loop via a pluggable inference interface; deterministic
  MockActor default; output validation + style guard (rewrite/truncate, never
  deliver bad output).
- Action Review wired: the output dispatcher routes `tool_call` (classify →
  auto-review vs approval → executor → `tool.result`), `approval_request`,
  `spawn_task_agent`, and `memory_candidate`; trusted approve/deny replies
  resolve approvals (trust-checked, replay-safe, exact-proposal) and execute
  approved tool calls; overdue approvals expire on a maintenance tick;
  production startup requires trusted approval for consequential actions.
- Memory: scope isolation (group↔DM↔user), keyword+confidence+recency ranking,
  candidate review (no secrets, no group-gossip→private-fact), compaction tail.
- Tools: registry + policy + Action-Review-gated executor + safe local tools +
  lazy MCP client mapping.
- Telegram delivery of plain-text messages + reactions (4096-safe), callback
  answering, access policy (allowed DM/group/topic, per-chat topic gating).
- Runtime adapters: capability probing + safe-unavailable; Codex chat-brain is
  honestly unavailable here (see CODEX_CHAT_BRAIN_PROOF.md).
- Security: secret redaction (incl. bot tokens), SSRF host checks (encoded IP
  forms), allowed-vs-trusted separation, runtime env filtering.
- Observability: structured redacted JSON logs, audit + decision records for
  replies/no-replies/approvals/recovery; health snapshot.
- Cross-platform installer action-plan (dry-run) + interactive `setup` +
  telegram-id discovery + doctor.

## Staged (built + tested as blocks, not yet connected to the live loop)

- **Scheduler**: pure schedule/cooldown/active-hours/ambient-wake logic and an
  `ambient_wake` job handler exist; the periodic due-schedule scan
  (`fireDueSchedules`) and a `schedules` repository/creation flow (with the
  required trusted approval for chat-proactive schedules) are not yet driven by
  the worker.
- **Task agents**: registry, bounded spawn plan, and DB spawn are wired; actual
  task **execution** returns an honest `runtime_unavailable` result because no
  task runtime is proven in this environment.
- **UI**: `render_ui` specs validate + render to Telegram text and callbacks are
  decoded/validated; durable callback surfaces (persistence/expiry/replay
  binding) and inline-button delivery are staged.
- **Memory semantic search**: the pgvector `embedding` column + ivfflat index
  exist; semantic ranking activates when an embedding provider is configured
  (none by default). Retrieval today is scope + keyword + recency.
- **Runtime execution** (`RuntimeAdapter.run`), OpenCode/Antigravity/image/
  browser adapters, and Codex chat-brain remain probe-only until proven.
- **Config breadth**: `skills/tools/security/memory/scheduler/ui/taskAgents`
  config sections exist (optional); not every documented field is consumed yet.

## Intentional placeholders

- Codex chat-brain inference: the direct-CLI path (`CodexCliActor`) is
  implemented + unit-tested and is selected when the `codex` CLI is available;
  it is unproven in this build env (no CLI/auth) and must be proven on the host
  (docs/DEPLOY_VPS.md Step 7). The AI SDK harness path remains probe-only.
- Image/browser task runtimes.
- Telegram webhook mode (polling is the default; the webhook route acks only).
- The `evals/` scenario harness is scaffolded; scenario suites are added over time.
