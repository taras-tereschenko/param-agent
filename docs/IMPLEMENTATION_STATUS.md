# Param Implementation Status

The subsystem docs describe the **target** architecture. This file records what
is actually **wired into the live loop** versus what is **staged** or blocked,
so the docs and the code are never in conflict.

Last updated during the "complete production-ready" build push (post fleet
review). Where something can only be proven on a live VPS, that is stated.

## Wired and working end to end

- **Real brain by default.** The OpenAI API brain (`OpenAiApiActor`, AI SDK
  `generateObject`) is the default; `MockActor` runs ONLY with
  `PARAM_ACTOR=mock`; production **refuses to boot** with no real brain (never a
  silent mock). Codex-CLI brain is an alternative (subscription/API key), spawned
  with a scrubbed env.
- **The actor ACTS.** The brain emits the full output set — message,
  react_to_message, no_reply, tool_call, spawn_task_agent, memory_candidate,
  run_summary, done — mapped to validated drafts. The output dispatcher routes
  tool_call (classify → auto-review vs approval → executor → `tool.result`),
  spawn_task_agent, and memory_candidate.
- **Agentic loop is closed.** A tool that executes re-wakes the actor
  (depth-bounded) so it observes `tool.result` and continues; approved-action
  and task results re-wake it too.
- **Memory is stored.** memory_candidate outputs pass review and are written
  (scope-isolated); retrieval is scope + keyword + recency.
- **Live steering.** Same-session messages after the trigger are classified;
  hard controls ("stop"/"cancel") interrupt and drop stale output; strong
  steering suppresses the stale reply and refreshes against the newest message.
- **Proactive scheduler.** The worker maintenance tick fires due schedules
  (cooldown/active-hours/flood gated) → dedupe-keyed `ambient_wake` jobs →
  actor reads the room; schedule next-fire is advanced.
- Config load/validation + secret refs; verbatim human-text persona (byte-for-
  byte); prompt compiler + per-run contracts; output validation + style guard.
- Orchestrator: deterministic session keys, batching, one active run/session,
  advisory locks, reboot/crash recovery with leases; **no duplicate delivery**
  (delivery gated on insert) and **crash re-drive** of pending replies.
- Telegram ingest (dedupe + raw payloads) and delivery (text/reactions, 4096-
  safe, callback answering); access policy; **group @mentions/replies detected**
  (bot identity wired); edited-message timestamps use edit time.
- Action Review: deterministic risk classification, trust-scope, exact-proposal
  + replay-safe approvals, **requester ≠ approver enforced**, the
  require-approval flag **actually lowers the auto-run ceiling**.
- Security: codex-brain env scrubbed (no secret exfil), HTTP surface bound to
  loopback by default + operator bearer-token guard, DB-cred redaction (any
  length), webhook secret validated, **Tailscale installed by default**, systemd
  sandboxing.
- DB schema + migrations + pgvector/FTS/GIN bootstrap; `db:check`.
- Turnkey one-command installer (deps/bun/Postgres+pgvector/Codex/Tailscale,
  generated DB password, provision + migrate, brain smoke-check, systemd start).

## Staged / blocked (with the exact blocker)

- **Task-agent EXECUTION.** Registry, bounded spawn plan, DB spawn, and the
  parent re-wake on `task.result` are wired, but `task_agent_run` still returns
  an honest `runtime_unavailable`. Blocker: `RuntimeAdapter.run` is not
  implemented for a real runtime; needs a codex/opencode CLI proven on the host.
- **MCP tool execution.** `McpToolSource` lists/maps tools; there is no
  `callTool`, and MCP tools are not registered into the default toolset. Blocker:
  needs a live MCP server to implement + verify; also needs explicit per-tool
  risk config (the name heuristic is not trusted for execution).
- **Approval DELIVERY + inline buttons.** Approvals are created/audited and
  resolvable by an explicit text reply (trust-checked, requester≠approver), but
  Param does not yet SEND the trusted approver an inline-keyboard message, and
  callback buttons are not bound to an approval id. Blocker: inline-button
  delivery + callback→resolve wiring; needs live Telegram to verify.
- **Generated UI delivery.** `render_ui` validates and renders to text +
  callbacks decode/validate, but render_ui outputs are not delivered as Telegram
  inline keyboards / Mini App. Blocker: live Telegram + Mini App hosting.
- **Semantic/FTS memory search.** The pgvector + tsvector columns/indexes exist
  but retrieval is keyword-only; no query-time embeddings. Blocker: an embedding
  provider + live pgvector query verification. Also: retrieval over-reads
  (no subject_ref predicate/LIMIT) and user-scoped memory is not retrieved in
  DMs — both open.
- **Skills in context.** The trust-gated skill registry/loader is built but not
  injected into the actor context.
- **Webhook mode.** The route validates the secret token but does not process
  updates (polling is the default transport). Single-poller lock + persisted
  polling offset are not implemented (dedupe prevents dup delivery today).
- **Rate limits.** `security.rateLimits` is defined but not enforced.
- **CI.** No CI config; `bun run check` (typecheck + unit) is the automated gate;
  the DB-backed integration tests require `PARAM_TEST_DATABASE_URL`.
- Minor: `startActorRun` is not yet transactional/session-locked; first-reply
  latency can approach the long-poll window.

## Requires live-VPS proof (cannot be verified from a dev machine)

- The OpenAI brain producing good replies end to end on Telegram (`brain:check`
  + a real DM).
- Codex-CLI brain output reliability (docs/CODEX_CHAT_BRAIN_PROOF.md).
- Any of the "staged" items above that depend on live Telegram / a real
  runtime / an MCP server / an embedding provider.
