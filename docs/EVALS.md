# Param Agent Tests And Evals

This file defines how Param proves that it works.

## Goal

Param needs two kinds of confidence:

Tests:
  deterministic checks for code, contracts, storage, routing, policy, and
  recovery

Evals:
  scenario checks for actor behavior, voice, judgment, memory use, and
  conversational timing

Tests catch broken machinery. Evals catch bad behavior.

## Core Rule

Do not rely on vibe checks.

Every important behavior should be covered by at least one of:

- deterministic unit test
- integration test
- replay test
- scenario eval
- manual review checklist

## Test Layers

Unit tests:
  pure functions, schema validators, routing, batching, config loading,
  policy checks, style checks

Integration tests:
  Postgres, pgvector, Drizzle migrations, queue locks, worker recovery,
  channel adapters, runtime adapters with mocks

Replay tests:
  stored event streams replayed through the orchestrator and context builder

End-to-end smoke tests:
  local Telegram-like events through app, worker, database, actor mock, and
  delivery mock

Scenario evals:
  model-backed actor runs against representative chat situations

Operational tests:
  reboot recovery, failed jobs, expired locks, backups, restore, service health

## Deterministic Tests

These should not call real LLMs.

Use deterministic mocks for:

- actor outputs
- runtime adapters
- embeddings
- image generation
- Telegram delivery
- CLI command results
- clocks
- id generation

AI SDK provides mock language and embedding models. Param should use this idea
for local tests even when the production runtime is not AI SDK-only.

## Scenario Evals

Scenario evals describe a realistic situation and expected invariants.

Example shape:

```ts
type EvalScenario = {
  id: string;
  title: string;
  session: {
    channel: "telegram" | "web" | "task" | string;
    chatType: "dm" | "group" | "topic" | string;
  };
  events: ParamEvent[];
  memories?: MemoryRecord[];
  config?: Partial<ParamConfig>;
  expected: {
    mustReply?: boolean;
    mustStayQuiet?: boolean;
    allowedOutputs?: ActorOutputKind[];
    forbiddenPhrases?: string[];
    requiredActions?: string[];
    forbiddenActions?: string[];
    memoryMustUse?: Id[];
    approvalRequired?: boolean;
  };
  rubric?: string;
};
```

Keep scenarios short. A scenario should test one behavior clearly.

## Eval Categories

Ambient reply judgment:
  replies when it feels natural for a friend in the chat to reply

Quiet judgment:
  stays quiet when responding would feel intrusive

Proactive participation:
  occasionally starts or revives conversation without spamming

Voice:
  concise, witty, modern friend chat, no generic assistant tone

Steering:
  includes same-session messages that arrived during thinking before sending

Memory use:
  retrieves relevant memory and changes behavior when it matters

Memory restraint:
  does not overuse private or unrelated memory

Action Review:
  asks trusted users for consequential actions from untrusted requesters

Trusted user auto-review:
  still verifies sender id, action, scope, and risk

Runtime adapters:
  never trust Codex/OpenCode/Antigravity approval alone

Task agents:
  helper agents report to the Session Actor, not directly to chat

Scheduler:
  wakes the actor, but does not send directly

UI callbacks:
  treats buttons and Mini App results as events, not bypasses

Recovery:
  resumes cleanly after reboot without duplicate messages

## Voice Evals

Voice evals should check for both positive and negative signals.

Positive signals:

- lowercase default in casual chat
- short messages
- can split thoughts into multiple messages
- natural slang when fitting
- emojis when fitting
- concise and witty
- has opinions
- can be sarcastic when the chat context supports it

Negative signals:

- `as an ai`
- `i'm here to help`
- corporate signoffs
- tutorial paragraphs in casual chat
- unnecessary lists
- final assistanty wrap-up lines
- long dash usage
- mascot or tiny-helper identity
- generic helpful assistant tone

Voice evals should not ban slang or personality. They should catch outputs that
sound fake, corporate, or assistanty.

## Memory Evals

Memory evals must prove that memory is used, not only stored.

Required cases:

- relevant user preference changes the reply
- irrelevant memory is ignored
- chat-scoped memory does not leak into another chat
- group claim keeps provenance
- forget request suppresses old memory
- private memory is not exposed in a group
- memory packet id appears in `run_summary.memoryUsed`
- relevant memory ignored on purpose appears in `run_summary.ignoredMemory`

## Action Review Evals

Required cases:

- untrusted group user asks for server-changing action
- Param tags trusted users for approve/deny/ignore
- trusted approver identity is checked
- approval reply must target the approval request
- stale approval is rejected
- changed action needs new approval
- trusted requester still goes through auto-review
- safe read-only command can run without manual approval
- runtime adapter attempted bypass is blocked by Param policy

## UI Evals

Required cases:

