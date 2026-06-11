# Param Agent Runtime Adapters

This file defines how Param talks to model-backed runtimes and CLIs.

Core principle:

```text
Runtime adapters translate. They do not own Param's behavior.
```

## Purpose

Runtime adapters let Param use different engines without rewriting the
orchestrator, channel adapters, memory system, or action-review policy.

Target runtimes:

- Codex
- OpenCode
- Antigravity
- image generation runtimes
- browser automation runtimes
- custom CLI runtimes
- future model/provider runtimes

The runtime can think, code, browse, generate, inspect, or run tools. Param
still owns:

- session routing
- event durability
- prompt contracts
- visible chat style
- memory boundaries
- tool policy
- trusted approval
- output validation
- delivery to chat

## AI SDK Is Optional And Not The Runtime Adapter Layer

Param starts with Codex CLI through the Codex runtime adapter.

AI SDK is optional. It can be useful later for structured output helpers, tool
schemas, generated UI data, testing, telemetry, an API-backed runtime, or a
community-provider experiment.

Direct paid API model calls are not part of the default runtime.

It does not replace runtime adapters.

Even when an AI SDK community provider exists for a CLI, the CLI is still a
runtime from Param's point of view. Param needs a runtime adapter because code
agent CLIs have their own process lifecycle, auth, workspaces, sandboxing,
approval modes, internal tools, artifacts, logs, cancellation behavior, and
steering behavior.

Rule:

```text
AI SDK may be an implementation detail inside a runtime adapter.
It is not the boundary between Param core and a runtime.
```

Current provider posture:

- Codex CLI has an AI SDK community provider, but Param still needs a Codex
  runtime adapter.
- OpenCode has an AI SDK community provider, but Param still needs an OpenCode
  runtime adapter.
- Antigravity has no default AI SDK provider dependency in Param.
- Direct provider packages such as `@ai-sdk/openai`, `@ai-sdk/anthropic`, and
  `@ai-sdk/google` are optional future API-runtime dependencies, not bootstrap
  dependencies and not a way to control coding CLIs.

## Adapter Implementation Posture

Param should build real adapters for the first coding CLIs.

Default posture:

- Codex adapter: runtime boundary is `src/runtimes/codex/`; it can test the
  Codex CLI community provider, but must also understand Codex process/config
  behavior directly.
- OpenCode adapter: runtime boundary is `src/runtimes/opencode/`; it can test
  the OpenCode community provider, but must preserve Param output buffering,
  Action Review, artifacts, and logs.
- Antigravity adapter: runtime boundary is `src/runtimes/antigravity/`; start
  as a direct CLI/SDK adapter unless an official or trusted provider exists and
  passes adapter tests.

An adapter implementation is acceptable only when it proves:

- installed version and capability detection
- installer/checker integration for the host CLI runtime
- process/server lifecycle control
- workspace setup and cleanup
- environment and secret filtering
- buffered output capture
- artifact and log capture
- cancellation or steering fallback
- tool/action interception or safe degradation
- Action Review integration for consequential actions
- crash/reboot recovery behavior
- clear runtime events for observability

## What An Adapter Owns

A runtime adapter owns the messy details of one runtime.

Adapter responsibilities:

- start runtime runs
- translate `PromptPacket` into runtime-specific input
- inject Param identity and voice where the runtime allows it
- configure runtime workspaces
- pass allowed environment variables
- stream or collect runtime events
- intercept tool/action requests where possible
- buffer visible text unless safe streaming is available
- report capabilities
- cancel or interrupt when supported
- collect artifacts and logs
- normalize results into Param events
- close processes and clean resources

An adapter should make the rest of Param forget which runtime did the work.

## What An Adapter Does Not Own

Adapters must not own:

- session identity
- chat delivery
- trusted-user approval
- global tool permissions
- memory writes
- final visible chat voice
- scheduler behavior
- database schema decisions
- secret storage
- cross-session privacy policy

Those belong to Param core modules.

## Runtime Types

Initial runtime categories:

```text
chat_actor
  main Session Actor runtime

coding_cli
  Codex, OpenCode, Antigravity, or another code agent CLI

image
  image generation or image editing runtime

browser
  browser automation runtime

research
  model-backed research runtime

server
  controlled server-management runtime

custom_cli
  configured command-line runtime
```

One physical runtime can support multiple categories.

Example:

```text
Codex can be used as the main actor runtime, a coding task runtime, or a
research task runtime if configured that way.
```

