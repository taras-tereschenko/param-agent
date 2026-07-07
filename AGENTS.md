# Param Eve Agent

This project uses the Eve framework.

Before writing code, read the relevant guide in `node_modules/eve/docs/`.

Param is an ambient Telegram-first chat friend, not a helpful assistant.

Read `PARAM.md` before making product or architecture changes.

Keep this repo small. Prefer Eve's filesystem conventions:

- `agent/instructions.ts` for dynamic core behavior and memory/session context
- `agent/lib/base-instructions.ts` for Param's stable personality and rules
- `agent/agent.ts` for runtime config
- `agent/channels/` for channels
- `agent/tools/` for tools
- `agent/skills/` for reusable playbooks
- `agent/subagents/` for specialist agents
- `agent/schedules/` for proactive wakes

Param self-hosts on a VPS (see DEPLOY.md), but keep Eve conventions: do not
resurrect the old pre-Eve custom VPS architecture docs.
