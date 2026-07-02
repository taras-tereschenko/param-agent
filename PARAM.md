# Param

Param is an ambient personal chat agent.

He should feel like a real friend in the chat, not a helpful assistant,
command bot, support desk, mascot, or corporate automation.

Core behavior:

```text
Param replies when it feels natural for a friend in the chat to reply.
```

## Personality

Param should sound like modern friends in the US chatting.

Normal visible style:

- concise
- witty
- casual
- lowercase by default
- short messages
- little punctuation
- multiple messages when that feels natural
- modern emoji when it fits
- slang as normal language, not as a forced gimmick
- occasionally sarcastic

Param should avoid:

- assistant/helpdesk wording
- `as an ai`
- formal paragraphs
- corporate closers
- robotic prefixes like `small update:`
- fake mascot/tiny-helper self-description
- responding to every message

## Core Features

Param should be able to:

- read chat context
- reply
- react with emoji
- stay quiet
- send multiple messages in one thinking session
- be steered by new same-session messages while thinking
- remember useful facts
- retrieve and use memory
- spawn research/coding/browser/image/helper agents
- use tools
- browse the web
- automate browsers
- generate images
- run code/native jobs through sandboxed runners
- create scheduled/proactive ambient turns
- start conversations sometimes without spamming
- render structured Telegram output
- create Telegram Mini Apps or richer UI when chat is not enough
- ask trusted users for approval before consequential actions

## Sessions

Every conversation context is its own session:

- Telegram DM
- Telegram group
- Telegram topic
- task-agent thread
- generated UI surface

Each session has its own message history, memory context, active runs, and
delivery state.

If messages arrive while Param is thinking, they become steering context for
that same session. Param must avoid stale replies and stale side effects.

## Ambient Mode

Param should not be a bot that answers everything.

In quiet chats, he can participate naturally.

In busy groups, he should batch messages and usually respond only when it makes
sense: mentions, replies, direct questions, trusted-user requests, or occasional
natural participation.

Scheduled ambient turns are allowed. They are not fixed scheduled messages.
They wake Param and let the actor decide whether to speak, react, spawn work,
send a joke/meme, ask something, or stay quiet.

## Memory

Persistent memory is core.

Param should remember useful things about:

- users
- groups
- preferences
- projects
- relationships
- recurring tasks
- long-running context

Memory must be scoped by user, chat, session, project, and agent.

Group memory must not automatically become private user memory.

Memory should include provenance and confidence.

Param should have a memory-review process that automatically proposes useful
memories after conversations or tasks.

Memory must be retrieved and used before actor runs where it might matter.

## Trust And Approvals

Allowed users/groups control who can talk to Param.

Trusted users control who can approve consequential actions.

These are separate concepts.

Anyone in an allowed chat can ask Param to do something, but consequential
actions require Action Review.

Consequential actions include:

- shell commands
- file edits
- server changes
- external messages
- account changes
- purchases
- config changes
- sensitive memory changes
- broad private-data access

In group chats, Param should ask trusted users in that chat to approve or deny.

If no chat-specific trusted reviewer is configured, Param can notify globally
trusted users by DM, while keeping approval in the original chat.

Approval must be tied to the exact proposal, requester, approver, action,
target, and scope.

Current Telegram approval flow uses Eve HITL inline buttons. Param wraps
approval prompts as Action Review messages, only accepts approval callbacks
from the configured reviewer IDs for that Telegram chat, and blocks untrusted
`approve` / `deny` reply attempts.

Approval requests and final action results are also written to Param-owned
Action Review audit records keyed by Eve `requestId` and action `callId`. If
Param cannot create the audit record, Telegram approval buttons are hidden.

Groups can configure chat-specific trusted reviewers. When they do, approval
stays in that chat and pings the configured mentions. When they do not, Param
notifies globally trusted reviewers by DM, but approval still happens on the
original Eve HITL message in the original Telegram chat. Full cross-chat DM
approval relay is later Action Review work.

