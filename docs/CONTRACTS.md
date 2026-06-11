# Param Agent Contracts

This file defines the first stable contracts for Param.

`BUILD_SPEC.md` explains the architecture. This file defines the shapes that
modules exchange.

These contracts should become TypeScript types and Zod schemas during
implementation.

## Shared Rules

- Use structured objects, not ad hoc text blobs.
- Store every important event before acting on it.
- Actor outputs are structured intents, not direct side effects.
- Delivery results are stored separately from actor intent.
- Use schema versions from the beginning.
- Treat raw platform payloads as evidence, not as the main API between modules.
- Keep platform-specific fields inside adapter payloads or raw references.
- Use stable session ids and deterministic session keys.
- Use stable idempotency keys for external updates, scheduled wakes, tool calls,
  approvals, and deliveries.

Recommended primitives:

```ts
type Id = string;
type IsoDateTime = string;
type JsonObject = Record<string, unknown>;

type SessionId = Id;
type EventId = Id;
type RunId = Id;
type JobId = Id;
type ApprovalId = Id;
type OutputId = Id;
```

Ids should be time-sortable where possible, such as UUIDv7 or ULID.

Timestamps should be ISO 8601 UTC strings.

## Steering Inbox

Steering inbox items represent same-session activity that arrives while a main
actor run is already active.

```ts
type SteeringPriority = "soft" | "strong" | "hard_control";

type SteeringInboxItem = {
  inboxItemId: Id;
  actorRunId: RunId;
  sessionId: SessionId;
  eventId: EventId;
  priority: SteeringPriority;
  tags: (
    | "message"
    | "mention"
    | "reply_to_param"
    | "approval_response"
    | "command"
    | "trusted_sender"
    | "targets_active_run"
    | "targets_pending_action"
    | "chat_velocity_high"
    | string
  )[];
  reason: string;
  createdAt: IsoDateTime;
  consumedAt?: IsoDateTime;
};
```

The priority is deterministic routing metadata. The actor still decides what
the message means.

Before visible output or side effects, validators should compare the actor
run's last checkpoint with newer inbox items and require refresh when strong
steering or hard controls exist.

## Actor Refs

An actor ref identifies who or what caused an event.

```ts
type ActorRef =
  | {
      kind: "user";
      platform: "telegram" | string;
      platformUserId: string;
      paramUserId?: string;
      displayName?: string;
      username?: string;
      isBot?: boolean;
    }
  | {
      kind: "param";
      runtime?: "codex" | "opencode" | "antigravity" | "native" | string;
    }
  | {
      kind: "task_agent";
      taskSessionId: SessionId;
      taskRunId?: RunId;
      agentType: string;
    }
  | {
      kind: "tool";
      toolName: string;
    }
  | {
      kind: "scheduler";
      scheduleId?: Id;
    }
  | {
      kind: "admin";
      paramUserId?: string;
      platformUserId?: string;
    }
  | {
      kind: "system";
      component: string;
    };
```

## Platform Refs

Platform refs preserve routing facts without forcing the core to understand
Telegram internals.

Detailed channel behavior lives in `docs/CHANNELS.md`.

Telegram-specific behavior lives in `docs/channels/TELEGRAM.md`.

```ts
type PlatformRef = {
  platform: "telegram" | string;
  accountId?: string;
  chatId?: string;
  chatType?: "private" | "group" | "supergroup" | "channel" | string;
  messageThreadId?: string;
  channelId?: string;
  threadId?: string;
};
```

## Raw Payload Refs

Raw payloads are useful for audit, debugging, adapter gaps, and replay.

```ts
type RawPayloadRef = {
  provider: "chat_sdk" | "telegram" | "runtime" | "tool" | string;
  kind: string;
  storage: "inline" | "object_store" | "file" | "database";
  ref?: string;
  json?: JsonObject;
  hash?: string;
};
```

