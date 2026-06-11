# Param Agent Database

This file describes the target Postgres schema.

It is a build guide, not a final migration file. During implementation, these
tables should become Drizzle schema definitions plus migrations.

## Database Principles

- Postgres is the system of record.
- The default VPS install uses local Postgres with pgvector.
- Managed Postgres remains supported through `DATABASE_URL`.
- Drizzle owns schema and migrations.
- Events are append-only.
- Session, run, job, schedule, and memory tables hold current operational state.
- JSONB is allowed for contract payloads, raw provider data, and adapter-specific
  metadata.
- Important JSONB payloads still need Zod validation before write and after
  read.
- Use UUIDv7 or ULID-style ids so records sort naturally by time.
- Use `timestamptz` for timestamps.
- Use `jsonb` for `ParamEvent.payload`, `ActorOutput.payload`, refs, and raw
  payloads.
- Use `pgvector` for embeddings inside memory tables.
- Use Postgres full-text search for keyword retrieval.
- Do not put large generated artifacts directly in Postgres.

Large files stay on the VPS filesystem or later object storage. Postgres stores
paths, hashes, ownership, retention, and audit links.

## Extensions

Required:

```sql
pgvector
```

Recommended:

```sql
pgcrypto
btree_gin
```

`pgcrypto` is useful for generated ids and hashes. `btree_gin` is useful for
mixed JSONB/search indexes.

## Naming

Table names use snake_case.

Primary keys:

```text
id text primary key
```

This keeps ids portable across Drizzle, logs, JSON, and external references.

Common columns:

```text
created_at timestamptz not null
updated_at timestamptz not null
```

Append-only tables should not rely on `updated_at` unless the row has a real
mutable status.

## Identity Tables

### users

One Param-level person identity.

```text
id
display_name
notes
created_at
updated_at
```

This table is not the memory system. It stores identity glue only.

### user_accounts

One platform account belonging to a person.

```text
id
user_id
platform
platform_user_id
username
display_name
is_bot
first_seen_at
last_seen_at
raw_profile jsonb
created_at
updated_at
```

Constraints:

```text
unique(platform, platform_user_id)
foreign key user_id -> users.id
```

### trusted_users

Trusted approval authority.

```text
id
user_id
platform
platform_user_id
trust_scope
scope_ref
status
added_by_user_id
added_at
revoked_at
created_at
updated_at
```

`trust_scope` values:

```text
global
chat
project
server_admin
```

Trusted users are config-like security state, not memory.

## Channel Tables

Detailed channel behavior lives in `docs/CHANNELS.md`.

Telegram-specific behavior lives in `docs/channels/TELEGRAM.md`.

### channel_accounts

Configured bot/channel accounts.

```text
id
platform
label
status
config jsonb
created_at
updated_at
```

Do not store raw secrets in `config`. Store secret references or env variable
names.

### platform_chats

Known external chats, groups, topics, and channels.

```text
id
platform
account_id
platform_chat_id
chat_type
title
message_thread_id
raw_chat jsonb
first_seen_at
last_seen_at
created_at
updated_at
```

Constraints:

```text
unique(platform, account_id, platform_chat_id, message_thread_id)
```

## Session Tables

### sessions

One durable conversation context.

```text
id
session_key
platform
route_type
platform_chat_id
message_thread_id
parent_session_id
status
policy_id
summary_checkpoint_id
created_at
updated_at
last_event_at
last_actor_run_id
active_run_id
last_event_id_seen_by_actor
metadata jsonb
```

Constraints:

```text
unique(session_key)
foreign key parent_session_id -> sessions.id
```

Indexes:

```text
sessions(status)
sessions(parent_session_id)
sessions(last_event_at desc)
```

`sessions` is current state. The history lives in `events`.

### session_participants

People observed in a session.

```text
id
session_id
user_id
platform_user_id
role
first_seen_at
last_seen_at
metadata jsonb
created_at
updated_at
```

Constraints:

```text
unique(session_id, platform_user_id)
foreign key session_id -> sessions.id
foreign key user_id -> users.id
```

## Event Tables

### events

Append-only event log implementing `ParamEvent`.

```text
id
schema_version
type
session_id
direction
visibility
occurred_at
received_at
persisted_at
source jsonb
platform jsonb
dedupe_key
correlation_id
parent_event_id
root_event_id
actor_run_id
job_id
approval_id
payload jsonb
raw jsonb
```

Constraints:

```text
unique(dedupe_key)
foreign key session_id -> sessions.id
foreign key parent_event_id -> events.id
foreign key root_event_id -> events.id
```

Indexes:

