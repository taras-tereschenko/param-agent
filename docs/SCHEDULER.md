# Param Agent Scheduler

This file defines Param's scheduler and proactive wake system.

Core principle:

```text
The scheduler wakes Param. It does not speak for Param.
```

## Purpose

The scheduler exists so Param can be always online without needing a user to
send a message first.

It can wake Param for:

- quiet chat check-ins
- jokes, memes, or topic seeds
- follow-ups on promises
- unfinished tasks
- scheduled memory review
- research watches
- server health checks
- approval timeouts
- recovery scans
- custom trusted schedules

The scheduler is programmatic. It creates durable jobs and internal events. The
actor decides whether to send a message, react, spawn work, use a tool, render
UI, or stay quiet.

## What It Is Not

The scheduler is not a direct message sender.

Bad model:

```text
cron fires -> send "gm chat"
```

Correct model:

```text
schedule fires -> ambient.wake event -> actor reads the room -> actor decides
```

Param must never mention scheduler internals in normal chat:

- scheduler
- cron
- heartbeat
- automation
- wake event
- job id

Those details belong in logs and internal operator views, not in visible chat.

## Schedule Kinds

Schedules can be one-shot or recurring.

Canonical kinds:

```text
ambient_wake
  wake a chat session so the actor can decide whether to participate

memory_review
  inspect recent conversation and produce memory candidates

server_check
  inspect Param or VPS health

research_watch
  revisit a topic or source and report only when useful

approval_timeout
  expire pending approvals that were ignored

recovery_scan
  look for stuck jobs, expired locks, and incomplete runs

custom_task
  trusted user-defined scheduled task
```

Chat-proactive schedules use `ambient_wake`. Background maintenance usually
uses the more specific kind.

## Ambient Wake Flow

An ambient wake is Param's proactive chat behavior.

Flow:

```text
1. Scheduler finds a due schedule.
2. Scheduler creates a schedule_fires row with a stable idempotency key.
3. Scheduler enqueues a durable job.
4. Worker claims the job with an expiring lock.
5. Worker writes an internal ambient.wake event.
6. Orchestrator resolves the target session.
7. Context Builder loads recent messages, summaries, memory, cooldowns,
   active hours, pending tasks, and platform capabilities.
8. Prompt Compiler creates an ambient wake prompt packet.
9. Session Actor decides what a real friend would naturally do.
10. Validators enforce cooldowns, output limits, approval, and style.
11. Delivery Adapter sends accepted visible output, if any.
12. Scheduler updates last_fired_at and next_fire_at.
```

The wake is successful even if the actor emits `no_reply`.

Quiet is a valid result.

## Wake Intent

Each ambient wake has an intent.

Supported intents:

```text
quiet_chat_wake
check_in
topic_seed
joke_drop
meme_drop
follow_up
daily_recap
memory_review
server_health
research_watch
unfinished_task_ping
```

Intent is a hint, not a command.

Example:

```text
intent: joke_drop
```

means:

```text
maybe a joke fits here
```

not:

```text
send a joke no matter what
```

## Active Hours

Active hours define when proactive wakes may create visible chat behavior.

They can be configured by:

- session
- group
- user
- schedule
- global default

Rules:

- Active hours use the chat's configured timezone when available.
- If a schedule fires outside active hours, it should usually skip or defer.
- Maintenance schedules can still run outside active hours if they do not
  produce visible chat output.
- Trusted users can approve exceptions for specific schedules.

Example:

```text
active hours: 10:00-23:30
timezone: chat
```

Active hours protect people from Param waking a chat at weird times.

## Cooldowns And Flood Guards

Cooldowns keep Param proactive without becoming spammy.

Cooldown dimensions:

- per session
- per user
- per intent
- per schedule
- per visible output type
- per day

Typical checks:

```text
has Param already proactively messaged this session recently?
has this exact intent fired recently?
is the group currently moving too fast?
did Param already do this bit today?
did the previous wake result in no_reply?
```

Flood guards should also look at chat velocity:

- messages per minute
- number of active participants
- whether Param was recently addressed
- whether the conversation is tense or private-feeling
- whether there are pending unanswered mentions

The scheduler can skip, defer, or downgrade a wake when guards fail.

The actor can still choose `no_reply` even when guards pass.

## Creating Schedules

Users can ask Param to create schedules.

Examples:

```text
drop a meme here every friday if the chat is dead
```

```text
remind us weekly to review the architecture docs
```

```text
check server health every morning
```

The actor may propose a schedule, but Action Review decides whether it can be
created.

Recurring chat-proactive schedules require trusted approval.

Approval preview should include:

- target session
- schedule kind
- wake intent
- recurrence
- active hours
- cooldowns
- daily or weekly limits
- visible output limits
- requester
- creator
- expiry, if any

If the schedule changes later, the changed version needs a new exact approval.

## Schedule Ownership

Every schedule should store who created or approved it.

Useful ownership fields:

- created by user, actor, admin, or system
- requested by event ids
- approved by approval id
- target session
- trust scope
- last edited by
- reason

This matters because proactive behavior can affect a group even when nobody is
currently talking to Param.

## One-Shot Schedules

One-shot schedules are useful for follow-ups.

Examples:

```text
ask me tomorrow if i finished this
```

```text
check this research link again in two hours
```

```text
ping the group if the deploy is still failing at 18:00
```

A one-shot schedule fires once, then becomes completed or expired.

One-shot visible chat behavior can still require approval when it affects a
group, external system, server, or another user's private context.

## Recurring Schedules

Recurring schedules keep running until paused, expired, disabled, or deleted.

They need stronger controls:

- approval before activation
- active hours
- cooldowns
- per-day limits
- expiry or review date when appropriate
- audit trail
- easy pause/disable command for trusted users

Recurring ambient wakes should vary naturally. The actor should not repeat the
same joke, greeting, or phrasing on a loop.

## Memory Review Schedules

Memory review can use the same scheduler machinery.

Unlike ambient chat wakes, memory review should normally produce no visible
chat output.

Flow:

```text
schedule fires -> memory_review job -> Memory Review Actor -> memory candidates
```

Useful triggers:

- every few hours
- after a busy chat quiets down
- before compaction
- after compaction
- after task agents finish
- after project decisions

Memory review schedules should respect privacy and sensitivity policies.

## Research Watch Schedules

Research watches let Param revisit a topic later.

Examples:

```text
watch this repo for releases
```

```text
check once a day if there is new info about this library
```

```text
look for updates on Telegram bot features weekly
```

Research watches should usually spawn research task agents.

The task agent reports to the Session Actor. The Session Actor decides whether
anything should be said in chat.

No-update results should usually stay quiet or appear only in admin/debug views.

## Server Health Schedules

Server health schedules inspect Param and the VPS.

They can check:

- process health
- disk space
- database connectivity
- queue backlog
- failed jobs
- expired locks
- runtime adapter availability
- recent crash loops

Visible alerts should be sent only to trusted/admin sessions unless configured
otherwise.

Server-changing actions discovered by health checks still go through Action
Review.

## Approval Timeouts

Pending approvals should not live forever.

The scheduler can enqueue timeout checks.

When an approval expires:

- mark the approval expired
- write an internal event
- notify the relevant session only when useful
- unblock waiting jobs or actor runs safely

Ignoring an approval is different from denying it. The audit log should preserve
that difference.

## Reboot Survival

Schedules must survive process restarts and VPS reboots.

Requirements:

- schedules are stored in Postgres
- every planned fire has a stable `schedule_fires` row
- jobs use idempotency keys
- workers claim jobs with expiring locks
- missed fires are handled on startup
- duplicate fires do not produce duplicate chat messages

Startup recovery should inspect:

- schedules with `next_fire_at` in the past
- `schedule_fires` rows stuck in pending or running
- jobs with expired locks
- actor runs waiting on jobs that no longer exist
- approvals that expired while Param was offline

Recovery should write `system.recovery` events for meaningful repairs.

## Catch-Up Policy

After downtime, Param should not replay every missed proactive wake.

Catch-up policy should depend on schedule kind.

Good defaults:

```text
ambient_wake
  skip old missed fires and schedule the next future fire

memory_review
  run one catch-up review for the latest relevant period

server_check
  run one immediate check after startup

research_watch
  run one catch-up check if the last successful check is stale

approval_timeout
  expire approvals that passed their deadline
```

This avoids a reboot causing a burst of stale chat messages.

## Idempotency

Every schedule fire needs a stable idempotency key.

Recommended key:

```text
schedule_id + planned_for + session_id
```

This key should protect:

- schedule_fires rows
- jobs
- ambient.wake events
- actor runs caused by the wake
- visible delivery attempts

The same due fire should not create duplicate messages after retries or reboot.

## Actor Contract

Ambient wake prompt contract:

```text
You are being woken for this chat.

This is not an instruction to send a message.
Look at the room and decide what a real friend would naturally do.

You may stay quiet, react, send one or more short messages, bring back an old
thread, ask something casual, drop a joke, generate or send a meme, follow up
on something, or spawn a helper agent.

Never mention the scheduler, cron, heartbeat, automation, or wake event.

Sound like Param: concise and witty, lowercase, modern friends in the US
chatting.
```

The actor should receive:

- wake intent
- reason
- recent raw tail
- summary
- recent proactive activity
- cooldown context
- active hours result
- relevant memory
- unfinished tasks or promises
- platform capabilities
- allowed outputs

## Output Limits

Ambient wakes should cap visible output.

Useful limits:

- max visible messages per wake
- max reactions per wake
- max proactive messages per day
- max proactive media per day
- max task agents spawned per wake
- max cost or runtime budget

The actor can request more, but validators enforce the configured limits.

## Pausing And Disabling

Trusted users should be able to pause or disable schedules.

Possible commands:

```text
param pause proactive stuff here
```

```text
param stop the friday meme thing
```

```text
param disable all schedules in this group
```

The actor can interpret natural language, but the actual change goes through
Action Review when it affects shared behavior.

Disabled schedules should remain in the database for audit unless explicitly
deleted by approved action.

## Data Model

Main tables:

- `schedules`
- `schedule_fires`
- `jobs`
- `events`
- `actor_runs`
- `actor_outputs`
- `approvals`
- `audit_log`

Detailed table shapes live in `docs/DATABASE.md`.

## Config Mapping

Relevant config:

- scheduler enabled
- ambient turns enabled
- default active hours
- default cooldowns
- default daily limits
- maximum overdue catch-up age
- schedule polling interval
- recovery scan interval
- trusted approval requirements

Detailed config shape lives in `docs/CONFIG.md`.

## Tests

The scheduler needs tests for:

- due schedule creates one fire and one job
- duplicate workers do not create duplicate fires
- ambient wake can result in `no_reply`
- cooldown blocks visible output
- active hours skip or defer wakes
- recurring proactive schedule requires approval
- reboot recovery handles overdue schedules
- catch-up does not spam old wakes
- approval timeout expires pending approval
- server health schedules do not auto-fix without Action Review
- research watch no-update result stays quiet
- actor never sees scheduler internals as visible chat text
