# Param Agent Telegram Channel

This file defines how Param integrates with Telegram.

Core principle:

```text
Telegram details stay in the Telegram channel adapter. Param core sees durable
events.
```

## Purpose

Telegram is Param's first communication channel.

The Telegram channel adapter is responsible for:

- receiving Telegram updates
- mapping them into Param events
- preserving raw Telegram payloads
- resolving platform routing facts
- sending messages, reactions, files, buttons, and Mini App links
- validating Telegram-specific limits
- retrying delivery safely
- hiding Telegram-specific details from the actor and orchestrator

Param uses the Chat SDK as the messenger layer, then maps SDK events into
Param's own durable event contracts.

The Chat SDK can normalize messenger concepts. Param still needs its own schema
for sessions, actor runs, batching, approvals, memory, delivery, and audit.

## Ownership Boundary

The Telegram channel adapter owns:

- bot account setup
- polling or webhook transport
- Telegram update offsets
- raw Telegram payload storage
- Telegram chat/message/topic ids
- Telegram-specific delivery params
- reaction availability
- file/media identifiers
- callback query payloads
- Mini App result payloads
- Telegram API retry handling

The Telegram channel adapter does not own:

- whether Param should reply
- memory writes
- action approval
- task-agent spawning policy
- scheduler behavior
- runtime adapter behavior
- visible chat personality
- trusted-user authority

The actor decides meaning. The channel adapter moves Telegram data safely.

## Transport Modes

Telegram supports two mutually exclusive update transports:

```text
polling
  Param asks Telegram for updates through getUpdates

webhook
  Telegram sends HTTPS POST requests to Param
```

Default for the VPS:

```text
polling
```

Polling works well on a private VPS because it only needs outbound network
access. It does not need a public HTTPS endpoint.

Webhook mode remains supported for deployments that need Telegram to push
updates to Param. Webhook mode requires public HTTPS and a webhook secret token.

## Polling Mode

Polling mode uses `getUpdates`.

Polling responsibilities:

- keep the latest confirmed `update_id`
- request updates with an offset greater than the highest processed update
- persist updates before confirming the next offset
- use a single active poller per bot account
- recover after restart without duplicating processed updates
- handle Telegram/network errors with backoff
- respect configured `allowedUpdates`

The adapter should treat `update_id` as the primary Telegram dedupe key.

Recommended idempotency key:

```text
telegram:update:<bot-account-id>:<update-id>
```

Polling should use a durable account-level lock so two Param processes do not
consume the same bot token at once.

## Webhook Mode

Webhook mode uses `setWebhook`.

Webhook responsibilities:

- require `publicBaseUrl`
- require webhook secret token
- validate Telegram's secret header
- persist the update before returning success
- return non-2xx only when Telegram should retry
- dedupe by `update_id`
- expose health/debug information for pending webhook errors

Webhook mode should not be enabled at the same time as polling for the same bot
account.

Switching modes should be explicit and audited.

## Allowed Updates

`allowedUpdates` should be configured deliberately.

Initial useful update types:

```text
message
edited_message
message_reaction
message_reaction_count
callback_query
my_chat_member
chat_member
```

Notes:

- `message_reaction` and `message_reaction_count` need explicit subscription.
- Some update types require the bot to be an administrator in the chat.
- `my_chat_member` helps detect when the bot is added, removed, blocked, or
  permission-changed.
- `chat_member` can be useful later for group membership and trusted-user
  context, but it should be enabled only when needed.

The adapter should preserve unexpected update types as raw payloads when
possible, even if Param does not act on them yet.

## Raw Payload Preservation

Every Telegram update should be persisted before actor work starts.

Store:

- bot account id
- update id
- update type
- raw update body or raw payload ref
- chat id
- chat type
- message id
- message thread id
- sender user id
- sender username/display name
- reply target
- entities and mentions
- files/media identifiers
- reaction data
- callback query id
- Mini App data, if present
- received time

Raw payloads are evidence and replay data. They are not the main API for core
modules.

## Event Mapping

Telegram or Chat SDK events map into Param event types.

```text
message -> chat.message.received
edited_message -> chat.message.edited
message delete signal, if available -> chat.message.deleted
message_reaction -> chat.reaction.changed
message_reaction_count -> chat.reaction.changed or platform-specific raw event
callback_query -> chat.action.callback
web_app_data or Mini App result -> chat.mini_app.result
my_chat_member -> internal platform membership event
chat_member -> internal platform membership event
delivery result -> delivery.succeeded or delivery.failed
```

The adapter may add mechanical facts:

- direct message
- group message
- topic message
- mentions Param
- replies to Param
- command-like text
- sender id
- chat velocity inputs
- attachment types

Mechanical facts are not social interpretation.

## Session Routing

Telegram session keys:

```text
private chat:
  telegram:dm:<telegram-user-id>

group chat:
  telegram:group:<telegram-chat-id>

forum topic:
  telegram:group:<telegram-chat-id>:topic:<message-thread-id>
```

Routing should use stable Telegram ids, not display names.

Forum topics must preserve `message_thread_id` so separate topic conversations
do not collapse into one group session.

Cross-session links should be explicit:

- approval in DM can approve a group request
- task session reports to parent Telegram session
- Mini App result belongs to parent Telegram session or UI session

## Message Intake

Incoming messages can contain:

- text
- entities
- mentions
- replies
- photos
- videos
- documents
- stickers
- voice/audio
- locations
- contacts
- polls
- service messages

The adapter should normalize what Param can use now and preserve the rest as
raw payload.

Text should be stored as plain text plus entities. Do not depend on Telegram
parse modes for internal representation.

Attachments should become `AttachmentRef` entries with Telegram file ids or
download refs.

## Mentions And Replies

Mentions and replies are mechanical priority signals.

The adapter should detect:

- explicit username mention of the bot
- command addressed to the bot
- reply to a Param message
- reply chain target message id
- direct message to Param

These signals feed:

- batching bypass
- strong steering classification
- actor context
- approval parsing
- delivery reply target

The actor still decides whether the moment calls for a reply.

## Groups And Ambient Participation

In groups, Param should feel like a participant, not a command bot.

The Telegram channel adapter helps by providing mechanical inputs:

- message velocity
- active participant count
- mentions/replies
- recent Param message ids
- topic id
- reaction availability
- pending approvals
- whether Param can post/reply/react

Group chatter can be batched. Mentions, replies to Param, approvals, commands,
and urgent trusted controls bypass batching.

The adapter should never force a visible reply just because a message arrived.

## Live Steering Inputs

Same-session Telegram messages that arrive during an active run become steering
inbox items.

The adapter contributes facts:

- same chat/topic
- sender id
- reply target
- mentions Param
- approval response target
- message timestamp
- platform message id

The orchestrator classifies steering priority. The actor decides meaning.

## Delivery Outputs

Actor outputs map to Telegram delivery:

```text
message -> sendMessage or media send method
react_to_message -> setMessageReaction
render_ui -> inline keyboard, card-like message, or Mini App link
approval_request -> reply/buttons in current approval target
```

Delivery should store:

- output id
- Telegram method
- target chat id
- message thread id
- reply parameters
- payload hash
- platform message id on success
- error code/message on failure
- retry count

Actor outputs are intent. Telegram delivery attempts are side effects.

## Text Messages

Telegram text messages have platform limits.

The adapter should:

- enforce Telegram text length limits
- split long visible text only when the actor output allows it
- preserve one actor `message` output as one chat bubble by default
- avoid parse modes for ordinary Param chat voice
- use reply parameters when replying to a specific message
- include `message_thread_id` for topic replies
- store the returned Telegram message id

If a message is too long for normal chat style, the style guard should usually
fix it before delivery.

## Reactions

Param can react when a small gesture is more natural than a message.

Reaction rules:

- reactions are not read receipts
- do not react to every message Param reads
- validate reaction emoji against `available_reactions` when known
- reaction limits apply only to `react_to_message`
- normal text messages can use any emoji the model writes
- if reaction availability is unknown, use a conservative default or skip
- failed reaction delivery should not crash the actor run

Reaction output should target a specific event/message.

The adapter should maintain a per-chat reaction capability cache when Telegram
exposes the data.

## Files And Media

Telegram media should become artifacts or attachments.

Incoming media:

- preserve Telegram `file_id` and metadata
- download only when needed
- store downloaded files under artifact policy
- scan/validate file type when appropriate
- avoid exposing file contents to the actor unless selected by Context Builder

Outgoing media:

- send only artifacts selected by the actor/UI renderer
- keep captions short and style-checked
- preserve returned platform message ids
- avoid paid/broadcast options unless explicitly approved

Large files may require future local Bot API server support, but the default
design uses Telegram's cloud Bot API.

## Inline Buttons And Callbacks

Inline buttons are useful for:

- approvals
- choices
- compact UI actions
- opening Mini Apps
- retry/cancel controls

Callback data must be durable.

Do not trust callback payload text alone. Store server-side callback metadata:

- surface id
- action id
- session id
- user/sender constraints
- approval id, if any
- created time
- expiry
- expected value schema

When a callback arrives:

```text
callback_query -> validate metadata -> chat.action.callback -> actor/action flow
```

If the callback triggers a consequential action, it goes through Action Review.

## Approvals In Telegram

Group action approvals should stay visible in the group by default.

For non-trusted requester in a group:

```text
1. Param posts approval request in the same group/topic.
2. Approval message tags trusted users for that scope.
3. Trusted users reply approve/deny or press a validated button.
4. Adapter maps the response to approval.response.
5. Action Review verifies approver identity and exact action.
```