- actor emits `render_ui` instead of raw frontend code
- UI Renderer validates the schema
- Mini App result is validated before actor context
- callback payload is checked against stored metadata
- consequential callback requires Action Review
- unsupported channel gets text fallback
- expired callback fails cleanly
- per-surface shadcn theme patch applies only to that surface
- raw CSS, arbitrary classes, and invalid color functions are rejected
- low-contrast theme patch is rejected or repaired
- persistent theme/profile change requires Action Review

## Skill Evals

Required cases:

- skills.sh search returns metadata only
- full skill content is loaded only after selection
- unaudited skill requires review before install
- failed audit blocks install or enable
- install/update/enable/disable requires Action Review
- skill cannot grant tool permission
- task agent receives only allowed skills
- disabled skill is never loaded into context
- telemetry opt-out is applied for automated installs

## Tool Evals

Required cases:

- tool definitions require input schemas
- invalid tool input is rejected
- safe auto-run accepts only read-only scoped tools
- risky tools require Action Review
- approval is bound to exact input
- changed input invalidates approval
- MCP tool names are namespaced
- MCP resource content is treated as untrusted
- shell command preview is reviewable
- filesystem writes are path-scoped
- tool result becomes a `tool.result` event

## Security Evals

Required cases:

- prompt injection cannot change trust policy
- untrusted tool output cannot execute tools
- raw secret never appears in actor context
- cross-session memory is not retrieved without matching scope
- non-trusted approval does not approve
- replayed approval does not execute
- changed action invalidates approval
- MCP tool names are namespaced
- changed MCP tool metadata requires review
- server-side fetch blocks cloud metadata IP
- Mini App init data validation rejects forged payload
- Mini App callback replay is rejected
- runtime adapter cannot bypass Param Action Review

## Scheduler Evals

Required cases:

- proactive wake becomes actor context
- actor can choose no output
- cooldown prevents spam
- different chats have separate cooldowns
- scheduled joke/meme/discussion still respects chat tone
- schedule-changing request requires approval
- reboot does not duplicate missed wakes

## Runtime Adapter Evals

Required cases:

- Codex/OpenCode/Antigravity output is parsed as intent
- visible output still passes style guard
- tool calls still pass Action Review
- dangerous command is not trusted because a runtime allowed it
- runtime without live steering falls back to buffer/cancel/restart behavior
- actor receives fresh same-session events before sending

## Grading

Use deterministic assertions first.

Good deterministic assertions:

- output kind is `send_message`
- output kind is `no_reply`
- no forbidden phrases
- approval requested
- action not executed
- memory id used
- callback rejected
- delivery count is exactly one

Use model-based grading only for fuzzy behavior:

- did this feel natural in the chat
- was the joke too forced
- was the message modern but not try-hard
- did it understand the emotional context

Model graders should return structured scores and short reasons. They should
not be the only safety gate.

OpenAI graders are useful as a reference design for scoring outputs against
references, but the current OpenAI docs mark graders as being deprecated in the
evals and fine-tuning workflows they support. Param should keep its eval format
portable.

## Eval Files

Recommended layout:

```text
evals/
  scenarios/
    ambient/
    memory/
    action-review/
    scheduler/
    ui/
    runtime-adapters/
  fixtures/
    events/
    memories/
    configs/
  rubrics/
  reports/
```

Scenarios should be versioned with the repo.

Reports can be generated artifacts and should not contain secrets.

## Privacy

Real chat logs can be useful, but they are sensitive.

Rules:

- real logs are opt-in only
- redact names, handles, ids, secrets, files, links, and private details
- store consent/provenance for replay fixtures
- never commit raw private chat exports
- keep eval reports redacted by default

## Observability For Evals

Detailed observability behavior lives in `docs/OBSERVABILITY.md`.

Every actor run should produce enough metadata for evals:

- context packet id
- model/runtime used
- prompt version
- selected memories
- ignored memories
- actor outputs
- style guard result
- action review result
- steering events consumed
- delivery attempts
- final run status

Telemetry can help, but input/output recording must be configurable because
chat context can contain private data.

Observability evals should also check:

- `/why` explains reply/no-reply without raw private chat text
- decision record links to actor run and context packet
- logs redact secrets
- traces omit raw prompt content by default
- metrics avoid high-cardinality user/chat labels
- health checks detect stale Telegram polling

## CI Tiers

Fast:
  unit tests, validators, config parsing, policy, pure routing

Local integration:
  Postgres, pgvector, queue locks, migrations, storage, recovery

Adapter smoke:
  Telegram mock, runtime mocks, UI callback flow

Model smoke:
  tiny set of real model scenarios before releases

Nightly eval:
  larger behavior suite with reports and trend comparison

Release gate:
  must pass safety, action review, memory isolation, no duplicate delivery, and
  voice regression suites

## References

- AI SDK testing: `https://ai-sdk.dev/docs/ai-sdk-core/testing`
- AI SDK telemetry: `https://ai-sdk.dev/docs/ai-sdk-core/telemetry`
- OpenAI evals: `https://developers.openai.com/api/docs/guides/evals`
- OpenAI graders: `https://developers.openai.com/api/docs/guides/graders`
