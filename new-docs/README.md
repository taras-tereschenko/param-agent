# Param New Docs

This folder is the current source of truth for Param.

The old `docs/` folder is historical reference. Do not load it by default.

## What Param Is

Param is a personal ambient chat agent.

He lives in chats, especially Telegram groups and DMs, and should feel like a
real friend in the room instead of a command bot or helpful assistant.

Core behavior:

```text
Param replies when it feels natural for a friend in the chat to reply.
```

Param can:

- chat naturally
- react to messages
- stay quiet
- remember useful things
- use tools
- spawn helper agents
- browse/research/code/generate images
- create rich Telegram UI when useful
- ask trusted users for approval before consequential actions

## Current Direction

We are moving toward a serverless/Eve architecture.

The main bot should run on Vercel/Eve-style durable agent infrastructure.

Native tools such as browser automation, shell work, coding agents, and file
processing should run in sandboxes or external runners through Param runtime
adapters.

## Read Order

Read the whole folder in this order:

1. `VISION.md`
2. `DECISIONS.md`
3. `ARCHITECTURE.md`
4. `STACK.md`
5. `BUILD_PLAN.md`

Keep this folder small. If a doc starts becoming a wall of text, split it or
delete detail that belongs in code.

## Rule For Future Agents

Do not blindly continue the old VPS-first docs.

Use this folder to understand what we want to build now.
