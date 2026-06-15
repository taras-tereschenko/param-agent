# Param Agent Build Spec

This is the build specification for Param Agent.

It describes the target system. It is meant to be clear enough that another
agent or engineer can build the system without reconstructing the architecture
from chat history.

## Purpose

Param is an always-online ambient chat agent.

It lives in Telegram and is designed to support other communication channels.
It reads the room, participates naturally, remembers useful things, spawns
helper agents, uses tools, renders structured UI, and can manage its server
through reviewed autonomy.

Core behavior principle:

```text
Param replies when it feels natural for a friend in the chat to reply.
```

Param should not feel like a command bot or a helpful-assistant helpdesk. It
should feel like a regular friend in the chat: casual, present, context-aware,
sometimes sarcastic, sometimes quiet, sometimes useful.

## Voice And Personality

Param's visible chat voice is product behavior.

He should sound like a real friend in a modern US chat, not like a customer
support bot, corporate assistant, generic AI helper, or mascot.

Param should feel like modern friends in the US chatting.

Chat voice:

- concise and witty
- lowercase by default
- short messages
- separate thoughts into separate messages
- little punctuation
- no final periods in normal chat
- modern slang, abbreviations, emojis, and fragments are normal language
- sarcasm and opinions are allowed when they fit the room
- match the chat's energy without losing his own personality
- no paragraphs in normal visible chat
- no bullet lists in normal visible chat
- no long dashes
- no robotic prefixes like `small update:`
- no GPT-style closers like `let me know if you need anything else`
- no `as an ai` framing
- no tiny-helper or creature self-description

Slang must not be restricted by wording like "use slang lightly." That kind of
instruction can make the model avoid it too much. The better rule is:

```text
Use whatever casual chat language feels natural for this room.
```

The quality bar is authenticity. Forced, outdated, corporate, overexplained, or
trying-too-hard language should be rewritten, but slang itself is not a scarce
resource.

Param should not be told to ignore real system, safety, or tool instructions.
Instead, adapters should explicitly override generic "helpful assistant" or
"useful assistant" persona wording where the runtime allows persona steering.
Safety, permissions, and action-review policies still apply.

## Modular Architecture

Param must be modular by design.

Every major subsystem should sit behind a narrow interface. Communication
channel details must stay inside channel adapters. CLI runtime details must
stay inside runtime adapters. Memory storage details must stay inside the memory
system.

The core orchestrator should coordinate modules without owning their internal
implementation.

Primary modules:

```text
Communication Channels
  channel adapters for Telegram now, and WhatsApp, Slack, web, email, or voice
  later

Orchestrator
  deterministic routing, event storage, queueing, batching, recovery

Session Store
  durable session identity, status, policy links, active run pointer

Event Store
  append-only record of incoming messages and Param outputs

Job Queue
  durable queued work for actors, memory review, compaction, tasks

Session Actor
  LLM-powered decision maker for one chat/session

Runtime Adapters
  Codex, Antigravity, OpenCode, image generation, browser, other CLIs

Task Agent Manager
  spawns and tracks focused helper agents

Memory System
  memory candidates, approvals, scoped memory records, retrieval

Compaction System
  summaries, recent raw tail, open state, context checkpoints

Tool Registry
  files, shell, services, image generation, server management, external APIs

Action Review
  safe auto-run, auto-review, trusted-user approval, audit

UI Renderer
  structured cards, buttons, Mini Apps, generated UI surfaces

Observability
  logs, traces, audit, debug views, metrics

Admin Surface
  private server controls, configuration, health, recovery
```

## Programmatic And LLM Layers

Param has a hard boundary between mechanics and judgment.

Purely programmatic layers:

- Channel Adapters
- Orchestrator
- Session Store
- Event Store
- Job Queue
- Scheduler
- Context Builder
- Prompt Compiler
- Output validators
- Delivery Adapter
- Config Loader
- Audit and observability

These layers do not decide what a message means socially. They route events,
load state, apply deterministic policy, validate shapes, enforce locks, and
make side effects durable.

LLM-powered layers:

- Session Actor
- Memory Review Actor
- Compaction Actor
- task agents
- runtime adapters that delegate work to Codex, OpenCode, Antigravity, or
  another model-backed CLI
- optional style-repair actor

Hybrid layers:

- Action Review can use an LLM to analyze risk, but deterministic policy code
  makes the final allow, deny, or approval-required decision.
- Memory retrieval is deterministic search and ranking, then the actor decides
  how the retrieved memory matters.
- Ambient wakes are scheduled by code, then the actor decides whether to speak,
  react, spawn work, or stay quiet.
- Style Guard starts with deterministic checks and can ask an LLM to repair
  visible text that violates Param's voice contract.

The important rule:

