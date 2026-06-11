# Param Agent Docs

This folder describes the target architecture for Param Agent.

These docs are reference material. Do not read every file before implementing.

Implementation agents should start with:

- `../AGENTS.md`
- `IMPLEMENTATION_GUIDE.md`

Start here:

- `IMPLEMENTATION_GUIDE.md` is the ordered implementation map.
- `DECISIONS.md` is the short decision log.
- `DEPENDENCIES.md` records default packages and deferred libraries.
- `PROJECT_STRUCTURE.md` explains source layout, scripts, and module boundaries.
- `BUILD_SPEC.md` is the full system overview when deeper context is needed.

Subsystem docs:

- `ACTION_REVIEW.md` explains trusted approval and action safety.
- `CHANNELS.md` explains communication channels and channel adapters.
- `CONFIG.md` explains typed config, local overrides, and env secrets.
- `CONTRACTS.md` defines event and output contracts.
- `DATABASE.md` defines the Postgres/Drizzle data model.
- `EVALS.md` explains tests, behavioral evals, and release gates.
- `MEMORY.md` explains persistent memory.
- `OBSERVABILITY.md` explains logs, traces, metrics, audit, and debug views.
- `OPS.md` explains VPS deployment, local Postgres, installer, and recovery.
- `PROMPTS.md` explains prompt packets and actor contracts.
- `RUNTIME_ADAPTERS.md` explains Codex, OpenCode, Antigravity, and other runtimes.
- `SCHEDULER.md` explains proactive ambient wakes.
- `SECURITY.md` explains the threat model and security controls.
- `SKILLS.md` explains skills.sh integration and progressive skill loading.
- `TASK_AGENTS.md` explains spawned helper agents.
- `TOOLS.md` explains MCP, local tools, execution, policy, and audit.
- `UI.md` explains structured UI, callbacks, and Mini Apps.
- `channels/TELEGRAM.md` is the first concrete channel adapter.
- `REFERENCES.md` records source notes and lessons from existing systems.

## Architecture Map

```text
Communication Channels
  Telegram first, later WhatsApp, Slack, email, voice, or other chat channels

Orchestrator
  deterministic routing, queueing, batching, recovery

Context Builder + Prompt Compiler
  recent events, summaries, memory, policy, platform capabilities

Session Actor
  LLM-powered decision maker for one session

Validators + Action Review
  schema checks, style guard, trusted approval, tool policy

Runtime Adapters + Task Agents
  Codex, OpenCode, Antigravity, image/browser/CLI/server helpers

UI Renderer + Channel Surfaces
  Telegram messages, buttons, callbacks, Mini Apps, artifacts

Memory + Scheduler + Database + Evals
  durable memory, proactive wakes, reboot survival, behavior checks
```

## Naming

Use these terms consistently:

```text
Communication Channels
  the whole category of chat, messaging, email, voice, and operator surfaces

Channel Adapter
  the generic interface that connects one channel to Param

Telegram Channel Adapter
  the first concrete channel adapter
```

Avoid using `messenger adapter` as the main term. Param may support channels
that are not strictly messengers.