```text
events(session_id, occurred_at desc)
events(session_id, id)
events(type, occurred_at desc)
events(actor_run_id)
events(job_id)
events(approval_id)
events(correlation_id)
events using gin(payload)
```

Rules:

- Never rewrite event meaning.
- Edits and deletes are new events.
- Redaction, if needed later, should be explicit and audited.

### raw_payloads

Optional storage for large raw payloads.

```text
id
provider
kind
hash
storage
ref
json jsonb
created_at
```

Use this when raw data is too large to keep inline in `events.raw`.

## Actor Run Tables

Detailed runtime-adapter behavior lives in `docs/RUNTIME_ADAPTERS.md`.

### actor_runs

One main actor run for a session.

```text
id
session_id
trigger_event_id
run_type
status
runtime
model
started_at
completed_at
last_heartbeat_at
lock_owner
lock_expires_at
last_consumed_event_id
prompt_snapshot_ref
context_snapshot_ref
error jsonb
metadata jsonb
created_at
updated_at
```

`run_type` examples:

```text
normal_chat
ambient_wake
memory_review
approval
task_result
compaction
admin
```

`status` examples:

```text
queued
building_context
running
waiting_tool
waiting_approval
compacting
completed
failed
cancelled
interrupted
```

Indexes:

```text
actor_runs(session_id, created_at desc)
actor_runs(status)
actor_runs(lock_expires_at)
```

Invariant:

```text
at most one active main actor run per session
```

This can be enforced with a partial unique index on `session_id` where status is
one of:

```text
queued
building_context
running
waiting_tool
waiting_approval
compacting
```

### actor_outputs

Structured actor intents implementing `ActorOutput`.

```text
id
schema_version
type
session_id
actor_run_id
sequence
created_at
caused_by_event_ids text[]
idempotency_key
payload jsonb
validation_status
validation_error jsonb
delivery_status
```

Constraints:

```text
unique(actor_run_id, sequence)
unique(idempotency_key)
foreign key session_id -> sessions.id
foreign key actor_run_id -> actor_runs.id
```

Indexes:

```text
actor_outputs(session_id, created_at desc)
actor_outputs(actor_run_id, sequence)
actor_outputs(type)
actor_outputs(delivery_status)
```

Actor outputs are not side effects. Delivery, tools, approvals, and tasks write
their own rows/events after validation.

### delivery_attempts

Attempts to deliver visible outputs through a platform adapter.

```text
id
output_id
session_id
platform
adapter
target jsonb
status
attempt
platform_message_id
error jsonb
started_at
completed_at
created_at
updated_at
```

Constraints:

```text
foreign key output_id -> actor_outputs.id
foreign key session_id -> sessions.id
unique(output_id, platform, adapter, attempt)
```

Successful delivery should also create `delivery.succeeded`. Failure should
create `delivery.failed`.

## Job Queue Tables

### jobs

Postgres-backed durable queue.

```text
id
type
payload jsonb
status
priority
due_at
attempt_count
max_attempts
lock_owner
lock_expires_at
last_error jsonb
idempotency_key
created_at
updated_at
completed_at
```

Job types:

```text
actor_invocation
batch_review
memory_review
compaction
task_agent_run
scheduled_check
ambient_wake
tool_execution
delivery_retry
approval_timeout
recovery_scan
```

Indexes:

```text
jobs(status, due_at, priority desc)
jobs(lock_expires_at)
jobs(type, status)
unique(idempotency_key)
```

Workers claim jobs transactionally:

```text
status = queued
due_at <= now()
lock is missing or expired
```

Then set:

```text
status = running
lock_owner = worker id
lock_expires_at = now() + lease duration
attempt_count = attempt_count + 1
```

After reboot, expired running jobs become claimable by recovery workers.

## Memory Tables

### memory_records

Durable memory facts and preferences.

```text
id
scope
subject_ref jsonb
text
normalized_text
provenance_note
confidence
sensitivity
status
source_event_ids text[]
created_by_run_id
created_at
updated_at
last_used_at
expires_at
embedding vector
search_vector tsvector
metadata jsonb
```

`scope` values:

```text
user
group
session
project
agent
```

Indexes:

```text
memory_records(scope, status)
memory_records using ivfflat(embedding vector_cosine_ops)
memory_records using gin(search_vector)
memory_records using gin(subject_ref)
```

Use the exact vector dimension required by the configured embedding model.

Memory is evidence, not unquestionable truth. Actor-visible memory should show
scope, confidence, and provenance.

Detailed memory behavior lives in `docs/MEMORY.md`.

### memory_candidates