```text
Code decides when an actor is allowed to think.
The actor decides what the moment means.
Code validates what the actor wants to do.
```

## End-To-End Flow

Incoming chat activity flows through durable state before any actor thinks.

```text
1. Telegram update arrives through Chat SDK.
2. Chat SDK verifies/parses it into normalized SDK events.
3. Telegram Channel Adapter maps the SDK event into Param's internal event schema.
4. Orchestrator resolves the session deterministically.
5. Event Store persists the internal event plus needed raw payload data.
6. Session Store updates batching and active-run state.
7. Orchestrator either appends live steering, batches, or enqueues an actor job.
8. Context Builder loads recent events, summaries, memory, and active state.
9. Session Actor decides what to do.
10. Actor emits durable output events.
11. Tool calls and risky actions pass through Action Review.
12. Telegram Channel Adapter sends visible replies, reactions, cards, or UI updates.
13. Memory Review and Compaction update durable context.
```

The actor decides meaning. The orchestrator decides mechanics.
The prompt packet is the handoff between them.

## Communication Channels

Detailed channel behavior lives in `docs/CHANNELS.md`.

Telegram-specific behavior lives in `docs/channels/TELEGRAM.md`.

Param uses Vercel Chat SDK as the messenger layer.

Responsibilities:

- receive Telegram messages, reactions, replies, mentions, files, and actions
- send text replies, reactions, cards, buttons, files, and UI links
- expose raw platform payloads when needed
- map normalized Chat SDK events into Param internal events
- hide platform-specific details from the orchestrator and actor
- support additional channel adapters through the same internal interface

Telegram transport default:

```text
Use long polling from the VPS.
Do not require public Telegram webhooks for the core bot.
```

Polling means the VPS keeps an outbound connection to Telegram and asks for new
updates. It does not need a public HTTPS endpoint.

Webhooks remain supported as a transport mode for deployments or features that
need Telegram to push updates to a public URL. Webhook mode must use a secret
token and public HTTPS.

Chat SDK already normalizes platform payloads into SDK concepts such as
messages, threads, channels, reactions, actions, and handlers. Param should not
redo that work.

Param still needs its own internal event schema for durability, sessions,
actor runs, batching, approvals, memory, and audit.

The canonical internal event and actor output contracts live in
`docs/CONTRACTS.md`.

The Telegram Channel Adapter should preserve enough raw Telegram data to cover
routing, audit, platform-specific features, and adapter gaps:

- update id
- chat id
- chat type
- message id
- message thread id
- sender user id
- reply target
- entities and mentions
- reaction data
- file/media identifiers
- raw update body or raw payload reference

## Session Model

A session is one durable conversation context.

Examples:

```text
telegram:dm:<user-id>
telegram:group:<chat-id>
telegram:group:<chat-id>:topic:<topic-id>
task:<parent-session-id>:<task-id>
ui:<parent-session-id>:<surface-id>
```

Session keys must be deterministic. The same chat or topic should resolve to
the same session every time.

Session-local state includes:

- raw events for that conversation
- batching state
- active actor run state
- live steering inbox
- recent summaries
- per-session policy link
- scoped memory links
- pending approval pointers

Global or cross-session state does not belong inside a session:

- trusted users list
- server config
- global tool registry
- cross-channel user identity
- project memory
- agent memory

Task agents get their own task sessions. A task session keeps helper context
separate from the chat, while the parent chat session receives task progress and
results as events.

## Session State

Session state is the small durable snapshot that tells Param what is happening
in one conversation right now.

Raw events hold the full history. Session state holds the current operating
position.

Each session should store:

- session id
- stable session key
- platform
- route type
- status
- active run id
- last actor run id
- last event id seen by actor
- batching state
- policy id
- summary checkpoint id
- pending approval count or pointer
- created at
- updated at

Session statuses:

```text
active
  normal session

paused
  observe but do not act automatically

archived
  kept for history

disabled
  ignore new activity except trusted admin controls
```

Paused sessions still store events and may run memory review if policy allows
it. Disabled sessions should not run ordinary actor work.

## Session Routing

Routing is deterministic code.

The orchestrator should not ask an LLM which chat an event belongs to. It uses
platform identifiers from the incoming event.

Route input can include:

- platform
- chat id
- chat type
- message thread id
- sender user id
- message id
- reply target
- raw update id

Route output should include:

- session key
- session id
- route type
- event id
- delivery priority
- batching hint

Telegram mapping:

```text
private chat:
  telegram:dm:<telegram-user-id>

group chat:
  telegram:group:<telegram-chat-id>

forum topic:
  telegram:group:<telegram-chat-id>:topic:<message-thread-id>
```

Cross-session events must keep explicit links instead of merging sessions.

Examples:

- a task result belongs to a task session and reports to the parent chat
- an approval in a private chat can approve an action requested in a group
- a generated UI action can update its parent chat

## Actor Runs

Each session should have at most one active main actor run.

The active run can:

- think for a while
- receive new same-session messages as steering
- send multiple chat messages
- react to messages
- call tools
- spawn task agents
- request approval
- decide to stay quiet

Useful run statuses:

```text
queued
running
waiting_tool
waiting_approval
completed
failed
interrupted
```

Each run should store:

- run id
- session id
- runtime adapter
- status
- phase
- lock owner
- lock expiration
- input checkpoint
- last consumed event id
- last consumed inbox item id
- output cursor
- started at
- updated at
- finished at
- error summary

Workers claim runs with expiring locks. If the process dies, another worker can
inspect the expired lock, preserve all events, and retry or interrupt the run.

## Session Inbox And Live Steering

The session inbox is the durable place for messages that arrive while the actor
is already thinking.

Rules:

- every incoming message is stored as a normal event first
- if a run is active, the orchestrator appends an inbox item for that run
- the orchestrator tags mechanical facts and steering priority
- the actor decides what the message means
- inbox items are append-only
- the actor advances a consumed-inbox cursor
- important items can also receive explicit handled markers

Mechanical tags can include:

- message
- mention
- reply_to_param
- approval_response
- command
- timestamp
- sender id
- sender trust scope
- targets active run
- targets pending approval
- chat velocity

Steering priority is code-level delivery priority, not final meaning.

The deterministic steering classifier can assign:

```text
soft
  update the room context

strong
  may invalidate what Param is about to say or do

hard_control
  mechanically stop, block, or change run state
```

Soft steering examples:

- normal group chatter
- side jokes
- extra context
- reactions
- people talking to each other

Strong steering examples:

- Param is mentioned
- message replies to Param
- message corrects Param
- message says stop, cancel, wait, actually, no, or similar
- message changes the requested task
- message comes from a trusted user and targets the active run
- message targets a pending approval, tool call, or action
- new context could make the next visible output stale

Hard controls can interrupt mechanically:

- trusted stop command
- approval rejection
- session disable
- emergency shutdown

Strong does not mean "more important than soft." It means the current plan may
be stale. Soft means the room changed and the actor should consider it.

The actor receives steering items and decides what they mean socially. The
orchestrator decides only how urgently the actor must refresh before output or
side effects.

Pre-send refresh rule:

```text
Before any visible message, reaction, approval request, tool call, or external
side effect, Param checks for newer same-session events since the run's last
checkpoint.
```

If new strong steering or hard controls arrived, Param must refresh actor
context before continuing. If only soft steering arrived, Param can inject the
delta, summarize it, or let the actor handle it at the next checkpoint depending
on runtime capabilities and chat velocity.

The core invariant is:

```text
Param may waste thinking, but it must not deliver stale visible output or
perform stale side effects.
```

After compaction, the actor must receive the current summary plus the latest
unconsumed raw events and inbox items. This prevents the common failure where an
agent forgets the newest messages after context compaction.

## Actor Output Stream

The Session Actor emits an event stream, not one final answer.

Supported output events:

```text
message
react_to_message
no_reply
tool_call
spawn_task_agent
approval_request
memory_candidate
render_ui
run_summary
done
```

The actor may send multiple natural chat messages during one thinking session.
It should not use robotic prefixes like "small update:".

Outputs must be persisted before or while they are delivered.

Detailed output envelopes and payload shapes live in `docs/CONTRACTS.md`.

## Prompt And Contract Layers

Param should not depend on one giant hand-written master prompt.

Each actor run receives a compiled prompt packet made from small layers. The
layers are selected by run type and session context.

The detailed prompt contracts live in `docs/PROMPTS.md`.

Core layers:

```text
identity and voice
  Param is a real friend in the chat, concise and witty, modern US chat style.

turn contract
  Why this run exists: incoming message, mention, ambient wake, approval,
  memory review, task result, compaction, or admin action.

session context
  Recent messages, summaries, active thread, latest raw tail, and live steering.

memory
  Scoped facts and preferences with provenance and confidence.

skills
  Relevant installed skill summaries and selected full skill content.

platform capabilities
  What this chat can support: messages, reactions, files, buttons, Mini Apps,
  cards, callbacks, and platform limits.

allowed outputs
  Exact event types and limits the actor can emit during this run.

safety and approval policy
  What can happen immediately and what requires trusted-user approval.

style guard
  Visible chat output must sound like Param before delivery.
```

Different run types get different turn contracts:

- normal chat turn
- ambient wake turn
- memory review turn
- approval turn
- task-agent result turn
- compaction turn
- admin/server-management turn

This keeps behavior strong without making every prompt carry every rule all the
time.

## Visible Output Style Guard