Inline raw JSON is acceptable early. Large payloads should move to durable
blob/file storage with a hash.

## Internal Event Envelope

Every stored event uses the same envelope.

```ts
type ParamEvent<TPayload = JsonObject> = {
  schemaVersion: 1;
  eventId: EventId;
  type: ParamEventType;
  sessionId: SessionId;
  direction: "inbound" | "outbound" | "internal";
  visibility: "chat_visible" | "internal" | "admin";

  occurredAt: IsoDateTime;
  receivedAt?: IsoDateTime;
  persistedAt: IsoDateTime;

  source: ActorRef;
  platform?: PlatformRef;

  dedupeKey: string;
  correlationId?: Id;
  parentEventId?: EventId;
  rootEventId?: EventId;
  actorRunId?: RunId;
  jobId?: JobId;
  approvalId?: ApprovalId;

  payload: TPayload;
  raw?: RawPayloadRef;
};
```

### Event Type Names

Use dotted names for event types.

```ts
type ParamEventType =
  | "chat.message.received"
  | "chat.message.edited"
  | "chat.message.deleted"
  | "chat.reaction.changed"
  | "chat.action.callback"
  | "chat.mini_app.result"
  | "approval.response"
  | "ambient.wake"
  | "task.result"
  | "runtime.event"
  | "tool.result"
  | "delivery.succeeded"
  | "delivery.failed"
  | "system.recovery"
  | "admin.command";
```

The list can grow, but existing event types should not silently change meaning.

## Chat Message Received

Incoming chat messages become `chat.message.received`.

Detailed channel behavior lives in `docs/CHANNELS.md`.

```ts
type ChatMessageReceivedPayload = {
  platformMessageId: string;
  text?: string;
  textEntities?: TextEntity[];
  attachments?: AttachmentRef[];
  replyTo?: ReplyTarget;
  mentions?: MentionRef[];

  mechanical: {
    mentionsParam: boolean;
    repliesToParam: boolean;
    isDirectMessage: boolean;
    isGroupMessage: boolean;
    isTopicMessage: boolean;
    hasCommandLikeText: boolean;
  };
};
```

The orchestrator may fill `mechanical` from platform facts. It must not infer
social meaning there.

Example dedupe key:

```text
telegram:update:<bot-account-id>:<update-id>
```

## Chat Message Edited

Message edits become `chat.message.edited`.

```ts
type ChatMessageEditedPayload = {
  platformMessageId: string;
  originalEventId?: EventId;
  text?: string;
  textEntities?: TextEntity[];
  attachments?: AttachmentRef[];
  editedAt?: IsoDateTime;
};
```

If the original event is known, link it. Do not rewrite the old event.

## Chat Message Deleted

Delete notifications become `chat.message.deleted` when the platform exposes
them.

```ts
type ChatMessageDeletedPayload = {
  platformMessageId: string;
  originalEventId?: EventId;
  deletedAt?: IsoDateTime;
};
```

Deletion does not erase audit history unless a future privacy policy explicitly
requires redaction.

## Chat Reaction Changed

Reactions become `chat.reaction.changed`.

```ts
type ChatReactionChangedPayload = {
  targetPlatformMessageId: string;
  targetEventId?: EventId;
  oldReactions?: ReactionRef[];
  newReactions: ReactionRef[];
  changedBy?: ActorRef;
};
```

Telegram available reaction limits constrain only actor `react_to_message`
outputs, not text-message emojis.

## Chat Action Callback

Button presses, menu actions, and callback data become `chat.action.callback`.

```ts
type ChatActionCallbackPayload = {
  callbackId: string;
  surfaceId?: Id;
  actionId: string;
  value?: JsonObject;
  platformMessageId?: string;
};
```

Callbacks are events. If a callback requests a consequential action, it enters
Action Review.

## Mini App Result

Telegram Mini App or generated UI results become `chat.mini_app.result`.

