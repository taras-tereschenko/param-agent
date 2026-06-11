# Param Agent Communication Channels

This file defines Param's channel abstraction.

Core principle:

```text
Channels move conversation in and out. Param decides what it means.
```

## Purpose

Communication channels are the surfaces where people interact with Param.

Examples:

- Telegram
- WhatsApp
- Slack
- Discord
- email
- voice or meeting surfaces

Each channel is implemented by a channel adapter.

## Channel Adapter

A channel adapter owns platform-specific send/receive behavior.

Responsibilities:

- receive platform activity
- map platform activity into Param events
- preserve raw payloads for audit and replay
- send visible outputs back to the platform
- expose platform capabilities
- validate platform-specific limits
- retry delivery safely
- keep platform ids out of core logic where possible

The adapter does not decide whether Param should speak. The actor decides that.

## Shared Channel Contract

Every channel adapter should provide the same core shape:

```text
inbound platform event -> ParamEvent
ActorOutput -> delivery attempt -> platform result event
```

Shared concepts:

- account id
- platform user id
- platform chat/thread id
- message id
- reply target
- mentions
- attachments
- reactions or equivalents
- action callbacks
- UI surface callbacks
- delivery result

## Session Routing

Channels provide stable platform facts. The orchestrator turns those facts into
Param sessions.

Examples:

```text
telegram dm -> telegram:dm:<user-id>
telegram group -> telegram:group:<chat-id>
telegram topic -> telegram:group:<chat-id>:topic:<topic-id>
future slack thread -> slack:channel:<channel-id>:thread:<thread-id>
future email thread -> email:thread:<thread-id>
```

The routing algorithm is deterministic code.

## Platform Capabilities

Each channel exposes capabilities to the actor through the prompt packet.

Examples:

- can send messages
- can reply to a message
- can react
- can upload files
- can show buttons
- can launch a Telegram Mini App
- can receive callbacks
- max message length
- available reaction set
- whether public HTTPS is configured

The actor should not request outputs the channel cannot support.

## First Channel

Telegram is the first concrete channel.

Detailed behavior lives in `docs/channels/TELEGRAM.md`.