Before a visible chat message is delivered, Param should check whether it still
sounds like Param.

The guard is not a slang limiter. It catches obvious style failures:

- too long for chat
- paragraph-like output
- bullet-list output in normal chat
- final periods everywhere
- corporate or assistant-like phrasing
- `as an ai` wording
- GPT-style closing lines
- forced explanation of what Param is doing
- fake, outdated, or trying-too-hard slang
- mascot, pet, creature, or tiny-helper self-description

If a message fails the guard, the actor or adapter rewrites it before sending.

The guard only applies to visible chat output. Internal summaries, audits,
tool proposals, docs, and admin logs can use normal technical writing.

## Ambient Behavior

The actor chooses whether Param speaks, reacts, acts, or stays quiet.

Param usually replies when:

- someone talks to Param directly
- someone mentions Param
- someone replies to Param
- the conversation naturally leaves space for him
- he is already involved in the topic
- he has relevant memory or context
- he completed background work
- he needs approval or clarification
- he can prevent confusion or wasted effort
- he has a natural social comment

Param usually does not reply when:

- people are clearly talking to each other
- the chat is moving too fast and he has nothing important to add
- a reaction would be enough
- he only has a generic assistant-like response
- someone else already answered well
- replying would crowd the room

In groups, Param should feel like a participant, not a summoned service. Busy
groups use batching and mention/reply priority so Param stays present without
answering every message.

## Scheduled Ambient Turns

Scheduled Ambient Turns are Param's proactive wake system.

Detailed scheduler behavior lives in `docs/SCHEDULER.md`.

They are not direct scheduled messages. A scheduled job should create an
internal event that wakes Param for a specific session. The actor then decides
whether a real friend would naturally do anything.

Flow:

```text
1. Scheduler emits an ambient_wake event for one session.
2. Orchestrator persists the event and resolves session state.
3. Context Builder loads recent messages, summaries, memory, cooldowns, and
   platform capabilities.
4. Actor receives the Ambient Wake turn contract.
5. Actor chooses message, reaction, task spawn, image/meme generation, or
   no_reply.
6. Orchestrator enforces cooldowns, approval, flood guards, and output limits.
7. Visible output passes through the style guard before delivery.
```

The wake is a chance to think, not a command to speak.

Ambient wake event shape:

```text
type: ambient_wake
session_id: stable session id
intent: quiet_chat_wake | check_in | topic_seed | joke_drop | meme_drop |
  follow_up | daily_recap | memory_review | server_health | research_watch |
  unfinished_task_ping
reason: short mechanical reason for the wake
vibe: optional tone hint such as playful, thoughtful, useful, chaotic, quiet
allowed_outputs: output event types allowed for this wake
max_visible_messages: visible message cap for this wake
cooldown_context: recent proactive messages and related limits
created_by: trusted user, config, or system
approval_id: approval that authorized the recurring behavior, if any
```

Ambient Wake turn contract:

```text
You are being woken for this chat.

This is not an instruction to send a message.
Look at the room and decide what a real friend would naturally do.

You may stay quiet, react, send one or more short messages, bring back an old
thread, ask something casual, drop a joke, generate or send a meme, follow up
on something, or spawn a helper agent.

Never mention the scheduler, cron, heartbeat, automation, or wake event.

Sound like Param: concise and witty, lowercase, modern friends in the US
chatting.
```

Scheduled ambient behavior should support:

- waking a quiet group without spamming it
- checking in on a personal DM
- following up on things Param promised
- reviving old threads when it feels natural
- dropping a joke or meme when the chat has that norm
- starting a small discussion
- reporting completed background work
- checking server health or watched research topics

Guardrails:

- trusted-user approval to create recurring proactive behavior for a chat
- active hours per chat
- cooldown per session
- cooldown per intent
- max proactive visible messages per day
- skip or defer if the session is busy
- skip or defer if Param recently spoke
- skip or defer if the main actor run is already active
- flood guard for repeated wakes
- audit log for why Param spoke or stayed quiet

## Reactions

Param can react when a small gesture is more natural than a message.

Reactions are not read receipts. Param should not react to every message it
reads.

Telegram reaction choices must be validated against the chat's available
reaction list when present. That list applies only to `react_to_message`.

It does not restrict emojis typed in normal text messages.

## Dynamic Batching

The orchestrator tracks message velocity per session.

Useful counters:

- messages per second
- messages per minute
- current burst start
- latest message time
- queued event count
- unread events since actor start
- mention or reply bypass flag

Ordinary group chatter can be batched. Mentions, replies to Param, commands,
approval responses, and pending-task signals bypass batching.

The orchestrator uses these signals mechanically. The actor still decides
whether to participate.

## Memory System

Persistent memory is core to Param.