```ts
type MiniAppResultPayload = {
  surfaceId: Id;
  interactionId: Id;
  result: JsonObject;
};
```

The UI Renderer validates `result` before the actor sees it.

## Approval Response

Trusted-user approvals or rejections become `approval.response`.

```ts
type ApprovalResponsePayload = {
  approvalId: ApprovalId;
  decision: "approved" | "rejected" | "expired" | "revoked";
  approver: ActorRef;
  decisionText?: string;
  decidedAt: IsoDateTime;
};
```

Requester and approver are separate. A requester does not become trusted by
asking for something.

## Ambient Wake

Scheduled proactive wakes become `ambient.wake`.

Detailed scheduler behavior lives in `docs/SCHEDULER.md`.

```ts
type AmbientWakePayload = {
  intent:
    | "quiet_chat_wake"
    | "check_in"
    | "topic_seed"
    | "joke_drop"
    | "meme_drop"
    | "follow_up"
    | "daily_recap"
    | "memory_review"
    | "server_health"
    | "research_watch"
    | "unfinished_task_ping";

  reason: string;
  vibe?: "playful" | "thoughtful" | "useful" | "chaotic" | "quiet" | string;
  allowedOutputs: ActorOutputType[];
  maxVisibleMessages?: number;

  cooldownContext: {
    lastProactiveAt?: IsoDateTime;
    proactiveMessagesToday: number;
    lastParamMessageAt?: IsoDateTime;
    sessionBusy: boolean;
  };

  createdBy: ActorRef;
  scheduleId?: Id;
  approvalId?: ApprovalId;
};
```

An ambient wake is not an instruction to message the chat. It is an instruction
to evaluate the room.

## Task Result

Task agents report back with `task.result`.

Detailed task-agent behavior lives in `docs/TASK_AGENTS.md`.

```ts
type TaskResultPayload = {
  taskSessionId: SessionId;
  taskRunId: RunId;
  status: "completed" | "failed" | "cancelled" | "waiting_approval";
  title?: string;
  summary: string;
  artifacts?: ArtifactRef[];
  evidenceEventIds?: EventId[];
  toolTraceRefs?: Id[];
  memoryCandidates?: MemoryCandidatePayload[];
  proposedActions?: JsonObject[];
  followUpSuggestions?: string[];
  error?: {
    code: string;
    message: string;
  };
};
```

Task results normally go to the Session Actor. The task agent should not speak
directly in chat unless a future policy explicitly allows it.

## Runtime Event

Runtime adapters can stream `runtime.event` records for traceability.

Detailed runtime-adapter behavior lives in `docs/RUNTIME_ADAPTERS.md`.

```ts
type RuntimeEventPayload = {
  runtime: "codex" | "opencode" | "antigravity" | string;
  runtimeRunId?: string;
  kind:
    | "started"
    | "stdout"
    | "stderr"
    | "tool_request"
    | "tool_result"
    | "artifact"
    | "checkpoint"
    | "output_buffered"
    | "steering_ack"
    | "cancel_requested"
    | "cancelled"
    | "usage"
    | "completed"
    | "failed";
  text?: string;
  data?: JsonObject;
  artifact?: ArtifactRef;
};
```

Visible chat text from runtimes still goes through actor output validation and
style guard before delivery.

Runtime adapters should report steering and interruption capabilities.

```ts
type RuntimeAdapterCapabilities = {
  runtime: "codex" | "opencode" | "antigravity" | string;
  supportsLiveSteering: boolean;
  supportsCancel: boolean;
  supportsCheckpointRefresh: boolean;
  supportsToolInterception: boolean;
  supportsOutputBuffering: boolean;
  supportsArtifacts: boolean;
  supportsUsage: boolean;
};
```

The core must work even when `supportsLiveSteering` is false by buffering output
and refreshing before delivery or side effects.

Runtime run requests are structured.

