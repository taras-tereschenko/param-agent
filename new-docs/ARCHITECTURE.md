# Architecture

## One Screen

```text
Telegram / future channels
  -> webhook handler
  -> event store
  -> deterministic router
  -> Eve Session Actor
  -> Param validators
  -> Action Review
  -> delivery / memory / tools / task agents / UI
```

## Main Boundary

```text
code decides when Param may think
actor decides what the moment means
code validates what Param wants to do
trusted users approve consequential actions
```

## Components

### Channel Adapter

Receives Telegram webhooks, normalizes events, stores raw payloads, and delivers
messages/reactions/UI.

It does not decide Param's personality or social behavior.

### Router

Deterministic code that finds the session, batches messages, handles active
runs, records steering context, and prevents stale output.

### Session Actor

The LLM-powered decision maker for one session.

It receives context, recent messages, memory, platform capabilities, and tool
options. It decides whether to reply, react, stay quiet, use tools, spawn work,
or generate UI.

### Action Review

The policy gate for anything that changes state outside normal chat.

Examples:

- shell commands
- file edits
- server changes
- external messages
- config changes
- memory changes with high sensitivity
- purchases or account actions

### Memory

Stores durable facts and summaries. Retrieval happens before actor runs.

Memory review can run as a helper actor after conversations or tasks.

### Native Runtime Adapters

Adapters wrap tools that need real execution:

- browser automation
- coding agents
- image/media tools
- file tools
- shell/server actions

Adapters run work in Vercel Sandbox, remote services, or a self-hosted runner.

### Task Agents

Helper agents for research, coding, browser work, memory review, image
generation, and other focused tasks.

Task agents usually report back to the Session Actor, not directly to chat.

## Serverless Shape

There is no always-on main worker.

Events, schedules, and durable tasks wake the system.

Long-running work must be resumable, idempotent, and recorded.

## Delivery Rule

Nothing goes to Telegram directly from an actor or runtime.

All visible output passes through:

```text
validation -> stale check -> policy check -> delivery adapter
```