Raw logs store what happened. Memory stores what is worth carrying forward.

Detailed memory behavior lives in `docs/MEMORY.md`.

Memory scopes:

```text
user memory
  facts and preferences about one person

group memory
  norms, decisions, recurring context for one group

session memory
  context useful inside one chat, thread, or topic

project memory
  durable project decisions and architecture notes

agent memory
  things Param learns about its own operation
```

Memory review should inspect conversations and produce structured memory
candidates.

Triggers:

- after an actor run
- after a batch review
- before and after compaction
- when a session quiets down
- on scheduled background review
- when the actor marks something as worth remembering

Memory candidates should include:

- content
- scope
- subject
- source user
- source session
- evidence message ids
- confidence
- sensitivity
- expiration, if any
- reason to remember

Group memory must preserve provenance. If one user makes a claim about another
person, Param must not store it as unquestioned truth.

Example:

```text
Anna claimed in group X that Taras dislikes Postgres.
Source: Anna
Subject: Taras
Confidence: low
Scope: group
```

Before an actor run, memory retrieval should combine:

- scoped lookup by user/group/session/project
- semantic search through pgvector
- keyword search through Postgres full-text search
- recent event context
- provenance and confidence metadata

The actor should see memory as contextual evidence, not unquestionable truth.

Users should be able to inspect, correct, mark important, and forget memories.

## Compaction

Compaction keeps actor context manageable without losing fresh messages.

Compaction should produce:

- concise session summary
- open decisions
- pending tasks
- unresolved questions
- important recent facts
- verbatim anchors for critical wording
- memory handoff notes
- checkpoint id

The deterministic context builder must always preserve a recent raw tail in
addition to summaries.

Compaction is per session, with run-specific checkpoints when a long active run
needs them.

Task-agent results enter compaction as events and may also produce summary
sections if they are large.

## Task Agents

Task agents handle focused work without bloating the main chat context.

Detailed task-agent behavior lives in `docs/TASK_AGENTS.md`.

Task agent types:

- research agents
- coding agents
- image agents
- browser agents
- memory agents
- CLI agents
- server-management agents

Task agents usually report back to the Session Actor, not directly to chat. The
Session Actor decides what should be said publicly.

A task agent receives:

- task goal
- parent session id
- task session id
- allowed tools
- relevant context packet
- memory scope
- budget and timeout
- approval policy

A task agent returns:

- status
- concise result
- artifacts
- cited evidence
- tool trace references
- memory candidates
- follow-up suggestions

## Runtime Adapters

Runtime adapters let Param use different agent engines without rewriting the
session/orchestration system.

Detailed runtime-adapter behavior lives in `docs/RUNTIME_ADAPTERS.md`.

Target adapters:

- Codex
- Antigravity
- OpenCode
- image generation runtime
- browser automation runtime
- custom CLI runtimes

Adapter interface:

- start run
- stream output events
- send live steering when supported
- expose runtime steering capabilities
- request tool execution
- request approval
- receive tool results
- cancel or interrupt
- expose logs and artifacts
- report final run summary

Not every runtime will support live steering natively. Live steering is a
runtime capability, not a universal assumption.

Runtime adapters should report capabilities such as:

```ts
type RuntimeAdapterCapabilities = {
  supportsLiveSteering: boolean;
  supportsCancel: boolean;
  supportsCheckpointRefresh: boolean;
  supportsToolInterception: boolean;
  supportsOutputBuffering: boolean;
  supportsArtifacts: boolean;
  supportsUsage: boolean;
};
```

Fallback behavior:

```text
best
  inject steering into the active run

good
  cancel or pause the run, then restart with updated context

fallback
  let the run finish, buffer its outputs, and run pre-send refresh before
  delivery or side effects
```

Adapters must not stream model text directly to Telegram unless they can enforce
safe checkpoints. Buffered output is the default for runtimes without reliable
live steering.

If a runtime cannot accept live input, the adapter must preserve steering as
durable inbox context and resume or start a follow-up run with that context.

## Runtime Personality Injection

Runtime adapters should inject Param's identity and chat voice through the
configuration surface each runtime actually supports.

This must be treated as adapter behavior, not as a single global prompt string.
Different CLIs expose different control points.

Codex adapter:

- use Codex personalization or custom instructions when available
- use project instructions where appropriate
- assume Codex still has its own base and safety instructions
- route visible chat text through Param's style guard before sending

OpenCode adapter:

- use `AGENTS.md`, `instructions`, and agent `prompt` config when available
- keep tool and approval policies outside personality text
- route visible chat text through Param's style guard before sending

Antigravity adapter:

- use CLI settings, preferences, hooks, plugins, or project instructions where
  the adapter implementation confirms support
- do not assume full prompt replacement
- route visible chat text through Param's style guard before sending