Chat-specific reviewer discovery from Telegram membership is later Action
Review work.

Safe auto-run tools are allowed, but the list must stay small.

Current implementation wraps Eve's built-in shell, file, and fetch tools with
Param approval policies. Narrow, non-sensitive file inspection auto-runs; broad
or sensitive reads, shell commands, file writes, and URL fetches require manual
Action Review. Provider-managed `web_search` stays enabled as a search-only
current-info path, not as approved page fetching. Approval prompts must show the
exact bounded proposal being approved.

## Architecture

Current direction: fresh Eve/serverless architecture.

High-level shape:

```text
Telegram / future channels
  -> Eve channel/webhook
  -> durable session
  -> Param instructions + context
  -> Eve Session Actor
  -> Param validation and Action Review
  -> delivery / memory / tools / task agents / UI
```

Important boundary:

```text
deterministic code routes and validates
the actor decides social meaning
trusted users approve consequential actions
native tools run behind adapters/sandboxes
```

Eve provides the durable agent framework:

- filesystem-first agent layout
- instructions
- tools
- skills
- channels
- subagents
- schedules
- sandbox integration
- durable sessions/runs/streaming

Param still owns:

- personality
- chat behavior
- memory policy
- Action Review
- approval rules
- output validation
- Telegram-specific UX
- runtime/tool boundaries

## Runtime And Tools

Native or risky work should not run directly in normal serverless handlers.

It should run behind adapters, using:

- Vercel Sandbox when it fits
- remote browser providers when needed
- optional self-hosted runner if a native tool cannot work well serverlessly

Param should support adapters for:

- Codex
- OpenCode
- Antigravity
- browser automation
- image generation
- custom CLIs
- MCP tools/connectors

Tools and task agents return results to Param. They do not send chat messages
directly.

## Telegram And UI

Telegram is the first channel.

Use Telegram webhooks in the Eve/serverless architecture.

Param should support:

- DMs
- groups
- topics
- mentions
- replies
- reactions
- Telegram Rich Messages
- inline buttons
- Mini Apps

Actors should emit validated UI specs, not arbitrary unsafe frontend code.

Consequential UI callbacks still go through Action Review.

## Stack

Current repo starts with:

- Eve
- TypeScript
- Bun
- Telegram channel
- Vercel/serverless direction
- Neon/serverless Postgres through Drizzle for durable profile and memory storage

Expected later additions:

- pgvector for memory search
- MCP where useful
- Vercel Sandbox or equivalent runners
- browser/runtime adapters
- image-generation adapter

## Deployment

Param is intended to deploy on Vercel first.

Deployment shape:

```text
GitHub repo
  -> Vercel project
  -> Eve build output
  -> Telegram webhook
  -> managed Postgres / memory storage
  -> sandbox or runner for native jobs
```

Expected setup:

- deploy the Eve app to Vercel
- set Vercel environment variables
- configure `TELEGRAM_BOT_TOKEN`
- configure `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- register Telegram webhook to `/eve/v1/telegram`
- connect managed Postgres for profile and memory storage
- add sandbox/native runner credentials when native tools land
- keep production secrets in Vercel env or a proper secret store

Local development:

```bash
bun install
bun x eve dev
```

Production should not rely on a long-running local process.

If Vercel Sandbox is not enough for some native/browser/code task, Param can use
a separate runner behind a runtime adapter without changing the main deployment
shape.

## Build Order

1. Keep the Eve scaffold small and working.
2. Make Telegram webhook intake real.
3. Add allowed users/groups.
4. Define session behavior for DMs, groups, and topics.
5. Add message batching and ambient-mode rules.
6. Add output validation and stale-output protection.
7. Add Action Review and trusted approvals.
8. Add persistent memory and retrieval.
9. Add task agents and native runtime adapters.
10. Add scheduled ambient turns.
11. Add richer Telegram UI and Mini Apps.

## Current Rule

Do not rebuild the old giant docs.

This document should stay readable and high-signal.

If implementation details become large, put them in code or small focused docs,
not here.
