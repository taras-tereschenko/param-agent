# Param Agent Decisions

This file records firm architecture decisions.

It should stay short. If a decision needs detailed explanation, put that detail
in `BUILD_SPEC.md`.

## Product

- Param is an always-online ambient chat agent.
- Param should feel like a regular friend in the chat, not a helpful-assistant
  helpdesk.
- Core behavior principle: `Param replies when it feels natural for a friend in
  the chat to reply.`
- Param should feel like modern friends in the US chatting.
- Param can be casual, opinionated, playful, and sometimes sarcastic.
- Param's normal visible chat style is concise, witty, lowercase, short,
  casual, and modern.
- Slang is normal chat language for Param, not a scarce thing to ration.
- Param should split natural thoughts into multiple messages when that feels
  more human than one composed answer.
- Param should be proactive enough to feel present, but not spammy.
- Proactive behavior uses Scheduled Ambient Turns: scheduled wakes that let the
  actor decide whether to speak, react, spawn work, generate media, or stay
  quiet.
- Scheduled Ambient Turns are not direct scheduled messages.
- Detailed scheduler behavior lives in `docs/SCHEDULER.md`.
- Param can reply, react, stay quiet, use tools, spawn task agents, request
  approval, remember, and render UI.
- A thinking session can produce multiple visible messages or actions.
- Avoid robotic chat prefixes like `small update:`.
- Avoid corporate assistant phrasing, GPT-style closers, `as an ai` framing,
  long dashes, and mascot/tiny-helper self-description in visible chat.

## Architecture

- Param uses a modular architecture with stable subsystem contracts.
- Repository and module layout lives in `docs/PROJECT_STRUCTURE.md`.
- Channel-specific logic belongs in Channel Adapters.
- Runtime-specific logic belongs in Runtime Adapters.
- Storage-specific logic belongs in storage modules.
- Internal events and actor outputs use stable typed contracts.
- The orchestrator is deterministic code, not an LLM.
- The actor is LLM-powered and decides meaning, social behavior, and what to do.
- Actor runs use prompt/contract layers instead of one giant master prompt.
- Prompt contract details live in `docs/PROMPTS.md`.
- One session has at most one active main actor run.
- New same-session messages during an active run become live steering context.
- The orchestrator can tag mechanical facts and steering priority, but does not
  classify message meaning.
- Steering priority can be soft, strong, or hard-control.
- Param must not deliver stale visible output or perform stale side effects.
- Live steering is a runtime capability, not a universal provider guarantee.
- Skills use skills.sh as the default ecosystem.
- Skills are procedural knowledge, not permissions.
- Detailed skills behavior lives in `docs/SKILLS.md`.
- Param uses MCP for external tools/connectors instead of inventing its own
  plugin protocol.
- Local tools use schema-based tool definitions.
- Param Tool Registry normalizes tools and applies policy, audit, and approval.
- Detailed tool behavior lives in `docs/TOOLS.md`.
- Security threat model lives in `docs/SECURITY.md`.
- Observability behavior lives in `docs/OBSERVABILITY.md`.

## Communication Channels And Telegram

- Use Vercel Chat SDK as the messenger layer.
- Communication channel behavior lives in `docs/CHANNELS.md`.
- Telegram is the primary communication channel described in this spec.
- Telegram-specific behavior lives in `docs/channels/TELEGRAM.md`.
- Telegram transport on the VPS uses long polling by default.
- Telegram webhooks are optional, not required for the core bot.
- Polling and webhooks are mutually exclusive for Telegram.
- Chat SDK normalizes platform events; Param maps SDK events into its own
  durable internal event schema.
- Detailed internal event and actor output schemas live in `docs/CONTRACTS.md`.
- Persist enough raw Telegram payload data to cover routing, audit,
  platform-specific features, and adapter gaps.
- Telegram reaction choices come from the chat's available reactions when
  present.
- Reaction emoji limits apply only to `react_to_message`, not normal text.
- Telegram access is restricted by config to allowed DM users, groups, and
  topics.