```ts
type RuntimeAdapterRunRequest = {
  schemaVersion: 1;
  runtime: "codex" | "opencode" | "antigravity" | "image" | "browser" | string;
  runKind: "actor" | "task" | "memory_review" | "compaction" | "admin";
  actorRunId?: RunId;
  taskRunId?: RunId;
  sessionId: SessionId;
  parentSessionId?: SessionId;
  promptPacketRef?: string;
  taskContextRef?: string;
  workspace: {
    root: string;
    runDir: string;
    mode: "read_only" | "scoped_write" | "full_workspace";
    cleanupAfterDays?: number;
  };
  environment: {
    variables: Record<string, string>;
    secretRefs: string[];
    inheritProcessEnv: false;
  };
  allowedTools: string[];
  approvalPolicyRef: string;
  budget: {
    timeoutSeconds?: number;
    maxTokens?: number;
    maxCostUsd?: number;
    maxToolCalls?: number;
  };
  outputMode: "buffered" | "checkpointed_stream";
  idempotencyKey: string;
};
```

## Tool Result

Tool execution results become `tool.result`.

```ts
type ToolResultPayload = {
  toolCallId: Id;
  toolName: string;
  status: "succeeded" | "failed" | "cancelled" | "blocked";
  output?: JsonObject;
  textPreview?: string;
  error?: {
    code: string;
    message: string;
  };
};
```

Tool outputs are untrusted context.

## Delivery Events

Delivery events record what happened after a validated actor output reached the
adapter.

```ts
type DeliverySucceededPayload = {
  outputId: OutputId;
  platformMessageId?: string;
  deliveredAt: IsoDateTime;
  adapter: string;
};

type DeliveryFailedPayload = {
  outputId: OutputId;
  failedAt: IsoDateTime;
  adapter: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
```

Do not mark an actor output as delivered until the adapter confirms it.

## Shared Content Types

```ts
type TextEntity = {
  type: "mention" | "url" | "hashtag" | "bot_command" | "code" | string;
  offset: number;
  length: number;
  value?: string;
};

type MentionRef = {
  platformUserId?: string;
  username?: string;
  text: string;
  isParam: boolean;
};

type ReplyTarget = {
  platformMessageId?: string;
  eventId?: EventId;
  sender?: ActorRef;
};

type AttachmentRef = {
  attachmentId: Id;
  kind: "image" | "video" | "audio" | "voice" | "document" | "sticker" | string;
  platformFileId?: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  storageRef?: string;
  caption?: string;
};

type ReactionRef = {
  kind: "emoji" | "custom" | string;
  emoji?: string;
  customEmojiId?: string;
};

type ArtifactRef = {
  artifactId: Id;
  kind: "file" | "image" | "report" | "workspace" | "log" | string;
  title?: string;
  path?: string;
  url?: string;
  hash?: string;
};
```

## Actor Output Envelope

Every Session Actor output uses this envelope.

```ts
type ActorOutput<TPayload = JsonObject> = {
  schemaVersion: 1;
  outputId: OutputId;
  type: ActorOutputType;
  sessionId: SessionId;
  actorRunId: RunId;
  sequence: number;
  createdAt: IsoDateTime;

  causedByEventIds: EventId[];
  idempotencyKey: string;

  payload: TPayload;
};
```

The actor may emit multiple outputs in one run. `sequence` preserves order.

```ts
type ActorOutputType =
  | "message"
  | "react_to_message"
  | "no_reply"
  | "tool_call"
  | "spawn_task_agent"
  | "approval_request"
  | "memory_candidate"
  | "render_ui"
  | "run_summary"
  | "done";
```

## Message Output

`message` sends one chat bubble to the current session.

```ts
type MessageOutputPayload = {
  text: string;
  replyToEventId?: EventId;
  attachments?: AttachmentRef[];
  parseMode: "plain";
  style: "param_chat";
  visible: true;
};
```

Rules:

- One `message` output is one visible bubble.
- Multiple visible bubbles require multiple `message` outputs.
- The default target is the current session.
- Sending outside the current natural chat context requires Action Review.
- Text must pass the visible output style guard.
- Markdown should not be used for ordinary chat voice.

## React To Message Output

`react_to_message` adds one reaction to one message.

```ts
type ReactToMessageOutputPayload = {
  targetEventId: EventId;
  emoji: string;
  reason?: string;
};
```

Rules:

- The target event must belong to the current session.
- Telegram reaction must be validated against available reactions when present.
- Reaction limits do not restrict emojis in normal message text.
- Reactions should not be used as read receipts.

## No Reply Output

`no_reply` is an explicit decision to stay quiet.

```ts
type NoReplyOutputPayload = {
  reason:
    | "nothing_to_add"
    | "chat_busy"
    | "not_my_moment"
    | "reaction_would_be_too_much"
    | "waiting_for_more_context"
    | "cooldown"
    | "blocked_by_policy"
    | "other";
  note?: string;
};
```

`no_reply` is important for observability. Staying quiet is a real behavior,
not a missing response.

## Tool Call Output

`tool_call` proposes or invokes a controlled tool action.

```ts
type ToolCallOutputPayload = {
  toolCallId: Id;
  toolName: string;
  input: JsonObject;
  reason: string;
  riskHint?: "safe_read" | "write" | "server" | "external_send" | "private_data";
  approvalPreference?: "auto_if_safe" | "review" | "manual";
};
```

Rules:

- The Tool Registry validates tool name and input.
- Action Review decides whether the call can run.
- The actor's risk hint is advisory only.
- Consequential tool calls require exact approval before execution.

## Spawn Task Agent Output

`spawn_task_agent` asks the Task Agent Manager to start focused helper work.

Detailed task-agent behavior lives in `docs/TASK_AGENTS.md`.

```ts
type SpawnTaskAgentOutputPayload = {
  taskType:
    | "research"
    | "coding"
    | "image"
    | "browser"
    | "memory"
    | "cli"
    | "server"
    | string;
  goal: string;
  preferredRuntime?: "codex" | "opencode" | "antigravity" | "image" | "browser" | string;
  contextEventIds?: EventId[];
  memoryScope?: string[];
  allowedTools?: string[];
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    timeoutSeconds?: number;
    maxToolCalls?: number;
  };
  approvalPreference?: "auto_if_safe" | "review" | "manual";
  reportTo: "session_actor";
};
```

Task agents normally report back with `task.result`.

## Approval Request Output

`approval_request` asks trusted users to approve an exact proposed action.

```ts
type ApprovalRequestOutputPayload = {
  approvalId: ApprovalId;
  actionKind:
    | "tool_call"
    | "send_external_message"
    | "config_change"
    | "server_action"
    | "schedule_create"
    | "schedule_update"
    | "memory_sensitive"
    | string;

  requesterEventIds: EventId[];
  requestedBy?: ActorRef;

  title: string;
  summary: string;
  exactPreview: string;
  proposedAction: JsonObject;

  requiredTrustScope:
    | "global"
    | "chat"
    | "project"
    | "server_admin"
    | string;

  expiresAt?: IsoDateTime;
};
```

Rules:

- Approval is for the exact proposed action.
- If the proposed action changes, request a new approval.
- Store requester and approver separately.
- Consequential actions from any chat require trusted-user approval.
- Detailed approval behavior lives in `docs/ACTION_REVIEW.md`.

## Memory Candidate Output

`memory_candidate` proposes memory for review.

```ts
type MemoryCandidatePayload = {
  candidateId: Id;
  operation: "create" | "update" | "forget";
  scope: "user" | "group" | "session" | "project" | "agent";
  subjectRef?: {
    paramUserId?: string;
    sessionId?: SessionId;
    projectId?: string;
  };
  text: string;
  confidence: number;
  sensitivity: "low" | "medium" | "high";
  sourceEventIds: EventId[];
  provenanceNote: string;
};
```

