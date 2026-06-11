# Param Agent Observability

This file defines how Param explains itself.

## Goal

Param should be inspectable without leaking private data.

Observability should answer:

- why Param replied
- why Param stayed quiet
- why Param reacted
- why Param used or ignored memory
- why Param asked for approval
- why a tool ran
- why an action was denied
- why a task agent was spawned
- what happened before a crash or reboot
- whether a message was delivered once

## Core Rule

Every important decision needs a durable explanation.

The explanation can be short. It does not need to include full prompts, private
chat text, secrets, or raw tool output.

## Signals

Param uses five observability signals.

Events:
  durable product history, such as chat events, actor outputs, tool results, and
  delivery results

Logs:
  operational timeline for app, worker, runtime adapters, tools, and recovery

Traces:
  correlated spans for one run or workflow

Metrics:
  counters, gauges, and histograms for health, latency, queue depth, cost, and
  error rates

Audit:
  append-only records for security-sensitive or state-changing actions

OpenTelemetry is the preferred shape for traces, metrics, and logs when Param
exports telemetry. Local logs and database records remain the source of truth
for core behavior.

## Correlation Ids

Every important record should carry stable ids.

```text
session_id
event_id
actor_run_id
context_packet_id
prompt_version
tool_call_id
approval_id
task_agent_id
job_id
delivery_id
trace_id
span_id
artifact_id
```

Ids let Param reconstruct a story without dumping raw context into every log.

## Decision Records

Actor runs should produce decision metadata.

```ts
type DecisionRecord = {
  actorRunId: Id;
  sessionId: Id;
  triggerEventId?: Id;
  decision:
    | "reply"
    | "no_reply"
    | "react"
    | "tool_call"
    | "approval_request"
    | "spawn_task_agent"
    | "render_ui"
    | "memory_candidate";
  reasonCode: string;
  shortReason: string;
  evidenceRefs: Id[];
  memoryUsed: Id[];
  ignoredMemory?: Id[];
  steeringEventsConsumed?: Id[];
  policyRefs?: string[];
  createdAt: string;
};
```

`shortReason` is for trusted/debug views. It should be concise and redacted.

Examples:

```text
reply
  mentioned directly and had relevant project context

no_reply
  busy group chatter, no mention, no useful contribution

react
  message acknowledged with small gesture, reply would be noisy

approval_request
  non-trusted requester asked for server-changing action
```

## Run Timeline

Each actor run should be reconstructable as a timeline.

```text
run queued
context built
prompt compiled
runtime started
steering received
runtime completed
outputs parsed
style guard passed
tool review started
approval requested
delivery attempted
delivery confirmed
run summarized
```

Timeline records should include:

- timestamp
- actor run id
- event type
- status
- short message
- related ids
- error code, if any

## Traces

Trace one meaningful workflow.

Recommended spans:

```text
channel.receive
event.persist
orchestrator.route
batch.wait
actor.context.build
memory.retrieve
skills.select
tools.select
prompt.compile
runtime.call
actor.output.parse
style_guard.check
tool.review
action_review.classify
approval.wait
tool.execute
ui.render
delivery.send
delivery.confirm
run.summary
```

Trace attributes should use ids and safe metadata, not raw content.

Safe trace attributes:

- session type
- channel
- run type
- model/runtime name
- tool name
- risk level
- output count
- token/cost numbers
- latency
- status

Unsafe trace attributes:

- raw chat text
- secrets
- database URLs
- raw prompt packets
- raw tool output
- private files

AI SDK telemetry can be enabled for model calls, but input/output recording must
be configurable and off by default for private deployments.

## Logs

Logs should be structured JSON.

Minimum fields:

```text
timestamp
level
module
message
session_id
actor_run_id
event_id
job_id
trace_id
error_code
metadata
```

Rules:

- redact secrets before logging
- do not log full prompts by default
- do not log full chat text by default
- store large runtime logs as artifacts
- include enough ids to inspect the database story
- keep user-visible chat wording out of internal technical logs unless needed

## Metrics

Metrics should be low-cardinality.

Core metrics:

