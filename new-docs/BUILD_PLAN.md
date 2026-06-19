# Build Plan

This is the intended order for building Param.

Keep every slice small and runnable.

## 1. Study Official Starters

Inspect official Eve and Vercel personal-agent-template setup in `/private/tmp`.

Use official setup paths first.

Do not copy architecture blindly.

Goal: choose the smallest repo shape that supports Param.

## 2. Telegram Intake

Build webhook intake without intelligence.

Needed:

- Telegram webhook endpoint
- allowed users/groups config
- raw payload storage
- normalized event records
- dedupe

Goal: one Telegram message becomes one durable Param event.

## 3. Sessions And Routing

Build deterministic session mechanics.

Needed:

- DM/group/topic session keys
- batching
- one active actor run per session
- steering context during active runs
- stale output guard

Goal: the right session wakes once with the right context.

## 4. Session Actor

Connect Eve actor behavior.

Needed:

- Param voice/context packet
- recent messages
- retrieved memory
- output contract
- reply/react/no-reply/tool/render-ui decisions

Goal: Param can behave naturally in one session.

## 5. Delivery

Send validated actor outputs to Telegram.

Needed:

- text messages
- multiple messages per run
- reactions
- Telegram Rich Messages
- delivery dedupe

Goal: actor output reaches chat only after validation.

## 6. Action Review

Add trusted approval before powerful tools.

Needed:

- trusted users
- approval proposals
- approve/deny by reply
- group approval
- DM fallback approval
- audit log

Goal: consequential actions cannot bypass Param policy.

## 7. Memory

Make memory useful.

Needed:

- memory storage
- scoped retrieval
- vector search
- memory review actor
- provenance in actor context

Goal: Param remembers and uses relevant memories safely.

## 8. Native Tools

Add real-world capability through adapters.

Needed:

- Vercel Sandbox adapter
- browser adapter
- coding/runtime adapter
- artifact capture
- budgets and timeouts

Goal: approved native jobs run outside request handlers and return results.

## 9. Proactivity

Add ambient presence.

Needed:

- scheduled wakes
- cooldowns
- quietness rules
- actor decision to speak or stay quiet

Goal: Param can naturally re-enter chats without becoming spam.

## 10. Rich UI

Add richer surfaces only after chat works.

Needed:

- validated UI specs
- Telegram Mini Apps
- callbacks as session events
- Action Review for consequential callbacks

Goal: Param can create useful UI without unsafe arbitrary frontend generation.