## Lifecycle

Runtime run lifecycle:

```text
1. Orchestrator or Task Agent Manager requests a runtime run.
2. Prompt Compiler creates a PromptPacket or task context packet.
3. Runtime Adapter validates capabilities and config.
4. Runtime Adapter prepares workspace and environment.
5. Runtime Adapter starts the process/API call.
6. Runtime Adapter records runtime.event entries.
7. Runtime output is buffered or checkpointed.
8. Runtime tool/action requests are intercepted.
9. Param validators and Action Review process proposed outputs.
10. Runtime Adapter reports completion, cancellation, or failure.
11. Param persists final actor output, task.result, artifacts, and audit.
```

The runtime should not directly deliver chat messages.

## Run Request

The core should start a runtime with a structured request.

Target shape:

```ts
type RuntimeAdapterRunRequest = {
  schemaVersion: 1;
  runtime: "codex" | "opencode" | "antigravity" | "image" | "browser" | string;
  runKind: "actor" | "task" | "memory_review" | "compaction" | "admin";
  actorRunId?: string;
  taskRunId?: string;
  sessionId: string;
  parentSessionId?: string;
  promptPacketRef?: string;
  taskContextRef?: string;
  workspace: RuntimeWorkspaceSpec;
  environment: RuntimeEnvironmentSpec;
  allowedTools: string[];
  approvalPolicyRef: string;
  budget: RuntimeBudgetSpec;
  outputMode: "buffered" | "checkpointed_stream";
  idempotencyKey: string;
};
```

The request should reference prompt/context snapshots instead of duplicating
large blobs everywhere.

Supporting shapes:

```ts
type RuntimeBudgetSpec = {
  timeoutSeconds?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxToolCalls?: number;
  maxOutputBytes?: number;
  maxArtifacts?: number;
  maxRetries?: number;
};
```

## Capabilities

Live steering is not guaranteed.

Each adapter reports capabilities:

```ts
type RuntimeAdapterCapabilities = {
  runtime: string;
  supportsLiveSteering: boolean;
  supportsCancel: boolean;
  supportsCheckpointRefresh: boolean;
  supportsToolInterception: boolean;
  supportsOutputBuffering: boolean;
  supportsArtifacts: boolean;
  supportsUsage: boolean;
};
```

Param core must work when most values are `false`.

No runtime capability should be assumed from the runtime name alone. The adapter
should report what the installed version and configured mode actually support.

## Output Modes

Default output mode:

```text
buffered
```

Buffered means runtime output is captured inside Param first. Param validates
it before anything reaches Telegram or another communication channel.

Checkpointed streaming is allowed only when:

- the adapter can stop at safe checkpoints
- pre-send refresh can run before visible output
- style guard can inspect visible text
- Action Review can intercept side effects
- duplicate delivery is prevented

Raw model streams should not go straight to chat.

## Live Steering

If the runtime supports live steering:

```text
new same-session steering -> adapter injects into active runtime run
```

If it does not:

```text
new same-session steering -> Param stores steering -> adapter cancels/restarts,
or buffers output and refreshes before delivery
```

Fallback ladder:

```text
best
  inject steering into active run

good
  cancel or pause, then restart with updated context

fallback
  let run finish, buffer output, refresh before delivery or side effects
```

The invariant:

```text
Param may waste runtime work, but it must not deliver stale visible output or
perform stale side effects.
```

## Tool Interception

Runtime tools must be intercepted or wrapped.

The adapter should prevent a runtime from directly performing consequential
actions outside Param policy.

Tool interception modes:

```text
disabled
  runtime native tools are disabled; Param tools are called through structured
  output only

adapter_intercepted
  runtime tool requests are captured and converted into Param tool_call events

runtime_native_safe
  runtime can use a small safe read-only set directly, with logs captured
```

Dangerous actions still go through Action Review:

- file edits
- shell commands
- package installs
- server changes
- external messages
- config changes
- memory writes
- broad private-data access

If a runtime cannot expose tool calls cleanly, use buffered text plans and have
Param convert approved intent into Param tool calls.

## Approval Boundary

Some runtimes have their own approval or sandbox concepts.

Param still requires its own Action Review.

Runtime approval is defense-in-depth. It does not replace:

- trusted-user approval
- Param tool policy
- exact proposal approval
- audit rows
- requester/approver separation

