# Decisions

## Product

- Param is an ambient friend in chat.
- Param is not a helpful assistant persona.
- Telegram is the first channel.
- Groups and DMs are both first-class.
- Param can send multiple messages in one thinking session.
- Param can react with emojis and can stay quiet.
- Param should be proactive but not spammy.

## Architecture

- Use serverless/Eve as the primary new architecture direction.
- Use deterministic code for routing, batching, permissions, stale-output
  checks, and delivery.
- Use an LLM-powered Session Actor for social judgment and decisions.
- Keep Param policy outside Eve so Param can enforce its own rules.
- Keep runtime adapters around all external agent CLIs and native tools.

## Channels

- Telegram uses webhooks in the serverless architecture.
- Telegram adapter owns Telegram-specific mapping and delivery.
- Param owns behavior decisions, not the channel adapter.
- Allowed users/groups are config, separate from trusted approvers.

## Trust And Safety

- Consequential actions require Action Review.
- Trusted users are configured security state, not memory.
- Group approval should tag trusted users in the chat when present.
- If no trusted user is present, approval can happen by DM.
- Approval is tied to exact proposal, requester, approver, scope, and target.
- Safe auto-run tools are allowed but must stay small.

## Memory

- Use persistent memory from the beginning.
- Memory is scoped by user, chat, session, project, and agent.
- Memory retrieval is mandatory before actor runs where memory might matter.
- Automatic memory review should propose useful memories.
- Actor-visible memory includes provenance.

## Native Work

- Native tools do not run in normal serverless handlers.
- Use Vercel Sandbox or another runner behind runtime adapters.
- A small self-hosted runner is allowed if a needed native tool cannot run well
  in Vercel Sandbox.
- Tool/runtime results return to Param as events.
- Tools and runtimes do not send chat messages directly.

## Runtimes

- Eve is the main durable agent runtime direction.
- Codex, OpenCode, Antigravity, browser automation, image generation, and custom
  CLIs remain possible runtime adapters.
- AI SDK harnesses are allowed when useful.
- Direct paid API model calls are not the default assumption.

## Cost

- Design for free-tier or low-cost personal use first.
- Browser, sandbox, coding, and media jobs are the main cost risk.
- Budgets and rate limits are required before heavy tool use.
