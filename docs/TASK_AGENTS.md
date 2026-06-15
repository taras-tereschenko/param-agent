# Param Agent Task Agents

This file defines how Param spawns focused helper agents.

Core principle:

```text
Task agents do the focused work. Param decides what reaches the chat.
```

## Purpose

Task agents exist so the main Session Actor does not have to hold every long
research thread, coding trace, browser run, image job, or server operation in
the chat context.

They help with:

- context bloat
- long-running work
- specialized tools
- parallel investigation
- generated images or media
- code changes through CLI runtimes
- browser automation
- memory review
- server inspection

A task agent is not a second public personality in the chat. It is a worker
behind Param.

## When To Spawn

The Session Actor can spawn a task agent when:

- the work would bloat the current chat context
- the work needs a specialized runtime
- the work can run in parallel
- the result may take longer than a normal chat reply
- the task needs tools the main actor should not run directly
- the task should produce artifacts
- the chat needs research, code, image generation, browser work, memory review,
  or server inspection

Examples:

```text
research whether this library supports telegram reactions
```

```text
generate an image for this joke
```

```text
ask codex to inspect this repo and propose the adapter interface
```

```text
check server logs and tell me if param restarted
```

## When Not To Spawn

Do not spawn a task agent for work the Session Actor can answer naturally.

Avoid task agents for:

- tiny chat replies
- normal reactions
- simple memory use
- decisions about whether to speak
- every message in a busy group
- work that would clearly be denied by policy
- repeated retries with no new information

Spawning a task agent should reduce complexity, not create ceremony.

## Agent Types

Initial task-agent types:

```text
research
  investigates a question and returns cited findings

coding
  uses Codex, OpenCode, Antigravity, or another coding runtime

image
  generates or edits images

browser
  inspects websites or performs browser automation

memory
  reviews context and proposes memory candidates

cli
  runs a specific configured CLI runtime

server
  inspects or manages Param's VPS through reviewed tools
```

More types can be added through config and the Task Agent Manager without
changing channel adapters or the orchestrator.

## Lifecycle

Task-agent lifecycle:

```text
1. Session Actor emits spawn_task_agent.
2. Validators check schema, budget, tool policy, and task type.
3. Action Review decides whether the spawn can run now or needs approval.
4. Task Agent Manager creates a task session.
5. Task Agent Manager creates a task_runs row.
6. Context Builder builds a focused task context packet.
7. Runtime Adapter starts the task run.
8. Task agent runs with its own budget, tools, workspace, and timeout.
9. Task agent returns task.result.
10. Parent session receives task.result as an internal event.
11. Session Actor decides what, if anything, to say publicly.
```

The parent chat does not wait in a fragile in-memory state. The task run is
durable.

## Task Sessions

Each task agent gets its own task session.

Example session key:

```text
task:<parent-session-id>:<task-id>
```

The task session stores:

- task prompt/context packet
- runtime events
- tool results
- artifacts
- task summaries
- errors
- final result

The parent session stores:

- the spawn output
- task status events
- final `task.result`
- any visible Param messages about the task

This keeps helper work out of the main chat transcript while preserving
evidence and audit.

## Context Packet

Task agents receive focused context, not the whole chat.

Task context packet:

```ts
type TaskAgentContextPacket = {
  schemaVersion: 1;
  taskRunId: string;
  taskSessionId: string;
  parentSessionId: string;
  taskType: string;
  goal: string;
  requestedByRunId: string;
  requestedByOutputId: string;
  sourceEventIds: string[];
  relevantEvents: unknown[];
  summaries: unknown[];
  memory: unknown[];
  artifacts: unknown[];
  constraints: TaskAgentConstraints;
  approvalPolicy: unknown;
  outputContract: "task_result_v1";
};
```

Context Builder should include:

- original request
- selected source events
- recent raw tail when needed
- relevant summaries
- scoped memory with provenance
- relevant artifacts
- tool constraints
- approval policy
- budget and timeout
- desired result format

Context Builder should not include:

- unrelated chat history
- secrets
- private memory from unrelated sessions
- full raw logs unless specifically needed
- trusted-user config beyond policy summaries

## Context Bloat Rule

Task agents are a pressure valve for context bloat.

Good pattern:

```text
main actor -> spawn research task -> task summarizes findings -> main actor
uses summary in chat
```

Bad pattern:

```text
main actor copies the whole group history into a task agent
```

The task context should be small, relevant, and auditable.

When the task result is large, it should return:

- concise result
- artifact refs
- evidence refs
- optional summary section for compaction

The main chat should receive only what matters.

## Runtime Selection

Task Agent Manager chooses a runtime from config.

Detailed runtime-adapter behavior lives in `docs/RUNTIME_ADAPTERS.md`.

Examples:

```text
research -> model-backed research runtime
coding -> codex, opencode, or antigravity adapter
image -> image generation runtime
browser -> browser automation runtime
server -> controlled server-management runtime
```

Runtime selection should consider:

- task type
- requested runtime, if allowed
- enabled runtimes
- trust scope
- tool policy
- budget
- model/provider availability
- whether live steering/cancel/output buffering is supported

The Session Actor can suggest a runtime, but config and policy decide what is
allowed.

## Runtime Personality

Task agents do not need to sound like Param internally.

They should be clear, technical, and concise in their internal results.

Only the Session Actor writes visible chat output in Param's voice.

This prevents helper agents from leaking:

- corporate assistant tone
- giant reports
- runtime-specific personality
- tool logs as chat messages
- confusing second-agent identity

## Outputs

A task agent reports back with `task.result`.

Result should include:

- status
- concise summary
- evidence event ids
- artifact refs
- tool trace refs
- memory candidates, if any
- proposed next actions, if any
- error details, if failed

The result is internal by default.

The Session Actor can then emit:

- `message`
- `no_reply`
- `tool_call`
- `spawn_task_agent`
- `approval_request`
- `memory_candidate`
- `render_ui`
- `run_summary`
- `done`

## Progress

Task agents may emit progress internally.

Progress is useful for:

- debug views
- internal operator surfaces
- long-running task status
- timeout decisions
- recovery after reboot

Progress should not automatically become chat messages.

If the chat needs visible progress, the Session Actor should send it naturally.

Example:

```text
i'm checking
```

not:

```text
Task agent research_123 has entered phase fetch_sources.
```

## Approvals

Spawning a task agent can itself require Action Review.

Manual approval is required or likely required when the task:

- can edit files
- can run shell commands
- can manage the server
- can spend meaningful money
- can send external messages
- can access private data from another session
- can use broad filesystem access
- can change config, memory, tools, or trusted users
- can call a powerful runtime with write access

Safe read-only research inside the current session can often run after
auto-review.

Approval applies to the exact task proposal:

- task type
- goal
- runtime
- allowed tools
- workspace or target
- budget
- trust scope

If any meaningful field changes, request approval again.

## Tool Access

Task agents use tools through the same Tool Registry as the main actor.

Rules:

- tool access is explicit per task
- default tools come from task-agent config
- spawn output can narrow tools further
- Action Review gates consequential tool use
- tool results are stored as events
- tool traces are linked from `task.result`

Task agents must not receive broad tool power just because they are internal.

## Budgets

Every task run needs a budget.

Budget dimensions:

- timeout seconds
- max tokens
- max cost
- max tool calls
- max files/artifacts
- max browser steps
- max retries

The actor may request a budget, but config can cap it.

If a budget is exhausted, the task should return a partial result instead of
disappearing.

## Workspaces

Coding, CLI, browser, and server tasks need isolated workspaces.

Workspace rules:

- each task gets a task-specific workspace when possible
- workspace path is stored in task metadata
- write access is scoped
- generated artifacts are stored with refs
- secrets are injected only through approved runtime env
- cleanup policy is explicit

Task isolation relies on:

- per-task workspaces
- filesystem path policies
- process user permissions
- environment scoping
- timeouts
- budget limits
- Action Review
- audit logs

## Artifacts

Artifacts can include:

- generated images
- research notes
- source snapshots
- patches
- logs
- screenshots
- browser captures
- reports
- structured JSON

Artifacts should be referenced by id/path, not pasted into chat by default.

The Session Actor decides whether to attach, summarize, render UI, or stay
quiet.

## Cancellation

Tasks must be cancellable when the runtime supports it.

Cancellation can happen because:

- trusted user says stop
- parent actor cancels
- approval is denied
- budget is exhausted
- newer context makes the task irrelevant
- runtime becomes unhealthy
- shutdown/reboot begins

If runtime cancellation is unsupported, Param should mark the task as
cancel-requested, stop delivering results unless still relevant, and clean up
when the runtime exits.

## Reboot Recovery

Task runs must survive restarts.

After reboot, recovery should inspect:

- `task_runs` stuck in queued or running
- runtime processes that disappeared
- jobs with expired locks
- task sessions with no final `task.result`
- artifacts created without linked result
- parent actor runs waiting on task results

Recovery choices:

- resume when runtime supports it
- restart with the last checkpoint
- mark failed with an honest error
- report partial artifacts
- notify parent session only when useful

Duplicate task results must be prevented with idempotency keys.

## Parent Actor Handoff

When `task.result` arrives, it wakes the parent Session Actor.

The parent actor receives:

- task result
- original request
- current chat context
- relevant steering since the task started
- memory
- artifacts and evidence refs
- approval state

The parent actor decides:

- say nothing
- send a short result
- ask a follow-up
- request approval
- spawn another task
- render UI
- store memory candidate
- continue the task with new context

This is where Param becomes conversational again.

## Memory

Task agents can propose memory candidates.

They cannot directly write trusted memory.

Examples:

- research task finds a project decision
- memory task extracts a user preference
- coding task notices a repo convention
- server task records an operational lesson

Memory candidates still go through the Memory System:

- scope validation
- sensitivity checks
- provenance
- merge/update/forget logic
- audit

## Images And Media

Image agents can generate or edit media.

They should return:

- artifact refs
- prompt/ref metadata
- safety or generation errors
- suggested caption, if useful

The image task should not automatically send media to chat.

The Session Actor decides whether to send it, caption it, render it in a Mini
App, ask for approval, or keep it as an artifact.

## Server Tasks

Server tasks are powerful and need strict review.

Read-only server inspection may be allowed through safe auto-run policy.

Server-changing work requires Action Review and usually trusted approval:

- restart services
- edit config
- install packages
- change native service definitions
- rotate secrets
- alter firewall or network exposure
- delete logs/data
- update runtime binaries

Server task results should include a rollback or recovery note when possible.

## Research Tasks

Research tasks should return evidence, not just conclusions.

Useful result shape:

- short answer
- sources or evidence refs
- confidence
- what changed since last check, if relevant
- unresolved caveats
- suggested memory candidates

Research tasks should not flood the chat with citations. The parent actor can
decide how much detail belongs in the conversation.

## Coding Tasks

Coding tasks can use Codex, OpenCode, Antigravity, or another CLI runtime.

Coding task result should include:

- changed files or proposed files
- patch/artifact refs
- tests run
- failures
- risks
- next suggested action

Editing files, running unsafe commands, installing packages, or changing server
state still goes through Action Review.

## Observability

Store enough information to explain:

- why the task was spawned
- who requested it
- what context it received
- what runtime and tools it used
- what it cost
- what it changed
- what artifacts it produced
- why it failed, timed out, or was cancelled
- what the parent actor did with the result

## Data Model

Main tables:

- `task_agents`
- `task_runs`
- `sessions`
- `events`
- `jobs`
- `actor_outputs`
- `tool_calls`
- `artifacts`
- `audit_log`

Detailed table shapes live in `docs/DATABASE.md`.

## Config Mapping

Relevant config:

- enabled task-agent types
- default runtime per task type
- fallback runtime per task type
- default tools
- default budgets
- max concurrent tasks per session
- max concurrent tasks globally
- workspace roots
- artifact retention
- approval policy

Detailed config shape lives in `docs/CONFIG.md`.

## Tests

Task-agent tests should cover:

- spawn creates a task session and task run
- task context contains selected events, not whole chat history
- task result wakes parent Session Actor
- task agent does not send visible chat output directly
- unsafe task spawn requires approval
- unsafe tool call inside task requires approval
- budget exhaustion returns partial result
- cancellation marks task safely
- reboot recovery resolves stuck task runs
- duplicate task result does not duplicate visible chat messages
- memory candidates from task agents go through Memory System
- coding task artifacts link to changed files or patches
- image task returns artifact refs instead of sending directly
