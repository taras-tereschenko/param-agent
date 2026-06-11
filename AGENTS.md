# Param Agent Contributor Guide

Start here when implementing Param.

Do not read all docs into context. The docs are reference material. Load only
the small set needed for the subsystem you are touching.

## Required First Read

Read in this order:

1. `docs/IMPLEMENTATION_GUIDE.md`
2. `docs/DECISIONS.md`
3. `docs/DEPENDENCIES.md`
4. `docs/PROJECT_STRUCTURE.md`

Then read the subsystem docs named by the implementation guide.

## Core Rules

- Param is an ambient chat friend, not a helpful-assistant helpdesk.
- The orchestrator is deterministic code.
- The Session Actor is LLM-powered and decides social meaning.
- Telegram is the first communication channel.
- External agent CLIs always sit behind Param runtime adapters.
- Consequential actions go through Param Action Review.
- Memory must be scoped and retrieved, not only stored.
- Bun, TypeScript, Hono, Drizzle, Bun SQL, local Postgres, Zod, Chat SDK, MCP,
  and the Codex CLI runtime adapter are the default stack.

## Reference Repos

`references/hermes-agent` and `references/openclaw` are read-only references.
Do not edit them unless explicitly asked.

Use them to study patterns, not to copy architecture blindly.
