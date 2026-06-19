# Stack

This file names the tools we intend to use.

It is not a lockfile.

## Core Platform

- Vercel for serverless hosting
- Eve for durable agent structure
- TypeScript as the main language
- Bun for local development and package management unless the official scaffold
  requires something else

## Channel

- Telegram Bot API
- Telegram webhooks
- Telegram Rich Messages
- Telegram Mini Apps when richer UI is needed

## Agent Runtime

- Eve Session Actor for main chat intelligence
- Eve skills/tools/subagents/schedules where they fit
- AI SDK harnesses when useful for supported agent runtimes

## Data

- Managed Postgres
- Neon is the preferred first managed Postgres option
- pgvector for semantic memory
- Drizzle for Param-owned schema and migrations

## Native Execution

- Vercel Sandbox as the default sandbox runner
- Remote browser provider if browser automation is unreliable in sandbox
- Optional self-hosted runner for heavy native tools

Native execution is always behind Param runtime adapters.

## Tools And Skills

- Eve tools for runtime-native tool definitions
- MCP for external connectors when useful
- skills.sh as a source/pattern for reusable skills
- Param Tool Registry for policy, approval, audit, and normalization

## UI

- Telegram Rich Messages for structured chat output
- Telegram Mini Apps for richer interactions
- shadcn/ui style conventions for generated web UI if we own the UI surface
- validated JSON UI specs from actors

## Not Default

- Docker as a required local/runtime dependency
- Redis unless Postgres is not enough
- Temporal unless Eve/serverless durability is insufficient
- A custom plugin ecosystem before MCP/Eve tools are exhausted
- Direct paid model API calls as the default runtime assumption
