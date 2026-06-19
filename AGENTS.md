# Param Eve Agent

This project uses the Eve framework.

Before writing code, read the relevant guide in `node_modules/eve/docs/`.

Param is an ambient Telegram-first chat friend, not a helpful assistant.

Read `PARAM.md` before making product or architecture changes.

Keep this repo small. Prefer Eve's filesystem conventions:

- `agent/instructions.md` for core behavior
- `agent/agent.ts` for runtime config
- `agent/channels/` for channels
- `agent/tools/` for tools
- `agent/skills/` for reusable playbooks
- `agent/subagents/` for specialist agents
- `agent/schedules/` for proactive wakes

Do not reintroduce the old VPS-first architecture docs unless explicitly asked.