- Allowed DM users control private chats.
- Allowed groups let everyone in that group talk with Param in that group
  session.
- Allowed chat access and trusted approval authority are separate concepts.

## Sessions

- A session is one durable conversation context.
- DMs, groups, group topics, task agents, and generated UI surfaces have
  separate sessions.
- Session keys are deterministic.
- Group chat memory does not automatically become private user memory.
- Cross-session events keep explicit links instead of merging sessions.
- Session state stores the current operating position; events store history.

## Memory

- Persistent memory is part of the core system.
- Memory review automatically produces structured memory candidates.
- Detailed memory behavior lives in `docs/MEMORY.md`.
- Memory is scoped by user, group, session, project, and agent.
- Group claims preserve source and confidence.
- Actor-visible memory includes provenance.
- Memory retrieval combines scoped lookup, semantic search, keyword search, and
  recent context.

## Task Agents And Runtimes

- Param can spawn task agents for research, coding, images, browser work,
  memory work, server work, and CLI work.
- Detailed task-agent behavior lives in `docs/TASK_AGENTS.md`.
- Task agents usually report to the Session Actor, not directly to chat.
- Runtime adapters target Codex, Antigravity, OpenCode, image generation,
  browser automation, and custom CLIs.
- Detailed runtime-adapter behavior lives in `docs/RUNTIME_ADAPTERS.md`.
- Codex CLI is the first/default main actor runtime because it can use the
  existing Codex subscription path.
- Direct paid API model calls are not part of the default runtime.
- External agent CLIs always sit behind Param runtime adapters.
- OpenCode and Antigravity are enabled target runtimes, but they can be
  warning-only at startup while Codex is the first required actor runtime.
- AI SDK community providers for Codex CLI or OpenCode are optional adapter
  implementation details, not Param's runtime boundary.
- Runtime adapters stream structured events back to Param.
- Runtime adapters inject Param's personality through each runtime's supported
  configuration surfaces.
- Runtime adapters do not tell wrapped CLIs to ignore real system, safety, or
  tool instructions.
- Runtime adapters should override generic `helpful assistant` or
  `useful assistant` persona wording where persona steering is allowed.
- Visible chat output from runtimes passes through Param's style guard before
  sending.
- If a runtime cannot accept live steering, the adapter preserves steering and
  uses cancel/restart or buffered pre-send refresh before delivery.

## Actions And Trust

- Anyone in a chat can ask Param to do something.
- Only trusted users can approve consequential actions.
- Requester and approver are stored separately.
- Detailed Action Review policy lives in `docs/ACTION_REVIEW.md`.
- Auto command review runs for action requests in every chat and verifies sender
  id, trust scope, action target, risk, and policy.
- In groups, change-making requests from non-trusted requesters ask trusted
  approvers in the same chat/topic when such approvers are present.
- If no trusted approver is present in that conversation, Param requests
  approval by DM from configured trusted users and records the cross-session
  approval link.
- Trusted requesters in DMs or groups can have safe and policy-allowed actions
  run after auto review, within their trust scope.
- Trusted users are configuration, not memory.
- Safe auto-run list is allowed, but it must stay small.
- Risky actions go through auto-review and/or manual approval.
- Consequential actions require exact proposal approval.
- Normal chat replies, reactions, no-reply decisions, and safe read-only checks
  do not need manual approval.

## Stack

- Runtime: Bun.
- Language: TypeScript.
- HTTP framework: Hono.
- Default dependency choices live in `docs/DEPENDENCIES.md`.
- Exact installed package versions are recorded in the generated `bun.lock`.
- Do not hand-write lockfiles or guess latest package versions in docs.
- Config format: typed TypeScript config files for non-secret settings.
- `param.config.ts` is committed with safe shared defaults.
- `param.config.local.ts` is the per-instance editable config and is ignored by
  git.
- Target config shape lives in `docs/CONFIG.md`.
- Secrets and deployment-specific values can live in `.env`.
- `.env.example` documents all expected environment variables with safe
  placeholders.