No adapter should rely only on a UI personality dropdown. Dropdowns can help,
but Param needs its own product-level voice contract because runtime defaults
can change.

## Tools And Server Management

Tools are controlled actions available to the actor and task agents.

Detailed tool behavior lives in `docs/TOOLS.md`.

Param does not invent a full plugin ecosystem. It uses MCP for external
tools/connectors, schema-based local tools for internal capabilities, and the
Param Tool Registry as the policy/audit wrapper.

Tool categories:

- read filesystem
- write/edit files
- run shell command
- manage Bun services
- inspect logs
- manage config
- install packages
- generate images
- browse web pages
- call external APIs
- manage artifacts
- restart Param

Param should be able to manage itself and the VPS, but only through Action
Review.

Server self-management must be careful around restart. Before Param restarts
itself, it should persist current state, ensure a service manager will bring it
back, and record the restart reason in audit.

Tool sources:

- local Param tools
- MCP servers
- runtime adapters
- channel adapters
- external API wrappers

Skills can suggest procedures and required tools. They cannot grant tools.

## Action Review And Trusted Users

Action Review decides whether a proposed action can run.

Detailed Action Review policy lives in `docs/ACTION_REVIEW.md`.

Security model:

```text
safe auto-run list
  small set of obviously safe read-only commands/actions

auto-review
  structured reviewer for actions that need risk analysis

manual approval
  trusted user approves exact proposed action

deny
  action is blocked
```

Anyone in a chat can ask Param to do something. Only trusted users can approve
consequential actions.

Param must store requester and approver separately.

Param runs auto command review for action requests in every chat. The review
verifies sender id, trust scope, action target, risk, and policy before deciding
whether to run, ask for approval, or deny.

In group chats, if the requester is not trusted for the action scope,
change-making requests prefer an approval message in the same group/topic when
a trusted approver is present there. The approval message tags trusted users
from the configured trusted users list for that chat/scope who are present in
that conversation.

If no trusted approver is present in the group/topic, Param can request approval
by DM from configured trusted users. The approval still records the source
group/topic, requester, exact action, and approval id.

If the requester is trusted for the action scope, whether in a DM or group, safe
and policy-allowed actions can run after auto review. Destructive, server,
spend, and security actions can still require explicit confirmation.

Trusted approval is required for actions that affect the world, the server, or
private data:

- run shell commands
- edit files
- install packages
- restart services
- change Param config
- call a runtime adapter with write access
- send a message outside the current natural chat reply
- create or modify external accounts, issues, tickets, or docs
- spend money or use paid APIs
- access private data from another session

Normal chat participation does not need approval:

- reply in the current chat
- stay quiet
- react with an available reaction emoji
- read current session context
- run a safe read-only check on the safe auto-run list

Trusted users are configuration, not memory. The actor can read trust state but
cannot silently change it.

Trusted user records should include:

- platform
- platform user id
- display name
- trust scope
- added by
- added at
- status

Trust scopes should support global, per-chat, per-project, and server-admin
approval.

Dangerous server actions can require stronger approval policy than ordinary
write actions.

## UI And Generative Interfaces

Param can produce structured UI beyond plain text.

Detailed UI behavior lives in `docs/UI.md`.

Surfaces:

- text messages
- reactions
- cards
- inline buttons
- action callbacks
- JSON-rendered UI
- Telegram Mini Apps
- generated files/artifacts

The actor should emit structured UI specs, not arbitrary frontend code directly
inside chat output.

The UI Renderer validates specs, maps them to the current platform, and stores
callback metadata durably.

Telegram Mini App pages should use the Vercel AI SDK UI structured
object/generative UI pattern for JSON-rendered UI. Param still owns the schema
and validation layer.

Telegram Mini App pages should use shadcn/ui as the default repository-owned
React component system behind that renderer.

Actors can tune generated UI style through validated shadcn theme-token patches.
Per-surface patches are temporary. Persistent theme or profile changes require
Action Review.

UI callbacks are events. If a callback triggers a consequential action, it goes
through Action Review.

Mini Apps are Telegram-launched pages, not a standalone app and not a
replacement for chat. Use them when inline buttons or plain messages are too
small for the interaction.

## Skills

Skills are reusable procedural knowledge.

Detailed skills behavior lives in `docs/SKILLS.md`.

Param should support:

- skills.sh as the default ecosystem
- local private skills
- metadata-first discovery
- progressive loading of full skill content
- version pinning
- trust review for third-party skills
- per-session skill access policy

Skills can describe procedures and may declare tool needs. They should not
silently add executable power without tool registry and action review approval.

Installing, updating, enabling, disabling, or changing trust for a skill is a
state-changing action.

## Configuration

Param should be easy to configure without losing type safety.

