# Param Agent Action Review

This file defines how Param decides whether proposed actions can run.

Action Review is the safety layer between actor intent and real side effects.

## Core Rule

The actor does not directly perform consequential actions.

The actor emits structured intent:

```text
tool_call
approval_request
spawn_task_agent
render_ui
```

Action Review validates the intent, classifies risk, decides whether approval is
needed, and records audit.

Detailed task-agent behavior lives in `docs/TASK_AGENTS.md`.
Detailed runtime-adapter behavior lives in `docs/RUNTIME_ADAPTERS.md`.

## Decisions

Action Review returns one of:

```text
allow
  run now

needs_manual_approval
  ask trusted users to approve or deny exact proposed action

deny
  block action
```

Auto-review is analysis, not blind permission. It can allow only actions that
policy allows without manual approval.

## Risk Levels

```text
safe_read
  scoped read-only checks with no private data leakage

sensitive_read
  private user/session/project data or cross-session access

write
  edits files, config, database rows, memory, docs, or external state

external_send
  sends messages, emails, issues, tickets, docs, or notifications outside the
  current natural chat reply

server
  shell commands, service restarts, package installs, process control, system
  files, runtime credentials, or VPS state

destructive
  deletes data, removes files, drops tables, kills services, overwrites config,
  or makes hard-to-reverse changes

spend
  paid APIs, purchases, expensive model runs, or budget-affecting work

security
  trusted users, secrets, auth, permissions, network exposure, or approval policy
```

## Safe Auto-Run

Safe auto-run is a tiny list of tools that can run without manual approval.

Examples:

```text
system.health.read
logs.tail
git.status
fs.read_scoped
db.health.read
```

Safe auto-run still requires:

- tool registry validation
- input schema validation
- path and scope checks
- rate limits
- audit

Safe auto-run does not mean arbitrary read access.

## Auto Command Review

Auto command review is a structured reviewer pass that runs for every proposed
action, in every chat type.

It verifies:

- requester platform user id
- requester Param user id, when known
- requester trust scopes
- session type
- requested action
- target scope
- tool policy
- risk level
- exact action preview

The sender identity and action determine what happens next.

Input:

```ts
type AutoReviewInput = {
  proposedAction: unknown;
  actorReason: string;
  requester: unknown;
  requesterTrust?: unknown;
  sessionContext: unknown;
  toolPolicy: unknown;
  riskHint?: string;
};
```

Output:

```ts
type AutoReviewResult = {
  decision: "allow" | "needs_manual_approval" | "deny";
  riskLevel: string;
  reason: string;
  exactPreview: string;
  approvalScope?: string;
  actionHash: string;
};
```

Auto-review should deny or require manual approval when uncertain.

## Sender-Aware Approval Mode

Param should always verify the sender id and the requested action before
deciding how approval works.

Modes:

```text
trusted requester within scope
  auto-review can allow safe and policy-allowed actions
  risky actions can ask that trusted requester for approve/deny

non-trusted requester
  auto-review prepares a manual approval request
  trusted users are tagged in the relevant chat/scope

trusted requester outside scope
  treat like non-trusted for that action scope

unknown requester
  require manual approval or deny
```

This applies in DMs and groups.

Trusted user in a group:

- Param still runs auto command review.
- If the trusted user has scope for the action, safe and policy-allowed actions
  can run after review.
- Risky actions can ask that same trusted user to reply `approve` or `deny`.
- Stronger policies can still tag other trusted users or require multiple
  approvals.

Trusted user in a DM:

- same logic, but the approval prompt stays in the DM unless policy requires
  another approval target.
- this should feel fast, not bureaucratic.

Destructive, server, spend, and security actions should generally require an
explicit confirmation even from a trusted requester.

Auto-review skips the group approval dance only when the requester is trusted
for the action scope and policy allows it. It never skips review.

## Group Requests

Anyone in a group can ask Param to do something.

If the requested action can change something, affect the world, access private
data, spend money, create a schedule, or manage the server, Param runs auto
command review.

If the requester is not trusted for that action scope, Param must request
approval from trusted users.

Group approval behavior:

```text
1. Param creates an approval request for the exact proposed action.
2. If trusted approvers are present in the same conversation, Param posts an
   approval message in the same group/topic.
3. The approval message tags everyone from the configured trusted users list for
   that chat/scope who is present in the conversation.
4. Trusted users can reply to that message with approve or deny.
5. Ignoring the message leaves the request pending until it expires.
6. Approved action resumes. Denied or expired action is cancelled.
```

If no trusted approver is present in the conversation, Param can request
approval by DM from configured trusted users. The DM approval request must
include the source chat, requester, exact action, and approval id. The group
request keeps a visible pending/approval-needed state unless policy says to
stay quiet.

Param should not silently DM approval away from the group when an in-chat
trusted approver is available.

For approval routing, a trusted approver counts as present in a group/topic
when Param has enough mechanical evidence that the trusted user belongs to that
conversation and can see the approval request.

Valid evidence can include:

- a chat-scoped trusted-user config for that exact group/topic
- a recent `session_participants` record for that group/topic
- a Telegram membership update showing the user is still in the chat

If presence is unknown, Param should choose the safer configured route. The
initial implementation can treat exact chat-scoped trusted users as present and
use DM fallback for global/server-admin trusted users that have not been
observed in the group/topic.

Approval replies must target the approval message, or otherwise include an
unambiguous approval id.