- Runtime validation uses Zod.
- Hosting: Hetzner CX23 VPS.
- Process model: native services.
- Database default: local Postgres + pgvector on the VPS.
- Managed Postgres remains a supported deployment option through
  `DATABASE_URL`.
- ORM/query layer: Drizzle.
- Database client for Param's own tables: Bun SQL through
  `drizzle-orm/bun-sql`.
- Chat SDK's Postgres state adapter may use `pg` internally, but direct `pg` is
  not a default Param app dependency.
- Target database schema lives in `docs/DATABASE.md`.
- Vector search: pgvector in Postgres.
- Keyword search: Postgres full-text search.
- Queue: Postgres-backed jobs.
- Redis and dedicated vector DB are not part of the default design.
- `dotenv` is not part of the default runtime because Bun loads `.env`
  automatically.
- Installer prompts use `@clack/prompts` by default.
- `@inquirer/prompts` is only a fallback if a prompt becomes awkward in Clack.
- Ink is reserved for a future richer operator/admin terminal UI, not the
  default installer.
- Jest, Vitest, Next.js, Express, Fastify, Prisma, LangChain, and LlamaIndex
  are not part of the default design.
- Temporal is not part of the core runtime.
- Effect is not part of the core runtime.
- Temporal and Effect can be reconsidered if the custom reliability/code
  structure becomes painful.
- Filesystem stores workspaces, repos, generated artifacts, CLI files, and local
  logs.
- Tailscale is used for private admin/internal access.
- Public HTTPS/reverse proxy is needed only for Telegram Mini Apps, external
  webhooks, OAuth callbacks, or Telegram webhook mode.

## UI And Mini Apps

- Detailed UI behavior lives in `docs/UI.md`.
- Actors emit structured UI specs, not arbitrary frontend code.
- UI Renderer validates specs, stores callback metadata, and maps surfaces to
  channels.
- Telegram Mini App pages use Vercel AI SDK UI structured object/generative UI
  patterns for JSON-rendered interfaces.
- Telegram Mini App pages use shadcn/ui as the default repository-owned React
  component system.
- Actors can tune generated UI style through approved shadcn CSS variable
  tokens.
- Per-surface UI theme patches are temporary.
- Persistent theme/profile changes require Action Review.
- Telegram Mini Apps are used for rich interactions that do not fit in plain
  messages or inline buttons.
- UI callbacks are events routed back into sessions.
- Consequential UI callbacks still go through Action Review.

## Tests And Evals

- Detailed test and eval behavior lives in `docs/EVALS.md`.
- Use deterministic tests for machinery and policy.
- Use scenario evals for social judgment, voice, memory behavior, steering, and
  proactive participation.
- Do not depend only on model graders for safety.
- Real chat replay fixtures must be opt-in and redacted.
- Release gates must include Action Review, memory isolation, no duplicate
  delivery, recovery, and voice regression checks.

## Operations

- Detailed operations behavior lives in `docs/OPS.md`.
- Param must survive reboots.
- Param needs an idempotent Linux install script for fresh machines.
- The installer prepares dependencies, directories, environment placeholders,
  systemd services, health checks, and startup-on-boot.
- The installer offers a runtime install checklist for Codex, OpenCode, and
  Antigravity.
- Codex, OpenCode, and Antigravity are selected by default in interactive
  setup, while startup checks can still be `require` or `warn` per runtime.
- The installer creates `param.config.local.ts` with empty documented overrides
  when missing.
- The first VPS install configures one owner Telegram user id.
- The owner id becomes the default allowed DM user and the first trusted owner.
- Allowed groups are configured separately from trusted users.
- The installer must not silently overwrite existing config, secrets, data, or
  service files.
- Important state is persisted before action.
- Workers use expiring locks for runs and jobs.
- After reboot, jobs and expired active runs are inspected and recovered.
- Admin and server-management tools go through Action Review.
- Observability must explain replies, no-replies, reactions, tool calls,
  approvals, memory changes, crashes, and reboots.