Trusted users in DMs or groups can use auto-review paths within their trust
scope, but risky actions can still require explicit confirmation.

Approval parsing must verify:

- Telegram user id
- target approval id
- reply target or callback metadata
- expiry
- exact proposed action

## Mini Apps

Telegram Mini Apps are the path for richer dynamic UI.

Shared UI behavior lives in `docs/UI.md`.

Use cases:

- forms
- dashboards
- generated controls
- visual task status
- image/media selection
- multi-step approvals
- structured settings

Mini Apps require public HTTPS for the web surface.

Polling mode can still be used for bot updates while Mini Apps use public HTTPS
for the UI page.

Initial launch modes should be inline buttons and direct links. Other Telegram
launch surfaces can be added through the same UI Renderer contract.

Mini App results become `chat.mini_app.result` or UI-surface events after
server-side validation.

The UI Renderer owns the UI spec. The Telegram channel adapter owns launch
links, Telegram init data validation, and Telegram delivery mechanics.

## Commands

Slash commands are mechanical hints, not a separate personality.

Examples:

```text
/start
/help
/settings
/approve
/deny
```

The adapter should map commands into events with `hasCommandLikeText`.

Param can answer naturally instead of sounding like a command menu.

Admin/config commands still go through Action Review when they change state.

## Bot Permissions

The adapter should track what Param can do in each chat:

- send messages
- read messages available to the bot
- react to messages
- post in topics
- manage topics, if ever needed
- see reaction updates
- receive member updates
- delete messages, if ever allowed

Permission changes become internal events or platform metadata updates.

If Param lacks a capability, the Platform Capability Layer should tell the
actor so it does not request impossible output.

## Delivery Retry

Telegram delivery can fail.

Retryable cases:

- network errors
- rate limits
- temporary Telegram errors
- transient webhook/polling conflicts

Non-retryable or policy-blocking cases:

- bot blocked
- chat not found
- message too long after validation
- permission denied
- invalid callback metadata
- action no longer approved

Delivery retries must be idempotent.

Never duplicate visible messages just because a retry worker ran twice.

## Reboot Recovery

After restart, the Telegram channel adapter should inspect:

- polling account locks
- latest processed update id
- undelivered actor outputs
- delivery attempts stuck in running
- webhook mode state, if enabled
- pending approvals waiting for Telegram replies
- platform chats seen but not linked to sessions

Recovery should not drop new updates and should not replay already delivered
messages.

## Privacy And Security

Rules:

- bot tokens live in `.env` or secret refs
- raw Telegram payloads can contain personal data
- raw payload access is admin/debug only
- private DM data does not leak into groups
- group claims do not become private user memory automatically
- callback data is untrusted
- Mini App init data must be validated server-side
- file downloads should be scoped and audited

## Data Model

Main tables:

- `channel_accounts`
- `platform_chats`
- `sessions`
- `session_participants`
- `events`
- `raw_payloads`
- `actor_outputs`
- `delivery_attempts`
- `approvals`
- `approval_notifications`
- `artifacts`
- `audit_log`

Detailed table shapes live in `docs/DATABASE.md`.

## Config Mapping

Relevant config:

- bot token secret ref
- transport mode
- polling timeout
- polling limit
- webhook URL
- webhook secret token
- allowed updates
- default parse mode
- reaction support
- file download policy
- delivery retry policy
- Mini App public base URL
- trusted users by Telegram id

Detailed config shape lives in `docs/CONFIG.md`.

## Contract Mapping

Relevant contracts:

- `ParamEvent`
- `PlatformRef`
- `RawPayloadRef`
- `ChatMessageReceivedPayload`
- `ChatReactionChangedPayload`
- `ChatActionCallbackPayload`
- `MiniAppResultPayload`
- `MessageOutputPayload`
- `ReactToMessageOutputPayload`
- `RenderUiOutputPayload`

Detailed contract shapes live in `docs/CONTRACTS.md`.

## Tests

Telegram channel adapter tests should cover:

- polling persists update before advancing offset
- duplicate update id does not duplicate events
- polling and webhook cannot both run for one account
- webhook secret token is validated
- message maps to `chat.message.received`
- edited message links to original event when known
- forum topic routes to topic session
- mention bypasses batching
- reply to Param becomes strong steering input
- reaction update maps to `chat.reaction.changed`
- reaction output validates against available reactions
- text emoji is not restricted by reaction list
- callback query validates server-side metadata
- group approval reply maps to `approval.response`
- non-trusted approval reply is rejected
- file attachment becomes artifact/attachment ref
- Mini App result validates before actor sees it
- delivery retry does not duplicate Telegram messages
- reboot recovery does not lose or replay updates