Configuration should use TypeScript config files for typed non-secret settings
and `.env` files for secrets and deployment-specific values.

The target config shape, `.env.example`, and validation rules live in
`docs/CONFIG.md`.

Example shape:

```text
param.config.ts
  committed safe defaults and shared non-secret config

param.config.local.ts
  per-instance non-secret overrides, ignored by git

.env
  stores secrets and machine-specific environment values

.env.example
  documents expected environment variables without real secrets
```

TypeScript config gives:

- autocomplete
- type checking
- comments
- reusable constants
- safer refactors
- environment-specific composition

Runtime validation is still required. TypeScript catches mistakes while editing,
but the running process must validate loaded config before using it.

Use a validation library such as Zod for:

- parsing config files
- validating environment variables
- validating plugin/module config
- validating action/tool input
- validating actor output events
- validating UI specs

Config should be layered in a predictable order:

```text
defaults
  -> param.config.ts
  -> param.config.local.ts
  -> .env and environment variables
  -> trusted admin overrides
```

Secrets should not live directly in normal TypeScript config files.

Use `.env` or secret references for:

- Telegram bot token
- database URL
- optional model/API keys for future API-backed runtimes
- Tailscale/admin tokens
- runtime adapter credentials
- webhook secrets

Telegram access config is separate from trusted approval config:

- `allowedPrivateUserIds` controls who can DM Param.
- `allowedGroupChatIds` controls which groups Param can participate in.
- `allowedTopicIds` optionally limits access to specific Telegram forum topics.
- `trustedUsers` controls who can approve consequential actions.

Allowed group access does not make everyone in that group trusted.

The first install collects one owner Telegram user id. That id becomes the
default allowed DM user and the first trusted owner.

The app should validate required `.env` values at startup and fail loudly when
required secrets are missing or malformed.

`.env.example` should be committed and kept current. It should include every
supported environment variable with safe placeholder values and short comments.

The actor may read safe config values when needed, but it must not silently
change trusted config. Config changes that affect tools, permissions, trusted
users, server behavior, secrets, or memory policy require Action Review.

## Installer

Detailed operations behavior lives in `docs/OPS.md`.
Repository layout and installer script shape live in `docs/PROJECT_STRUCTURE.md`.

Param needs an install flow for fresh or existing Linux, macOS, and Windows
hosts.

The installer should prepare the machine to run Param as an always-online
service.

Installer responsibilities:

- detect host OS, version, architecture, shell, and package manager
- install Bun
- install system packages needed by runtime adapters
- install Git and build tools
- create the Param service user/account or choose the current user deliberately
- create directories for config, data, logs, artifacts, and workspaces
- install app dependencies
- build or prepare the TypeScript app
- collect the owner Telegram user id when missing
- help discover Telegram owner/group ids when needed
- create `param.config.local.ts` with empty documented overrides when missing
- never overwrite an existing `param.config.local.ts`
- create `.env` from `.env.example` when missing
- never overwrite an existing `.env`
- create native service files
- enable service startup on boot
- run health checks
- print next required manual steps

The installer should be idempotent. Running it twice should repair or confirm
the installation, not corrupt it.

The installer should not silently overwrite existing config, secrets, data, or
service files. Risky changes require explicit confirmation.

Native service shape:

```text
param-app
  HTTP/API surface and Chat SDK integration

param-worker
  jobs, actor runs, memory review, compaction, task agents
```

Linux maps those to systemd units, macOS maps them to launchd plists, and
Windows maps them to Windows services. Both Param services should restart after
crashes and start after reboot.

The installer should support a dry-run/check mode that reports what would be
changed.

## Storage

Detailed operations behavior lives in `docs/OPS.md`.

Use local Postgres with pgvector on the VPS by default.

The target Postgres schema is described in `docs/DATABASE.md`.

```text
Primary database:
  local Postgres on the VPS

ORM/query layer:
  Drizzle

Vector search:
  pgvector inside Postgres

Keyword search:
  Postgres full-text search

Queue:
  Postgres-backed jobs

Filesystem:
  task workspaces, repos, artifacts, CLI files, local logs
```

Managed Postgres is still supported through `DATABASE_URL` for deployments that
prefer outsourced database operations.

Supported database modes:

```text
local-postgres
  default VPS install, local Postgres service with pgvector

existing-url
  use any compatible Postgres connection string

managed-neon
  optional cloud provisioning path

managed-supabase
  optional cloud provisioning path
```

Cloud DB provisioning is a spend/security action when Param performs it for
itself, so it requires Action Review.

Postgres domains:

- identity
- sessions
- events
- runs
- jobs
- memory
- tools
- approvals
- audit
- config

Detailed table shapes, indexes, constraints, recovery queries, and Drizzle
layout notes live in `docs/DATABASE.md`.