Candidate memories before review/merge.

```text
id
operation
scope
subject_ref jsonb
text
confidence
sensitivity
source_event_ids text[]
provenance_note
status
review_result jsonb
created_by_run_id
created_at
reviewed_at
```

Candidates may be created by the actor, task agents, or scheduled memory review.

### memory_links

Optional explicit links between memory and sessions/users/events.

```text
id
memory_id
linked_type
linked_id
relationship
created_at
```

This makes cross-session memory traceable without merging scopes.

## Summary And Compaction Tables

### summaries

Session summaries and compaction checkpoints.

```text
id
session_id
kind
from_event_id
to_event_id
summary
open_loops jsonb
memory_handoff_notes jsonb
created_by_run_id
created_at
metadata jsonb
```

`kind` values:

```text
session_summary
run_checkpoint
task_summary
memory_review_summary
```

Indexes:

```text
summaries(session_id, created_at desc)
summaries(session_id, to_event_id)
```

The Context Builder must always include a recent raw tail in addition to
summaries.

## Approval Tables

### approvals

Pending and completed approval requests.

```text
id
session_id
requester_event_ids text[]
requested_by jsonb
action_kind
title
summary
exact_preview
proposed_action jsonb
required_trust_scope
status
expires_at
created_by_run_id
created_at
updated_at
decided_at
decided_by jsonb
decision_event_id
```

Statuses:

```text
pending
approved
rejected
expired
revoked
superseded
```

Indexes:

```text
approvals(session_id, status)
approvals(status, expires_at)
approvals(created_by_run_id)
```

Approval applies to the exact proposed action. If the action changes, create a
new approval.

Detailed approval flow and replay protection rules live in
`docs/ACTION_REVIEW.md`.

### approval_notifications

Where approval requests were sent.

```text
id
approval_id
session_id
platform_message_id
sent_to jsonb
status
created_at
updated_at
```

## Tool Tables

Detailed tool behavior lives in `docs/TOOLS.md`.

### tool_definitions

Registered tools.

```text
id
name
source
version
description
input_schema jsonb
output_schema jsonb
risk_level
approval_mode
execution_mode
enabled
metadata jsonb
created_at
updated_at
```

### mcp_servers

Configured MCP servers.

```text
id
name
transport
command
args jsonb
url
env_refs jsonb
trust_status
config_hash
enabled
created_at
updated_at
```

MCP secrets are stored as secret references, not plaintext.

### tool_calls

Validated tool calls.

```text
id
output_id
actor_run_id
session_id
tool_name
input jsonb
risk_level
approval_id
status
started_at
completed_at
result_event_id
error jsonb
created_at
updated_at
```

Tool outputs are untrusted context. Tool results also become `tool.result`
events.

## Skill Tables

Detailed skills behavior lives in `docs/SKILLS.md`.

### skills

Installed or known skills.

```text
id
source
slug
name
install_url
skills_url
local_path
content_hash
trust_status
enabled
metadata jsonb
installed_by_user_id
installed_at
reviewed_at
created_at
updated_at
```

### skill_files

Indexed files belonging to an installed skill.

```text
id
skill_id
path
content_hash
size_bytes
summary
indexed_at
created_at
updated_at
```

### skill_audits

Audit results from skills.sh and local review.

```text
id
skill_id
provider
status
risk_level
summary
raw jsonb
audited_at
created_at
```

### skill_scopes

Where a skill can be used.

```text
id
skill_id
scope_type
scope_id
mode
created_at
updated_at
```

### skill_tool_requirements

Tools a skill says it may need.

```text
id
skill_id
tool_name
reason
required
created_at
```

Skill tool requirements do not grant tool access. Tool Registry and Action
Review still decide each actual call.

## Task Agent Tables

Detailed task-agent behavior lives in `docs/TASK_AGENTS.md`.

### task_agents

Configured task agent types.

```text
id
type
runtime
description
default_tools text[]
default_budget jsonb
enabled
metadata jsonb
created_at
updated_at
```

### task_runs

Runs for research/coding/image/browser/memory/server helper agents.

```text
id
parent_session_id
task_session_id
requested_by_run_id
requested_by_output_id
task_type
goal
status
runtime
budget jsonb
started_at
completed_at
result_event_id
artifacts jsonb
error jsonb
created_at
updated_at
```

Task runs report back with `task.result`.

## Scheduler Tables

Detailed scheduler behavior lives in `docs/SCHEDULER.md`.

### schedules

Recurring and one-shot scheduled behavior.

