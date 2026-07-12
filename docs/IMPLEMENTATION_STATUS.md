# Param Implementation Status

The subsystem docs describe the **target** architecture. This file records what
is actually **wired into the live loop** versus what is **staged** or blocked,
so the docs and the code are never in conflict.

Where something can only be proven on a live VPS (real Telegram, a real runtime
CLI, an MCP server, an embedding provider), that is stated explicitly.

## Wired and working end to end

- **Real brain by default.** The OpenAI API brain (`OpenAiApiActor`, AI SDK
  `generateObject`) is the default; `MockActor` runs ONLY with
  `PARAM_ACTOR=mock`; production **refuses to boot** with no real brain (never a
  silent mock). Codex-CLI brain is an alternative, spawned with a scrubbed env.
- **The actor ACTS.** The brain emits the full output set — message,
  react_to_message, no_reply, tool_call, spawn_task_agent, memory_candidate,
  render_ui, run_summary, done. The dispatcher routes tool_call (classify →
  auto-review vs approval → executor → `tool.result`), spawn_task_agent, and
  memory_candidate.
- **Agentic loop is closed.** A tool that executes re-wakes the actor
  (depth-bounded) so it observes `tool.result` and continues; approved actions
  and task results re-wake it too.
- **Tools execute with rate limits.** Consequential tools go through Action
  Review; `maxToolCallsPerRun` caps tool calls per run (when configured).
- **Task agents EXECUTE.** `spawn_task_agent` builds a bounded plan, creates an
  isolated child session + `task_runs` row, and the worker runs the task on the
  runtime CLI (codex/opencode `exec`) with a hard budget timeout, a scrubbed env
  (no DATABASE_URL / bot token), and an isolated workspace cwd. The real
  outcome (status/summary/error — never a fabricated success) is written back
  and re-wakes the parent actor. No runtime available → honest failed result.
- **Approvals are delivered + resolved by inline button.** The trusted approver
  gets an inline Approve/Deny keyboard bound to the approval id; taps resolve
  it (requester ≠ approver + trust enforced); text replies also work; overdue
  approvals expire on the maintenance tick.
- **Generated UI is delivered.** `render_ui` is validated, rendered, and sent to
  Telegram as text + inline buttons (64-byte-capped callbacks); button taps wake
  the actor. Mini-app surfaces are marked delivered (the page needs HTTPS
  hosting to be opened — see below).
- **Memory is stored + scoped-retrieved + semantic.** memory_candidate outputs
  pass review and are written scope-isolated, with a pgvector embedding when an
  embedding provider is configured (OpenAI, from OPENAI_API_KEY). Retrieval
  pushes the (scope, subject_ref) allow-list + LIMIT into SQL (subject_ref GIN
  index) so a DM/group fetches only its own rows, embeds the query and ranks by
  pgvector cosine distance blended with keyword + confidence + recency
  (`rank.ts`); falls back to keyword+FTS when no key is set. User-scoped memory
  is retrieved in DMs.
- **Skills reach the actor (trust-gated).** Trusted+enabled skills relevant to
  the message are injected as procedural knowledge (summaries first) with a
  standing "not a permission" reminder. Populate/curate the table with
  `bun run skills` (add/trust/enable/disable/list).
- **MCP tools register at boot.** Configured stdio MCP servers' tools are
  registered into the toolset at worker startup; a trusted server keeps the
  read-name heuristic, a non-trusted server has every tool forced to
  write/review. Action Review still gates every consequential call.
- **Webhook intake works.** The webhook route validates the secret then enqueues
  the update; the worker normalizes + access-checks + ingests it through the
  SAME path as polling (dedupe shared). Polling remains the turnkey default.
- **Live steering.** Same-session messages after the trigger are classified;
  hard controls interrupt and drop stale output; strong steering suppresses the
  stale reply and refreshes against the newest message.
- **Proactive scheduler.** The maintenance tick fires due schedules
  (cooldown/active-hours/flood gated) → dedupe-keyed `ambient_wake` → the actor
  reads the room; next-fire advanced.
- Config load/validation + secret refs; verbatim human-text persona (byte-for-
  byte); prompt compiler + per-run contracts; output validation + style guard.