If runtime approval denies an action, Param treats the action as blocked.

If runtime approval allows an action, Param still checks Param policy before the
side effect happens.

## Prompt Translation

Adapters receive compiled prompt packets.

They should not build unrelated prompts from scratch.

Adapter translation preserves:

- runtime adapter frame
- identity and voice layer
- run contract
- platform capability summary
- session context
- memory context
- active state and steering
- allowed outputs
- approval/tool policy
- style guard instructions

If a runtime has limited prompt controls, the adapter should preserve the
highest-priority contract pieces and rely on output validation for the rest.

## Personality Injection

Param's visible personality is a product contract, not a runtime default.

Adapters can use runtime-specific controls:

- custom instructions
- project files
- runtime config
- rules files
- wrapper prompts
- environment settings
- output repair

Adapters should explicitly override generic `helpful assistant` or
`useful assistant` persona wording where the runtime allows persona steering.

Adapters must not tell the runtime to ignore real system, safety, or tool
instructions.

Visible chat text still passes through Param's style guard.

## Codex Adapter

Codex can be used for:

- main actor runs
- coding task agents
- research task agents
- repo inspection
- patch generation
- server-management planning

Adapter behavior:

- use Codex personalization or custom instructions when available
- use project instructions such as `AGENTS.md` where appropriate
- keep Param prompt contracts outside ad hoc chat text when possible
- assume Codex still has its own base, safety, and tool instructions
- buffer visible chat output unless safe checkpoint streaming is confirmed
- intercept proposed file edits, shell commands, and external actions through
  Param Action Review
- store Codex logs and artifacts as runtime events/artifacts

Codex-specific configuration should stay inside the Codex adapter.

## OpenCode Adapter

OpenCode can be used for:

- coding task agents
- repo exploration
- patch generation
- CLI-backed research
- custom tool workflows

Adapter behavior:

- use OpenCode config, agents, rules, or project files where supported
- map Param's prompt packet into OpenCode's available instruction surfaces
- keep tool and approval policy in Param, not only OpenCode config
- buffer visible chat output unless safe checkpoint streaming is confirmed
- capture OpenCode tool/action requests and normalize them into Param events
- store logs and artifacts with runtime metadata

The adapter should verify concrete OpenCode config locations during
implementation instead of assuming one permanent file layout.

## Antigravity Adapter

Antigravity can be used for:

- coding task agents
- repo inspection
- CLI automation
- alternate model/provider behavior

Adapter behavior:

- use CLI settings, preferences, hooks, plugins, or project instructions only
  where the implementation confirms support
- do not assume full prompt replacement
- preserve Param prompt contracts through wrapper/context layers
- buffer visible chat output unless safe checkpoint streaming is confirmed
- intercept file, shell, server, and external actions through Param policy
- store runtime logs and artifacts

Antigravity-specific behavior should be discovered and tested by the adapter,
not hardcoded into the orchestrator.

## Image Runtime Adapter

Image runtimes create or edit media.

They receive:

- image goal
- style/content constraints
- source image refs, if any
- safety constraints
- output format expectations
- artifact storage target
- budget

They return:

- artifact refs
- prompt/ref metadata
- errors or safety blocks
- suggested caption, if useful

They should not directly send media to chat.

The Session Actor decides whether to send, caption, ask approval, render in UI,
or keep the artifact internal.

## Browser Runtime Adapter

Browser runtimes inspect and interact with websites.

They receive:

- goal
- starting URLs
- allowed domains, if restricted
- credential policy
- action policy
- artifact settings for screenshots/logs
- timeout and step budget

Browser actions can be risky.

Manual approval may be required for:

- login flows
- forms
- purchases
- account changes
- messages/comments/posts
- downloads/uploads
- accessing private data

Read-only public browsing can often run after auto-review.

## Custom CLI Adapter

Custom CLI adapters let Param use future tools.

Minimum requirements:

- command path
- args
- workspace policy
- environment policy
- output parser
- capability report
- timeout
- budget
- artifact handling
- shutdown behavior

Custom CLIs start with conservative policy:

- buffered output
- no live steering assumed
- no native tool trust
- no broad filesystem access
- Action Review for side effects

## Workspaces

Every runtime run should have a workspace policy.

Workspace spec:

```ts
type RuntimeWorkspaceSpec = {
  root: string;
  runDir: string;
  mode: "read_only" | "scoped_write" | "full_workspace";
  cleanupAfterDays?: number;
};
```