```text
id
session_id
kind
intent
status
schedule_spec jsonb
active_hours jsonb
cooldown_policy jsonb
limits jsonb
created_by jsonb
approval_id
last_fired_at
next_fire_at
created_at
updated_at
metadata jsonb
```

`kind` values:

```text
ambient_wake
memory_review
server_check
research_watch
custom_task
```

For chat-proactive behavior, `approval_id` is required.

Indexes:

```text
schedules(status, next_fire_at)
schedules(session_id, kind)
```

### schedule_fires

Every planned fire of a schedule.

```text
id
schedule_id
session_id
planned_for
fired_at
status
job_id
event_id
skip_reason
created_at
updated_at
```

Constraints:

```text
unique(schedule_id, planned_for, session_id)
foreign key schedule_id -> schedules.id
foreign key session_id -> sessions.id
```

This prevents duplicate ambient wakes after restarts.

## Config Tables

### config_overrides

Trusted admin runtime overrides.

```text
id
scope
scope_ref
key
value jsonb
status
created_by_user_id
created_at
updated_at
```

Most non-secret config should live in typed TypeScript config files. This table
is for trusted admin overrides that must survive restarts.

Secrets should remain in `.env`, secret references, or the host secret manager,
not plain database rows.

## Artifact Tables

### artifacts

Metadata for files, generated images, reports, logs, workspaces, and runtime
outputs.

```text
id
kind
title
owner_session_id
owner_run_id
path
url
hash
mime_type
size_bytes
retention_policy
metadata jsonb
created_at
updated_at
```

Large artifact bytes live outside Postgres.

## Audit Tables

Detailed observability behavior lives in `docs/OBSERVABILITY.md`.

### audit_log

Append-only operational audit.

```text
id
event_type
actor jsonb
session_id
event_id
actor_run_id
approval_id
tool_call_id
target jsonb
summary
metadata jsonb
created_at
```

Use audit records for:

- approval decisions
- denied actions
- config changes
- trusted-user changes
- server-management actions
- memory writes or deletes
- scheduler changes
- recovery actions

### decision_records

Short explanations for actor decisions.

```text
id
actor_run_id
session_id
trigger_event_id
decision
reason_code
short_reason
evidence_refs jsonb
memory_used_ids jsonb
ignored_memory_ids jsonb
steering_event_ids jsonb
policy_refs jsonb
created_at
```

### health_checks

Periodic or requested system health observations.

```text
id
check_name
status
summary
details jsonb
checked_at
created_at
```

### trace_refs

References to local or exported traces.

```text
id
trace_id
actor_run_id
job_id
tool_call_id
runtime_call_id
exporter
artifact_id
metadata jsonb
created_at
```

### metric_snapshots

Optional low-cardinality metric snapshots stored in Postgres for local
inspection.

```text
id
metric_name
labels jsonb
value numeric
observed_at
created_at
```

## Recovery Queries

Detailed operations behavior lives in `docs/OPS.md`.

On startup, recovery workers should inspect:

- sessions with active runs whose locks expired
- running jobs with expired locks
- pending approvals past `expires_at`
- due schedules whose `next_fire_at` is in the past
- delivery attempts stuck in running state
- tool calls stuck in running state
- task runs stuck in running state

Recovery should write `system.recovery` events and audit rows for meaningful
repairs.

## Privacy And Retention

Default behavior:

- Keep event history because it is the source of truth.
- Keep raw payload refs only as long as useful for audit/replay.
- Keep memory records until replaced, forgotten, expired, or manually removed.
- Keep generated artifacts according to retention policy.

Future privacy work can add explicit redaction events. Do not silently mutate
old events without audit.

## Drizzle Implementation Notes

Recommended package layout:

```text
src/db/schema/
  identity.ts
  channels.ts
  sessions.ts
  events.ts
  runs.ts
  jobs.ts
  memory.ts
  approvals.ts
  tools.ts
  tasks.ts
  schedules.ts
  artifacts.ts
  audit.ts
  index.ts
```

Recommended helper layers:

```text
EventStore
SessionStore
RunStore
JobQueue
MemoryStore
ApprovalStore
ScheduleStore
AuditStore
```

Each store should validate inputs with the contract schemas before writing.

## First Migration Shape

The first migration should create:

- extensions
- identity tables
- channel/session tables
- events
- actor_runs
- actor_outputs
- jobs
- approvals
- schedules
- memory_records
- memory_candidates
- summaries
- audit_log

Secondary migrations can add:

- task agent tables
- tool call tables
- artifacts
- raw payloads
- delivery attempts
- memory links
- config overrides

This order gives Param reboot survival, event durability, actor state,
approvals, scheduling, and memory early.