- Orchestrator: deterministic session keys, batching, one active run/session,
  advisory locks, reboot/crash recovery with leases; **no duplicate delivery**
  (gated on insert) and **crash re-drive** of pending replies.
- Telegram ingest (dedupe + raw payloads) and delivery (text/reactions/UI,
  4096-safe, callback answering); access policy; group @mentions/replies
  detected (bot identity wired); edited-message timestamps use edit time.
- Security: codex/brain + task-agent env scrubbed (no secret exfil), HTTP
  surface bound to loopback by default + operator bearer-token guard, DB-cred
  redaction (any length), webhook secret validated, systemd sandboxing.
- DB schema + migrations + pgvector/FTS/GIN bootstrap (`ensureSemanticIndexes`
  runs at migrate); `db:check`.
- **CI**: GitHub Actions runs typecheck + unit + `bash -n`, plus a Postgres
  (pgvector) integration job (`db:migrate`/`db:check`/`test:db`).
- Turnkey one-command installer (deps/bun/Postgres+pgvector/Codex, generated DB
  password, provision + migrate, brain smoke-check, systemd start). **Tailscale**
  is installed by default and connects via a **browser login link** (codex-style
  `tailscale up`), not a pasted key.

## Staged / blocked (with the exact blocker)

- **Semantic memory ranking quality.** The embedding provider + embed-on-write +
  query-time pgvector cosine search are wired and unit-tested; ranking QUALITY
  can only be judged on the VPS with a real OPENAI_API_KEY and populated data.
  Pre-existing rows written before a key was configured have no embedding until
  re-stored (no backfill job yet).
- **MCP end-to-end execution.** Registration + trust gating are wired; verifying
  a real tool call needs a live MCP server configured (`tools.mcp.servers`).
  Only stdio transport is implemented (http/sse are skipped with a log).
- **Mini App UI.** `render_ui` delivers to Telegram inline keyboards; the Mini
  App page shell exists but needs public HTTPS hosting + `PARAM_PUBLIC_BASE_URL`
  to actually open.
- **Task-agent deep sandbox.** Env is scrubbed, the workspace cwd is isolated,
  and the budget timeout is a hard kill; full read-only/no-net sandboxing is the
  runtime CLI's own config (same posture as the chat brain), not enforced by
  Param.
- **Polling offset persistence / poller lock.** Not implemented, and not needed
  for correctness: event dedupe prevents double-processing, and Telegram's
  single-consumer 409 already prevents two pollers (the loop backs off on it).
  Persisting the offset is only a minor restart optimization (deferred; needs a
  schema migration).
- Minor: `startActorRun` is not yet transactional/session-locked; first-reply
  latency can approach the long-poll window.

## Fleet-review LOW findings — all fixed

Every LOW from the review is now fixed (not deferred):

- Denied tool call / Deny-button now re-wakes the actor so it acknowledges the
  outcome instead of silently dropping the interaction.
- `task_agent_run` has a terminal-status guard, so a job retry never re-runs the
  CLI task.
- Telegram truncation never leaves a lone surrogate at the cut.
- Operator-token + webhook-secret comparisons are constant-time (timingSafeEqual).
- The installer warns when run as root (services would run as root).
- `ivfflat.probes` is set to 10 at the database level (better semantic recall).
- `OPENAI_API_KEY` is no longer passed to codex/opencode task children (they auth
  via their own login), closing that exfiltration surface.
- The SSRF helper (`url-safety.ts`) is complete (IPv4 private ranges + all IPv6
  loopback/unspecified/ULA/link-local + numeric-encoding evasions). It has no
  caller yet because there is no user/model-driven outbound-fetch tool; it will
  be wired in the moment one exists. (It is name/IP based — DNS-rebinding would
  need resolution at fetch time, added with the fetch path.)

## Requires live-VPS proof (cannot be verified from a dev machine)

- The OpenAI brain producing good replies end to end on Telegram (`brain:check`
  + a real DM).
- Codex-CLI brain output reliability (docs/CODEX_CHAT_BRAIN_PROOF.md).
- Task-agent execution against a real codex/opencode CLI on the host.
- Webhook mode against a public HTTPS URL; Mini App pages likewise.
- Anything above that depends on a live MCP server or an embedding provider.