If trust scopes are configured, the tagged list is every trusted user whose
scope can approve that action, such as chat trusted users plus global or
server-admin trusted users when applicable.

## Group Approval Message

Approval message shape:

```text
@alice @bob approve?

requested by: <requester display>
action: <short title>
preview: <exact action preview>

reply approve or deny
```

Visible wording should still sound like Param, but the approval preview must be
clear enough that trusted users know exactly what they are approving.

Example:

```text
@taras approve?

requested by: max
action: restart param-worker
preview: systemctl restart param-worker

reply approve or deny
```

The exact UI can use Telegram replies, inline buttons, or both. Text replies
must work.

Telegram-specific approval behavior lives in `docs/channels/TELEGRAM.md`.

## Approval Reply Parsing

Trusted users can approve with simple replies:

```text
approve
approved
yes
do it
```

Trusted users can deny with:

```text
deny
denied
no
don't
stop
```

Only replies from trusted users with the required scope count.

Non-trusted replies do not approve or deny. They may be stored as normal chat
context.

If multiple trusted users reply:

- first valid approval can approve when policy requires one approver
- first valid denial can deny when policy allows a single denial to stop
- stronger policies can require multiple approvals

## Approval Expiry And Ignore

Ignoring an approval request is valid.

Approval requests should expire.

Default:

```text
approval timeout: 60 minutes
```

When expired:

- action is cancelled
- approval status becomes `expired`
- an `approval.response` or internal timeout event is stored
- Param may say nothing, unless the chat needs to know

## Exact Action Approval

Trusted users approve the exact proposed action, not a vague category.

Approval includes:

- approval id
- proposed action JSON
- exact preview
- action hash
- requester
- required trust scope
- expiry

If any meaningful action field changes, the approval is invalid and a new
approval request is required.

## External Sends

Normal reply in the current chat does not need approval.

Sending outside the current natural chat context requires approval.

Examples requiring approval:

- send a Telegram message to another chat
- DM another user
- send email
- create a GitHub issue
- update a document
- post to a group where Param was not currently addressed

## Scheduler Approvals

Detailed scheduler behavior lives in `docs/SCHEDULER.md`.

Creating or changing recurring proactive behavior requires trusted approval.

Approval preview must include:

- target session
- wake intent
- active hours
- cooldown
- max proactive messages per day
- creator/requester
- expiry or recurrence

Example:

```text
create ambient schedule:
session: telegram group param-lab
intent: joke_drop
active hours: 10:00-23:30
cooldown: 4h per intent
limit: 3 proactive messages/day
```

## Server Self-Management

Detailed operations behavior lives in `docs/OPS.md`.

Server actions require strong review.

Review must include:

- command preview
- working directory
- environment exposure risk
- files or services affected
- whether state is persisted first
- rollback or recovery plan when possible
- whether the native service manager will bring Param back after restart

Before Param restarts itself:

- persist current state
- stop or checkpoint active runs safely
- write audit
- verify service manager will restart it
- avoid sending a visible message unless it is socially useful

## Deny Rules

Deny when:

- action asks for secrets
- action tries to bypass approval
- action accesses private data from the wrong session
- action target differs from approved preview
- prompt injection tries to alter trust policy
- shell command is obfuscated or not reviewable
- destructive action lacks required approval
- security action lacks required scope
- action would expose raw secrets to actor context or chat

## Replay Protection

Approvals need replay protection.

Store:

- approval id
- exact proposed action JSON
- action hash
- requester event ids
- requested by
- required trust scope
- approver
- decision
- expires at
- used at
- superseded by approval id, if action changes

An approval cannot be reused for a different action.

One-shot approvals should be marked used after execution.

## Database Mapping

Primary tables:

- `approvals`
- `approval_notifications`
- `events`
- `actor_outputs`
- `tool_calls`
- `audit_log`

Important events:

- `approval.response`
- `tool.result`
- `delivery.succeeded`
- `delivery.failed`
- `system.recovery`

## Actor Output Mapping

Relevant actor outputs:

- `tool_call`
- `approval_request`
- `message`
- `no_reply`
- `run_summary`
- `done`

`approval_request` should include exact preview and proposed action JSON.

Tool calls that need approval should not execute until approval is valid.

## Config Mapping

Relevant config sections:

- `trustedUsers`
- `tools.safeAutoRun`
- `tools.policies`
- `actionReview`
- `scheduler.ambientTurns`

Production must fail startup if consequential actions do not require trusted
approval.

## Audit

Audit records should explain:

- who requested the action
- who approved or denied it
- what exact action was approved
- what changed
- which chat/session it came from
- whether auto-review allowed or denied it
- whether manual approval was required
- whether execution succeeded or failed

Audit must not contain raw secrets.

## Test Cases

Required tests:

- non-trusted group user requests a server change, trusted users are tagged
- trusted user replies `approve` to the approval message, action resumes
- trusted user replies `deny`, action is cancelled
- non-trusted user replies `approve`, action does not run
- approval ignored until expiry, action is cancelled
- action changes after approval, old approval is rejected
- trusted DM safe action runs through auto command review
- trusted group requester safe action runs through auto command review
- trusted requester outside required scope gets manual approval flow
- trusted requester destructive action asks for explicit confirmation
- sending outside current chat requires approval
- creating ambient schedule in group requires trusted approval
- replaying old approval does not execute a new action