```text
param_actor_runs_total
param_actor_run_duration_seconds
param_actor_run_failures_total
param_no_reply_total
param_replies_total
param_reactions_total
param_tool_calls_total
param_tool_call_duration_seconds
param_action_reviews_total
param_approvals_pending
param_delivery_attempts_total
param_delivery_failures_total
param_queue_depth
param_jobs_failed_total
param_scheduler_wakes_total
param_memory_retrieval_duration_seconds
param_memory_candidates_total
param_task_agents_active
param_runtime_failures_total
param_postgres_up
param_telegram_polling_lag_seconds
param_disk_free_bytes
param_estimated_model_cost_usd
```

Avoid labels with user ids, chat names, raw tool input, or message text.

## Audit

Audit is not the same as logs.

Audit records are append-only and security-relevant.

Audit should cover:

- trusted-user changes
- config changes
- MCP server changes
- skill install/update/enable/disable
- tool policy changes
- approval decisions
- denied actions
- server self-management actions
- package installs
- shell commands
- file writes to sensitive paths
- memory writes/deletes/forget requests
- scheduler changes
- recovery repairs

Audit records must not contain raw secrets.

## Health Views

Param needs private operator views or commands that answer:

- is the app process alive
- is the worker alive
- is Postgres reachable
- is pgvector enabled
- is Telegram polling fresh
- are jobs stuck
- are actor runs stuck
- are approvals expired
- are delivery retries backing up
- are backups fresh
- is disk space low
- are runtimes available
- are MCP servers available
- are skills indexes current

These can start as Telegram commands for trusted users and private Tailscale
endpoints. They are not a standalone product UI.

## Debug Commands

Initial read-only debug commands:

```text
/status
/why
/runs
/approvals
/jobs
/memory
/tools
/skills
/health
```

`/why` should explain the last visible decision in the current session:

```text
last decision: no_reply
reason: busy group chatter, no mention, no useful contribution
context packet: ctx_...
actor run: run_...
memory used: none
steering consumed: 2 events
```

Debug commands are visible chat behavior, so Param should keep them concise and
not expose private details to untrusted users.

## Redaction

Redaction happens before logs, traces, audit summaries, and eval reports.

Redact:

- API keys and tokens
- database URLs
- bot tokens
- OAuth codes
- authorization headers
- private file paths when not needed
- phone numbers and email addresses when not needed
- raw private chat text unless explicitly allowed
- secret env values

Keep:

- stable ids
- short redacted summaries
- hashes
- risk levels
- timestamps
- status codes

## Retention

Recommended defaults:

```text
debug logs: 14 days
runtime logs: 30 days
traces: 7 days
metrics: 30 days
audit: indefinite or explicit retention policy
events: project-defined retention
artifacts: per artifact policy
eval reports: redacted, project-defined retention
```

Retention jobs should never silently delete audit-critical records.

## Config

```ts
type ObservabilityConfig = {
  logLevel: "debug" | "info" | "warn" | "error";
  auditEnabled: boolean;
  redactSecrets: boolean;
  traces: {
    enabled: boolean;
    retainDays: number;
    recordInputs: boolean;
    recordOutputs: boolean;
    exporter: "none" | "otlp" | "file";
  };
  metrics: {
    enabled: boolean;
    exporter: "none" | "prometheus" | "otlp";
  };
  decisionRecords: {
    enabled: boolean;
    retainDays?: number;
  };
  logs: {
    format: "json";
    retainDays?: number;
    artifactLargeLogs: boolean;
  };
};
```

## Database Records

Observability should use existing tables where possible:

- `events`
- `actor_runs`
- `actor_outputs`
- `tool_calls`
- `approvals`
- `jobs`
- `artifacts`
- `audit_log`

Additional useful records:

```text
decision_records
trace_refs
metric_snapshots
health_checks
```

## Tests

Required tests:

- `/why` explains reply/no-reply without raw private chat text
- decision record links to actor run and context packet
- tool call trace links to audit and result event
- approval audit stores requester and approver separately
- logs redact secrets
- traces omit raw prompt content by default
- large runtime output becomes artifact
- metrics do not include high-cardinality user/chat labels
- health check reports stale Telegram polling
- recovery writes audit and timeline records
- eval metadata includes memory used and ignored memory

## References

- OpenTelemetry observability primer: `https://opentelemetry.io/docs/concepts/observability-primer/`
- AI SDK telemetry: `https://ai-sdk.dev/docs/ai-sdk-core/telemetry`
