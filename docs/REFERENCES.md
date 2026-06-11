# Param Agent References

This file records source material and lessons used in the architecture.

## Local Reference Repos

### Hermes Agent

Path:

```text
references/hermes-agent
```

Pinned commit:

```text
aeec88c77ffcb5c3c201f771d5079ebdb199ea88
```

Relevant lessons:

- Messaging gateway pattern is useful.
- Telegram channel adapter supports both polling and webhook modes.
- Hermes defaults to long polling unless `TELEGRAM_WEBHOOK_URL` is set.
- Webhook mode must require a secret token.
- Telegram group behavior needs gating, batching, mentions, topic handling, and
  observed context.
- Gateway state and recovery need tests for stuck runs, duplicate delivery,
  active sessions, restart drain, and Telegram network behavior.
- Memory plugins show that persistent memory deserves a first-class module.

Useful files:

- `references/hermes-agent/gateway/platforms/telegram.py`
- `references/hermes-agent/tests/gateway/test_telegram_webhook_secret.py`
- `references/hermes-agent/tests/gateway/test_telegram_group_gating.py`
- `references/hermes-agent/tests/gateway/test_active_session_text_merge.py`
- `references/hermes-agent/tests/gateway/test_restart_resume_pending.py`
- `references/hermes-agent/plugins/memory/`

### OpenClaw

Path:

```text
references/openclaw
```

Pinned commit:

```text
60e0d2a7b91030bf39fd215edd09b5da4cb8c5bf
```

Relevant lessons:

- Gateway/channel plugin architecture is useful for modular design.
- Telegram channel is production-shaped and supports long polling by default.
- Webhook mode is optional.
- Polling needs leases, offset persistence, liveness tracking, and conflict
  handling.
- Telegram routing needs DMs, groups, topics, replies, reactions, media,
  approvals, and native actions.
- Exec approvals separate normal chat access from approval authority.
- Runtime adapters and subagents should emit structured events.
- Heartbeat is useful as an ambient wake pattern, but Param should model it as
  scheduled ambient turns with structured `no_reply` instead of magic ack text.
- Heartbeat scheduling needs active hours, cooldowns, flood guards,
  skip-when-busy behavior, jittered phases, and auditability.
- Cron is useful for scheduled work, while ambient wakes are useful for
  main-session proactive participation.

Useful files:

- `references/openclaw/docs/channels/telegram.md`
- `references/openclaw/extensions/telegram/src/monitor.ts`
- `references/openclaw/extensions/telegram/src/polling-session.ts`
- `references/openclaw/extensions/telegram/src/webhook.ts`
- `references/openclaw/extensions/telegram/src/bot-message-context.ts`
- `references/openclaw/extensions/telegram/src/exec-approvals.ts`
- `references/openclaw/src/talk/agent-run-control.ts`
- `references/openclaw/src/agents/subagent-registry.ts`
- `references/openclaw/docs/gateway/heartbeat.md`
- `references/openclaw/src/infra/heartbeat-wake.ts`
- `references/openclaw/src/infra/heartbeat-cooldown.ts`
- `references/openclaw/src/infra/heartbeat-schedule.ts`
- `references/openclaw/src/auto-reply/heartbeat.ts`

## Official Docs

### Vercel Chat SDK

Sources:

- [Chat SDK adapters](https://chat-sdk.dev/adapters)
- [Chat SDK Telegram adapter](https://chat-sdk.dev/adapters/official/telegram)
- [Chat SDK PostgreSQL state adapter](https://chat-sdk.dev/adapters/official/postgres)
- [Chat SDK Chat API](https://chat-sdk.dev/docs/api/chat)
- [Vercel Chat SDK guide](https://vercel.com/kb/guide/the-complete-guide-to-chat-sdk)

Relevant lessons:

- Chat SDK is a multi-platform bot layer, not just a web chat UI.
- The `Chat` class coordinates adapters, state, and event handlers.
- Telegram is an official adapter.
- Telegram channel adapter supports groups, channels, inline keyboards, webhook mode,
  and polling fallback.
- Telegram channel adapter has `mode: "auto" | "webhook" | "polling"`.
- Polling and webhooks are mutually exclusive.
- Chat SDK exposes handlers for direct messages, subscribed messages,
  reactions, actions, modals, slash commands, and webhook handlers.
- State adapters include PostgreSQL, Redis, ioredis, and memory.
- The Telegram adapter package is `@chat-adapter/telegram`.
- The Postgres state adapter package is `@chat-adapter/state-pg`.
- The Postgres state adapter is built on `pg` / node-postgres.
- The Postgres state adapter can avoid a separate Redis service for typical
  workloads, while Redis remains better under extreme contention.

### Telegram Bot API

Sources:

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [ReactionTypeEmoji](https://core.telegram.org/bots/api#reactiontypeemoji)
- [setMessageReaction](https://core.telegram.org/bots/api#setmessagereaction)
- [getUpdates](https://core.telegram.org/bots/api#getupdates)
- [setWebhook](https://core.telegram.org/bots/api#setwebhook)

Relevant lessons:

- Telegram bots receive updates through two mutually exclusive approaches:
  `getUpdates` polling or webhooks.
- Telegram stores incoming updates temporarily until the bot receives them.
- `update_id` is important for dedupe and recovery.
- Chat info can include `available_reactions`.
- `setMessageReaction` changes reactions on a message.
- Bots can set at most one non-premium reaction per message.
- Mini Apps can be launched from Telegram surfaces and need a public web
  surface for the UI.

### AI SDK UI, Testing, And Telemetry

Sources:

- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
- [AI SDK Codex CLI community provider](https://ai-sdk.dev/providers/community-providers/codex-cli)
- [AI SDK OpenCode community provider](https://ai-sdk.dev/providers/community-providers/opencode-sdk)
- [AI SDK UI overview](https://ai-sdk.dev/docs/ai-sdk-ui/overview)
- [AI SDK generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [AI SDK object generation](https://ai-sdk.dev/docs/ai-sdk-ui/object-generation)
- [AI SDK testing](https://ai-sdk.dev/docs/ai-sdk-core/testing)
- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [shadcn/ui docs](https://ui.shadcn.com/docs)
- [shadcn/ui theming](https://ui.shadcn.com/docs/theming)

Relevant lessons:

- Generative UI should be tied to tools and structured results, not freeform
  model-written frontend code.
- `useObject` can stream structured JSON objects into UI, which matches Param's
  JSON-rendered Telegram Mini App direction.
- shadcn/ui fits the renderer layer because components are repository-owned source
  code, composable, and inspectable by coding agents.
- shadcn/ui theming uses CSS variables and semantic tokens, which gives Param a
  safe way to let actors tune generated UI without arbitrary CSS.
- Mock language and embedding models are useful for deterministic tests.
- Stream simulation is useful for testing steering and partial-output behavior.
- Telemetry should allow input/output recording to be disabled for privacy.
- AI SDK provider packages include `@ai-sdk/openai`, `@ai-sdk/anthropic`, and
  `@ai-sdk/google`.
- AI SDK UI's React hooks live in `@ai-sdk/react`.
- AI SDK lists community providers for Codex CLI and OpenCode.
- The Codex CLI community provider does not support AI SDK custom tools;
  Codex executes its own tools, and Param must observe/wrap that behavior.
- The OpenCode community provider also does not support AI SDK custom tools;
  OpenCode executes tools server-side.
- No Antigravity CLI provider is part of Param's default AI SDK dependency set.
- AI SDK is useful for direct model calls and generated structured data, but it
  is not Param's runtime adapter boundary.

### MCP And Tool Calling

Sources:

- [Model Context Protocol intro](https://modelcontextprotocol.io/docs/getting-started/intro)
- [Model Context Protocol SDKs](https://modelcontextprotocol.io/docs/sdk)
- [AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)

Relevant lessons:

- MCP is the established open protocol for connecting AI apps to external
  systems, tools, data sources, and workflows.
- MCP has an official TypeScript SDK.
- MCP has broad client/server ecosystem support, so Param should use MCP for
  external tools/connectors instead of inventing a plugin protocol.
- AI SDK tools use descriptions, input schemas, optional executors, and
  optional approval flows.
- Tool calls should be schema-validated before execution.
- OpenAI function calling supports strict schema adherence when schemas meet
  strict-mode requirements.
- Param still needs its own Tool Registry because MCP and model-provider tool
  calling do not know Param's Telegram sessions, trusted users, approval rules,
  audit requirements, or server boundaries.

### Security

Sources:

- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)

Relevant lessons:

- OWASP LLM risks map directly to Param: prompt injection, insecure output
  handling, sensitive information disclosure, insecure plugin design,
  excessive agency, denial of service, and supply chain vulnerabilities.
- MCP clients need protections against confused-deputy OAuth flows, token
  passthrough, SSRF, session hijacking, and local MCP server compromise.
- Server-side fetches should not reach cloud metadata or private network
  addresses.
- Local MCP server configuration is effectively code execution and needs
  explicit review.
- Telegram Mini App data must be validated server-side and bound to the
  expected user/session/surface before actor context.

### Observability

Sources:

- [OpenTelemetry observability primer](https://opentelemetry.io/docs/concepts/observability-primer/)
- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)

Relevant lessons:

- Observability should combine traces, metrics, and logs rather than relying on
  one signal.
- Correlated ids are essential for reconstructing one workflow across app,
  worker, runtime, tool, and delivery boundaries.
- AI SDK telemetry uses OpenTelemetry and can record model inputs/outputs, but
  Param should keep input/output recording configurable and off by default for
  private chat deployments.

### skills.sh

Sources:

- [skills.sh docs](https://www.skills.sh/docs)
- [skills.sh CLI](https://www.skills.sh/docs/cli)
- [skills.sh API](https://www.skills.sh/docs/api)
- [skills.sh FAQ](https://www.skills.sh/docs/faq)

Relevant lessons:

- skills.sh is an open agent skills ecosystem.
- The `skills` CLI installs skills with commands such as
  `npx skills add <owner/repo>`.
- The catalog API supports leaderboard, search, curated skills, skill detail
  snapshots, and audit lookups.
- Skill detail responses can include file contents and content hashes, which
  helps Param cache and detect updates.
- Search can return fuzzy or semantic results.
- Audit responses can include pass, warn, fail, and risk-level information.
- skills.sh warns that it cannot guarantee every listed skill is safe, so Param
  still reviews third-party skills before installing or enabling them.
- The CLI has anonymous telemetry; Param should disable it by default for
  automated installs unless the owner opts in.

### OpenAI Evals And Graders

Sources:

- [OpenAI evals](https://developers.openai.com/api/docs/guides/evals)
- [OpenAI graders](https://developers.openai.com/api/docs/guides/graders)

Relevant lessons:

- Evals should be scenario-driven and versioned.
- Graders can score outputs against references, including fuzzy model-graded
  checks.
- Current OpenAI docs say graders are being deprecated in the eval and
  fine-tuning workflows they support, so Param should keep its eval format
  portable.
- Safety gates should rely on deterministic assertions first.

### Hono And Bun

Sources:

- [Bun environment variables](https://bun.sh/docs/runtime/environment-variables)
- [Bun test runner](https://bun.sh/docs/test)
- [Hono Bun guide](https://hono.dev/docs/getting-started/bun)
- [Bun HTTP server docs](https://bun.sh/docs/runtime/http/server)

Relevant lessons:

- Hono works on Bun and gives a small Web-standards HTTP layer.
- Bun can run TypeScript directly and serve HTTP, but Hono keeps routing and
  middleware clearer.
- Bun reads `.env` files automatically, so `dotenv` is unnecessary by default.
- Bun has a built-in TypeScript-capable test runner, so Jest/Vitest are not
  needed by default.

### Postgres, Drizzle, pgvector

Sources:

- [Drizzle PostgreSQL guide](https://orm.drizzle.team/docs/get-started/postgresql-new)
- [Drizzle Bun SQL guide](https://orm.drizzle.team/docs/connect-bun-sql)
- [Drizzle vector similarity search](https://orm.drizzle.team/docs/guides/vector-similarity-search)
- [Bun SQL](https://bun.sh/docs/runtime/sql)
- [Neon pgvector extension](https://neon.com/docs/extensions/pgvector)
- [Supabase vector columns](https://supabase.com/docs/guides/ai/vector-columns)

Relevant lessons:

- Bun SQL is built into Bun and supports PostgreSQL with tagged-template
  queries, connection pooling, transactions, and prepared statements.
- Drizzle officially supports Bun SQL through `drizzle-orm/bun-sql`.
- Param's own database layer should use Bun SQL through Drizzle.
- `pg` / node-postgres remains relevant for Chat SDK's Postgres state adapter,
  but not as Param's default app database client.
- Drizzle can model pgvector-backed embedding columns and similarity search.
- Managed Postgres can support pgvector.
- A single Postgres system can hold events, jobs, memory metadata, audit, and
  vector search before introducing separate Redis/vector infrastructure.

### Zod

Sources:

- [Zod docs](https://zod.dev/)

Relevant lessons:

- Zod is TypeScript-first schema validation with static inference.
- Zod supports JSON Schema conversion, which fits actor/tool/UI contracts.
- Zod requires TypeScript strict mode.

### Temporal And Effect

Sources:

- [Temporal docs](https://docs.temporal.io/)
- [Temporal TypeScript SDK](https://typescript.temporal.io/)
- [Effect](https://effect.website/)

Relevant lessons:

- Temporal is a durable workflow engine that can resume workflows after crashes,
  network failures, or long waits.
- Temporal maps naturally to actor runs, tool activities, approval signals, and
  task-agent child workflows.
- Temporal adds infrastructure and a deterministic workflow programming model.
- Temporal's TypeScript SDK is officially Node-focused.
- Effect is a robust TypeScript toolkit for typed errors, retries, concurrency,
  streams, dependency injection, resource handling, and schema validation.
- Effect is a broad programming style, not just a small utility library.
- Param does not depend on Temporal or Effect in the core architecture.
- Reconsider Temporal if Postgres jobs/runs become an accidental workflow engine.
- Reconsider Effect if the TypeScript codebase needs a stronger effect system.

### Voice, Texting Style, And Runtime Personality

Sources:

- [Texting insincerely: The role of the period in text messaging](https://www.sciencedirect.com/science/article/abs/pii/S0747563215302181)
- [The death of capital letters](https://www.theguardian.com/society/2025/feb/18/death-of-capital-letters-why-gen-z-loves-lowercase)
- [Gen Z's new emoji lexicon](https://www.axios.com/2025/08/09/smiley-emoji-gen-z)
- [OpenAI Codex default base instructions](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md)
- [OpenAI Codex AGENTS.md docs](https://github.com/openai/codex/blob/main/docs/agents_md.md)
- [OpenCode config docs](https://opencode.ai/docs/config)
- [OpenCode agent docs](https://dev.opencode.ai/docs/agents/)
- [OpenCode rules docs](https://dev.opencode.ai/docs/rules/)
- [Antigravity CLI settings](https://antigravity.google/docs/cli-settings)
- [Antigravity CLI product page](https://www.antigravity.google/product/antigravity-cli)

Relevant lessons:

- Text messaging has its own pragmatic style. Periods, capitalization, message
  length, emoji, and line splitting can change how human or stiff a message
  feels.
- Lowercase, fragments, emoji, and short message bursts can be normal casual
  chat behavior.
- Emoji and slang meanings shift over time, so Param should learn from the room
  instead of hardcoding one permanent slang dictionary.
- Prompt wording matters. Telling a model to "use slang lightly" may make it
  avoid slang too much. Treat slang as normal language and catch only forced,
  fake, outdated, or assistant-like output.
- Codex, OpenCode, and Antigravity expose different ways to steer behavior.
  Runtime adapters need per-runtime personality injection plus Param's own
  style guard for visible chat.
- Personality instructions must not attempt to override real system, safety, or
  tool rules. They should override generic helpful-assistant wording only where
  the runtime allows it.
- The useful prompt shape is layered: identity, conversation protocol,
  capabilities, behavior, approval policy, platform UX rules, voice, style
  guard, and product facts.
- Param should use that shape as typed prompt/contract layers, not as one giant
  static prompt.

## Architecture Lessons To Keep

- Build around module contracts, not one giant agent loop.
- Keep internal events and actor outputs as typed contracts.
- Map those contracts into Postgres tables with Drizzle schema definitions.
- Keep configuration typed, validated, redacted, and separated from secrets.
- Store events before acting.
- Keep orchestrator deterministic.
- Let the actor decide meaning.
- Use durable sessions for every chat, topic, task, and UI surface.
- Keep one active main actor run per session.
- Treat new same-session messages as steering, not automatic interruption.
- Use scheduled ambient turns for proactive behavior instead of direct scheduled
  messages.
- Compile actor prompts from typed contract layers.
- Keep prompt contracts versioned and adapter-consumable.
- Use scoped, provenance-aware memory.
- Treat memory as selected, scoped evidence, not raw chat history.
- Keep group claims separate from private user facts.
- Gate dangerous actions through trusted-user approval.
- In groups, request trusted approval in the same chat by tagging trusted users.
- In trusted-user direct chats, use auto command review mode.
- Prefer polling for Telegram on a VPS.
- Use Tailscale for private admin access.
- Add public HTTPS only for Telegram Mini Apps, external callbacks, or webhook mode.