Rules:

- runtime writes are scoped when possible
- generated files become artifacts or proposed patches
- workspaces are linked to run ids
- cleanup should not delete unreported artifacts
- server paths require stricter approval than project workspaces

Workspaces are a key isolation layer.

## Environment And Secrets

Runtime environment must be explicit.

Environment spec:

```ts
type RuntimeEnvironmentSpec = {
  variables: Record<string, string>;
  secretRefs: string[];
  inheritProcessEnv: false;
};
```

Rules:

- do not inherit the whole process environment
- pass only approved variables
- pass secrets by reference/resolved injection, not prompt text
- redact secrets from logs
- never include raw secrets in actor prompts, memory, or artifacts

Runtime credentials belong in `.env`, secret refs, or a future secret manager.

## Artifacts And Logs

Runtime adapters should capture:

- stdout/stderr
- structured runtime events
- tool requests
- tool results
- generated files
- screenshots
- patches
- usage/cost metadata
- errors

Large logs should be stored as artifacts or raw payload refs, not dumped into
events.

Visible chat should receive summaries or attachments only after the Session
Actor chooses them.

## Budget And Timeout

Every runtime run has a budget.

Budget dimensions:

- timeout seconds
- max tokens
- max cost
- max tool calls
- max output bytes
- max artifacts
- max retries
- max browser steps, for browser runs

Budget exhaustion should produce a structured failure or partial result.

The run should not disappear.

## Failure Handling

Runtime failures become structured events.

Failure cases:

- command missing
- auth missing
- provider error
- model refused
- context too large
- timeout
- budget exceeded
- process crashed
- parse failure
- unsupported capability
- tool interception failed
- approval denied
- cancellation requested

Adapters should return:

- failure code
- concise message
- retryability
- partial artifacts
- logs refs
- suggested recovery, when known

## Recovery

After reboot or crash, recovery should inspect:

- actor runs stuck in runtime phases
- task runs without final result
- runtime processes still running
- runtime processes that disappeared
- buffered outputs not validated
- artifacts without linked runs
- locks past expiration

Recovery choices:

- resume if the runtime supports it
- cancel and restart from checkpoint
- mark failed with partial result
- discard stale buffered output
- wake parent actor with an honest failure result

No buffered output should be delivered after recovery until pre-send refresh and
validation pass.

## Observability

Runtime observability should answer:

- which runtime ran
- which adapter version ran
- what prompt/context snapshot it saw
- what workspace it used
- what tools it requested
- what actions were blocked or approved
- how long it ran
- what it cost
- what artifacts it created
- whether output was buffered or streamed
- whether steering was injected, restarted, or deferred

## Data Mapping

Runtime data is stored through existing tables:

- `actor_runs.runtime`
- `actor_runs.model`
- `actor_runs.metadata`
- `task_runs.runtime`
- `events` with `runtime.event`
- `tool_calls`
- `artifacts`
- `jobs`
- `audit_log`

Detailed table shapes live in `docs/DATABASE.md`.

## Config Mapping

Relevant config:

- enabled runtimes
- command and args
- workspace directories
- environment and secret refs
- personality injection method
- live steering mode
- output mode
- tool interception mode
- default budgets
- adapter capability overrides
- artifact retention

Detailed config shape lives in `docs/CONFIG.md`.

## Contract Mapping

Relevant contracts:

- `RuntimeAdapterCapabilities`
- `RuntimeAdapterRunRequest`
- `RuntimeEventPayload`
- `PromptPacket`
- `ActorOutput`
- `ToolCallOutputPayload`
- `TaskResultPayload`

Detailed contract shapes live in `docs/CONTRACTS.md`.

## Tests

Runtime-adapter tests should cover:

- adapter reports capabilities
- missing runtime command fails clearly
- prompt packet is translated without losing required layers
- visible output is buffered by default
- checkpointed streaming runs pre-send refresh
- live steering injection works when supported
- non-steerable runtime uses cancel/restart or buffered refresh
- tool request becomes Param `tool_call`
- unsafe tool request requires Action Review
- runtime cannot send directly to chat
- style guard catches assistant-like visible output
- secrets are redacted from logs and prompts
- workspace write scope is enforced
- timeout returns structured failure
- budget exhaustion returns partial result
- reboot recovery does not deliver stale buffered output
- Codex/OpenCode/Antigravity adapters keep runtime-specific config isolated
