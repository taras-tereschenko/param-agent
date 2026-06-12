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

## Official Setup Rule

When adding or bootstrapping frameworks, runtimes, libraries, databases, or
tooling, use the official setup path first.

- Check the current official docs before choosing install or scaffold commands.
- Prefer official CLIs and package-manager commands such as `bun create`,
  `bun add`, and `bunx` when they exist.
- If an official starter would overwrite or reshape this repo, run it in
  `/private/tmp`, inspect the generated files, then adapt only the needed parts.
- Prefer non-interactive official starter flags when available. For temporary
  starters, run from `/private/tmp` with a relative target name so scaffold CLIs
  do not trip over absolute-path behavior.
- If the official docs say to create a config file manually, create it manually
  and keep it close to the documented shape.
- If a CLI cannot be used because it is interactive, unavailable, blocked by the
  sandbox, or does not provide an init command, say so in the work summary and
  follow the official manual setup docs instead.
- Do not invent dependency versions or lockfiles. Install with Bun and let
  `bun.lock` pin the resolved versions.
- Use the official project CLI for follow-up operations. For example, Drizzle
  schema changes should go through `bunx drizzle-kit generate`, `migrate`, or
  `push` as appropriate after schema files exist.

## Reference Repos

`references/hermes-agent` and `references/openclaw` are read-only references.
Do not edit them unless explicitly asked.

Use them to study patterns, not to copy architecture blindly.