Memory candidates are not automatically trusted facts. The memory system
reviews, scopes, merges, or rejects them.

Detailed memory behavior lives in `docs/MEMORY.md`.

## Render UI Output

`render_ui` asks the UI Renderer to create a structured surface.

Detailed UI behavior lives in `docs/UI.md`.

```ts
type RenderUiOutputPayload = {
  surfaceId: Id;
  target: "current_session" | "mini_app";
  specVersion: 1;
  schema: "param.card" | "param.form" | "param.mini_app" | string;
  spec: JsonObject;
  theme?: UiThemePatch;
  callbacks?: {
    actionId: string;
    label: string;
    value?: JsonObject;
    requiresApproval?: boolean;
  }[];
};
```

The UI Renderer validates specs and maps them to platform features.

`theme` can tune approved shadcn CSS variable tokens for the surface. Persistent
theme/profile changes are state-changing actions and go through Action Review.

## UI Theme Patch

Detailed theme behavior lives in `docs/UI.md`.

```ts
type UiThemePatch = {
  system: "shadcn-css-variables";
  scope: "surface" | "session" | "profile" | "global";
  mode?: "light" | "dark" | "auto";
  tokens?: Record<string, string>;
  radius?: string;
  reason?: string;
};
```

Only approved semantic tokens are accepted. The renderer can apply `surface`
and `session` scopes directly after validation. `profile` and `global` scopes
must become reviewed state-changing actions.

## Run Summary Output

`run_summary` records what happened in the actor run.

```ts
type RunSummaryOutputPayload = {
  summary: string;
  decisions: string[];
  openLoops?: string[];
  memoryHints?: string[];
  memoryUsed?: Id[];
  ignoredMemory?: {
    id: Id;
    reason: string;
  }[];
  consumedSteeringEventIds?: EventId[];
  preSendRefreshEventIds?: EventId[];
  nextSuggestedWakeAt?: IsoDateTime;
};
```

This is internal. It is for compaction, observability, and recovery.

## Done Output

`done` closes the actor run.

```ts
type DoneOutputPayload = {
  status: "completed" | "waiting_approval" | "blocked" | "cancelled" | "failed";
  reason?: string;
};
```

Every actor run should end with `done`, even when it stayed quiet.

## Validation Pipeline

Actor outputs pass through this pipeline:

```text
1. Validate JSON shape with Zod.
2. Validate output type is allowed for the current turn contract.
3. Validate session and event references.
4. Run style guard for visible messages.
5. Run Tool Registry validation for tool calls.
6. Run Action Review for consequential actions.
7. Persist accepted output.
8. Deliver through Channel Adapter or enqueue tool/task/UI work.
9. Persist delivery, tool, task, or approval result events.
```

If validation fails, persist an internal failure event and either ask the actor
to repair the output or end the run safely.

## Idempotency

Every external or side-effecting path needs a stable key:

- Telegram update: platform account plus update id.
- Incoming message: platform account plus chat id plus message id.
- Ambient wake: schedule id plus planned fire time plus session id.
- Actor output: actor run id plus sequence.
- Tool call: actor run id plus tool call id.
- Delivery: output id plus adapter target.
- Approval response: approval id plus approver plus decision id.

Duplicate inputs should not create duplicate visible messages, duplicate tool
calls, or duplicate approvals.

## Contract Ownership

Ownership boundaries:

- Channel Adapter owns mapping platform payloads into `ParamEvent`.
- Orchestrator owns session resolution, persistence, batching, and job creation.
- Context Builder owns selecting events, summaries, memory, and policies.
- Session Actor owns `ActorOutput` intent.
- Validators own schema, policy, style, and permission checks.
- Channel Adapter owns final platform delivery.
- Event Store owns durable history.