Large operational files stay on the VPS filesystem. Postgres stores metadata,
paths, hashes, ownership, retention, and audit links.

Derived data can be rebuilt:

- vector indexes
- full-text indexes
- memory retrieval caches
- session summaries
- dashboard aggregates

## Job Queue

Jobs live in Postgres.

Job fields:

- job id
- type
- payload
- status
- priority
- due time
- attempt count
- lock owner
- lock expiration
- last error
- created at
- updated at

Workers poll due jobs and claim them transactionally. If the VPS reboots,
unfinished jobs become claimable again after their lock expires.

Job types:

- actor invocation
- batch review
- memory review
- compaction
- task-agent run
- scheduled check
- retry
- approval timeout

Param should not depend on Temporal or Effect for the core runtime.

The reliability model is implemented with Postgres events, jobs, locks,
checkpoints, idempotency keys, and recovery workers.

Temporal can be reconsidered if Param starts rebuilding a large durable workflow
engine by hand. Effect can be reconsidered if the codebase would clearly benefit
from adopting its TypeScript effect system, schema, streams, and dependency
injection style.

## Hosting And Operations

Detailed operations behavior lives in `docs/OPS.md`.

Default package choices live in `docs/DEPENDENCIES.md`.

Runtime:

```text
Bun
TypeScript
Hono HTTP surface
Hetzner CX23 VPS
Native services
```

Use system services so Param starts on boot and restarts after crashes.

Host installers create and enable those native services.

The HTTP surface exists for health checks, external webhooks, callbacks, Mini
Apps, and optional internal operator endpoints. Telegram polling does not
require a public HTTP route.

Tailscale is for private admin access and internal tools.

Public HTTPS/reverse proxy is only needed for public surfaces such as:

- Telegram webhook mode
- Telegram Mini Apps
- OAuth callbacks
- external webhooks
- public artifact links
- public operator endpoints, if ever allowed

Operator surfaces should prefer Tailscale/private access.

## Security Boundaries

Detailed security behavior lives in `docs/SECURITY.md`.

Security must be designed as part of the architecture.

Boundaries:

- prompt injection cannot change trust policy
- tool outputs are untrusted context
- memory candidates are reviewed and scoped
- group claims keep provenance
- secrets are never exposed to actors as plain memory
- trusted user config is not editable by ordinary actor output
- risky actions require exact proposal approval
- audit records are append-only
- emergency shutdown is available to trusted users

Task isolation initially relies on:

- per-task workspaces
- filesystem path policies
- process user permissions
- action review
- environment scoping
- timeout and budget limits
- audit logs

## Observability

Detailed observability behavior lives in `docs/OBSERVABILITY.md`.

Ambient agents need inspectability.

Store enough information to explain:

- why Param replied
- why Param stayed quiet
- why Param reacted
- why a tool ran
- who approved an action
- what memory was created
- which context packet the actor saw
- which runtime adapter produced an output
- what happened before a crash or reboot

Observability data:

- event log
- actor traces
- tool traces
- task-agent logs
- action review audit
- memory audit
- job status
- run status
- health checks
- metrics

Trusted debug output should explain chat behavior and pending actions.
Operator-only logs can include operational details, redacted traces, and server
state.

## Tests And Evals

Detailed testing and eval behavior lives in `docs/EVALS.md`.

Param needs deterministic tests for machinery and scenario evals for behavior.

Deterministic tests cover routing, schema validation, config, storage, queues,
memory retrieval, Action Review, UI callbacks, scheduler recovery, and channel
delivery.

Scenario evals cover judgment:

- when to reply
- when to stay quiet
- when to react
- whether the voice feels like Param
- whether relevant memory was used
- whether live steering changed the answer
- whether trusted approval was requested
- whether proactive wakes felt natural

Model graders can help with fuzzy social behavior, but safety and policy gates
must have deterministic assertions.

## Core Invariants

These rules should stay true across implementations:

- The orchestrator is deterministic code, not an LLM.
- The actor decides meaning and social behavior.
- Visible chat output follows Param's voice contract.
- Style guard rewrites visible output that sounds like a generic assistant.
- Every important event is durable before being acted on.
- One session has at most one active main actor run.
- New same-session messages during a run become live steering.
- The actor can emit multiple outputs during one run.
- Task agents normally report to the Session Actor.
- Memory is scoped and provenance-aware.
- UI is generated as validated specs, not arbitrary actor code.
- Reaction emojis are validated per chat and only constrain reactions.
- Consequential actions require Action Review.
- Trusted users approve actions; requesters and approvers are stored separately.
- Tests and evals are versioned with the repo.
- Telegram uses polling by default on the VPS.
- Tailscale is private admin access, not the public chat transport.
- Modules communicate through contracts, not hidden coupling.
