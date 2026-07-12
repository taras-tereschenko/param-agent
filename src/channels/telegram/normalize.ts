/**
 * Normalize raw Telegram updates into platform-neutral inbound descriptors.
 *
 * PURE: no I/O. Produces a `NormalizedInbound` (or `null` for unsupported
 * update types) and validates the produced payload against the matching
 * contract schema so malformed maps throw early.
 */

import type {
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramReactionType,
  TelegramUpdate,
  TelegramUser,
} from "@chat-adapter/telegram";

import type {
  ActorRef,
  AttachmentRef,
  MentionRef,
  PlatformRef,
  ReactionRef,
  ReplyTarget,
  TextEntity,
} from "../../contracts/common";
import {
  chatActionCallbackPayloadSchema,
  chatMessageEditedPayloadSchema,
  chatMessageReceivedPayloadSchema,
  chatReactionChangedPayloadSchema,
  type MessageMechanical,
} from "../../contracts/events";
import { idempotencyKeys, newId } from "../../contracts/ids";
import { safeJsonParse } from "../../shared/json";
import { nowIso } from "../../shared/time";
import type { AccessContext } from "./policy";

export type NormalizeContext = {
  accountId: string;
  botUserId?: string;
  botUsername?: string;
};

export type NormalizedInbound = {
  kind:
    | "chat.message.received"
    | "chat.message.edited"
    | "chat.reaction.changed"
    | "chat.action.callback";
  dedupeKey: string;
  occurredAt: string;
  source: ActorRef;
  platform: PlatformRef;
  payload: Record<string, unknown>;
  access: AccessContext;
  /** Chat title, when present, so callers can persist/update it. */
  chatTitle?: string;
};

/**
 * Local mirror of the Telegram message entity. The package defines it but does
 * not export the type, so we restate the fields we read. It is structurally
 * compatible with the (unexported) type on `TelegramMessage.entities`.
 */
type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
};

/** Fields present on the Bot API message object but not in the SDK type. */
type MessageWithReply = { reply_to_message?: TelegramMessage };

function unixToIso(seconds: number | undefined): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return nowIso();
  }
  return new Date(seconds * 1000).toISOString();
}

function toUserActor(user: TelegramUser): ActorRef {
  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || undefined;
  return {
    kind: "user",
    platform: "telegram",
    platformUserId: String(user.id),
    username: user.username,
    displayName,
    isBot: user.is_bot,
  };
}

function buildAccessContext(
  chatType: string,
  chatId: string,
  fromUserId: string | undefined,
  messageThreadId: number | undefined,
): AccessContext {
  return {
    chatType,
    chatId,
    fromUserId,
    messageThreadId:
      messageThreadId !== undefined ? String(messageThreadId) : undefined,
  };
}

function buildPlatformRef(
  accountId: string,
  access: AccessContext,
): PlatformRef {
  const platform: PlatformRef = {
    platform: "telegram",
    accountId,
    chatId: access.chatId,
    chatType: access.chatType,
  };
  if (access.messageThreadId !== undefined) {
    platform.messageThreadId = access.messageThreadId;
  }
  return platform;
}

function mapTextEntities(
  text: string | undefined,
  entities: TelegramMessageEntity[] | undefined,
): TextEntity[] | undefined {
  if (!entities || entities.length === 0) {
    return undefined;
  }
  return entities.map((entity) => {
    const mapped: TextEntity = {
      type: entity.type,
      offset: entity.offset,
      length: entity.length,
    };
    if (text !== undefined) {
      mapped.value = text.slice(entity.offset, entity.offset + entity.length);
    }
    return mapped;
  });
}

function mapMentions(
  text: string | undefined,
  entities: TelegramMessageEntity[] | undefined,
  ctx: NormalizeContext,
): MentionRef[] | undefined {
  if (!entities || entities.length === 0) {
    return undefined;
  }
  const mentions: MentionRef[] = [];
  for (const entity of entities) {
    if (entity.type === "mention") {
      const segment =
        text !== undefined
          ? text.slice(entity.offset, entity.offset + entity.length)
          : "";
      const username = segment.startsWith("@") ? segment.slice(1) : segment;
      mentions.push({
        text: segment || `@${username}`,
        username: username || undefined,
        isParam: usernamesEqual(username, ctx.botUsername),
      });
    } else if (entity.type === "text_mention" && entity.user) {
      const segment =
        text !== undefined
          ? text.slice(entity.offset, entity.offset + entity.length)
          : (entity.user.username ?? entity.user.first_name);
      mentions.push({
        text: segment,
        platformUserId: String(entity.user.id),
        username: entity.user.username,
        isParam:
          !!ctx.botUserId && String(entity.user.id) === ctx.botUserId,
      });
    }
  }
  return mentions.length > 0 ? mentions : undefined;
}

/** Telegram usernames resolve case-insensitively; compare accordingly. */
function usernamesEqual(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Does the text contain a real @mention of `username`? Word-boundary aware so
 * `@param` does NOT match `@param_ai` (a different username), and
 * case-insensitive. Usernames are [A-Za-z0-9_], so the next char must not be one.
 */
function textMentionsUsername(text: string, username: string): boolean {
  const re = new RegExp(`@${username.replace(/[^A-Za-z0-9_]/g, "")}(?![A-Za-z0-9_])`, "i");
  return re.test(text);
}

function detectMentionsParam(
  text: string | undefined,
  entities: TelegramMessageEntity[] | undefined,
  ctx: NormalizeContext,
): boolean {
  // Prefer precise entity-based detection; the raw-text check is a
  // boundary-aware, case-insensitive fallback (no @param_ai false positives).
  if (entities && text) {
    for (const entity of entities) {
      if (entity.type === "mention") {
        const segment = text.slice(entity.offset, entity.offset + entity.length);
        const name = segment.startsWith("@") ? segment.slice(1) : segment;
        if (usernamesEqual(name, ctx.botUsername)) {
          return true;
        }
      }
      if (
        entity.type === "text_mention" &&
        ctx.botUserId &&
        entity.user &&
        String(entity.user.id) === ctx.botUserId
      ) {
        return true;
      }
    }
  }
  if (ctx.botUsername && text && textMentionsUsername(text, ctx.botUsername)) {
    return true;
  }
  return false;
}

function detectCommandLike(
  text: string | undefined,
  entities: TelegramMessageEntity[] | undefined,
): boolean {
  if (entities?.some((entity) => entity.type === "bot_command")) {
    return true;
  }
  return !!text && text.startsWith("/");
}

function mapReactions(reactions: TelegramReactionType[]): ReactionRef[] {
  return reactions.map((reaction) =>
    reaction.type === "emoji"
      ? { kind: "emoji", emoji: reaction.emoji }
      : { kind: "custom_emoji", customEmojiId: reaction.custom_emoji_id },
  );
}

function extractAttachments(message: TelegramMessage): AttachmentRef[] {
  const attachments: AttachmentRef[] = [];

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1]!;
    attachments.push({
      attachmentId: newId(),
      kind: "photo",
      platformFileId: largest.file_id,
      sizeBytes: largest.file_size,
    });
  }
  if (message.document) {
    attachments.push({
      attachmentId: newId(),
      kind: "document",
      platformFileId: message.document.file_id,
      mimeType: message.document.mime_type,
      fileName: message.document.file_name,
      sizeBytes: message.document.file_size,
    });
  }
  if (message.voice) {
    attachments.push({
      attachmentId: newId(),
      kind: "voice",
      platformFileId: message.voice.file_id,
      mimeType: message.voice.mime_type,
      sizeBytes: message.voice.file_size,
    });
  }
  if (message.audio) {
    attachments.push({
      attachmentId: newId(),
      kind: "audio",
      platformFileId: message.audio.file_id,
      mimeType: message.audio.mime_type,
      fileName: message.audio.file_name,
      sizeBytes: message.audio.file_size,
    });
  }
  if (message.video) {
    attachments.push({
      attachmentId: newId(),
      kind: "video",
      platformFileId: message.video.file_id,
      mimeType: message.video.mime_type,
      fileName: message.video.file_name,
      sizeBytes: message.video.file_size,
    });
  }
  if (message.video_note) {
    attachments.push({
      attachmentId: newId(),
      kind: "video_note",
      platformFileId: message.video_note.file_id,
      sizeBytes: message.video_note.file_size,
    });
  }
  if (message.sticker) {
    attachments.push({
      attachmentId: newId(),
      kind: "sticker",
      platformFileId: message.sticker.file_id,
      caption: message.sticker.emoji,
      sizeBytes: message.sticker.file_size,
    });
  }

  return attachments;
}

function buildReplyTarget(
  message: TelegramMessage,
): ReplyTarget | undefined {
  const replyTo = (message as unknown as MessageWithReply).reply_to_message;
  if (!replyTo) {
    return undefined;
  }
  const target: ReplyTarget = {
    platformMessageId: String(replyTo.message_id),
  };
  if (replyTo.from) {
    target.sender = toUserActor(replyTo.from);
  }
  return target;
}

/**
 * Parse callback_query `data`.
 *
 * Convention: data with no ":" is a bare `actionId`. Otherwise the string is
 * split on the FIRST ":" into `actionId` and a remainder. If the remainder is
 * a JSON object it becomes `value`; anything else is wrapped as
 * `{ value: <remainder> }` so it always satisfies the contract's object shape.
 */
function coerceValue(raw: string): Record<string, unknown> {
  const parsed = safeJsonParse(raw);
  if (
    parsed.ok &&
    parsed.value !== null &&
    typeof parsed.value === "object" &&
    !Array.isArray(parsed.value)
  ) {
    return parsed.value as Record<string, unknown>;
  }
  return { value: raw };
}

function parseCallbackData(data: string | undefined): {
  actionId: string;
  surfaceId?: string;
  value?: Record<string, unknown>;
} {
  if (!data) {
    return { actionId: "callback" };
  }
  // Param UI encoder format (see src/ui/callbacks.ts buildCallbackData):
  //   cb:<surfaceId>:<actionId>[:<value>]  with each segment encodeURIComponent'd.
  if (data.startsWith("cb:")) {
    const parts = data.split(":");
    const surfaceId = parts[1] ? safeDecode(parts[1]) : undefined;
    const actionId = parts[2] ? safeDecode(parts[2]) : "callback";
    const rest = parts.slice(3).join(":");
    return {
      actionId,
      surfaceId,
      value: rest ? coerceValue(safeDecode(rest)) : undefined,
    };
  }
  // Fallback: split on the first ":" (bare actionId or actionId:remainder).
  const separatorIndex = data.indexOf(":");
  if (separatorIndex === -1) {
    return { actionId: data };
  }
  const actionId = data.slice(0, separatorIndex) || "callback";
  const remainder = data.slice(separatorIndex + 1);
  return { actionId, value: coerceValue(remainder) };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeMessage(
  message: TelegramMessage,
  ctx: NormalizeContext,
  update: TelegramUpdate,
  edited: boolean,
): NormalizedInbound {
  const text = message.text ?? message.caption;
  const entities = message.entities ?? message.caption_entities;
  const access = buildAccessContext(
    message.chat.type,
    String(message.chat.id),
    message.from ? String(message.from.id) : undefined,
    message.message_thread_id,
  );

  const source: ActorRef = message.from
    ? toUserActor(message.from)
    : {
        kind: "user",
        platform: "telegram",
        platformUserId: String(message.sender_chat?.id ?? message.chat.id),
        isBot: false,
      };

  const textEntities = mapTextEntities(text, entities);
  const attachments = extractAttachments(message);
  const replyTo = buildReplyTarget(message);
  const mentions = mapMentions(text, entities, ctx);

  let payload: Record<string, unknown>;
  let kind: NormalizedInbound["kind"];

  if (edited) {
    kind = "chat.message.edited";
    payload = chatMessageEditedPayloadSchema.parse({
      platformMessageId: String(message.message_id),
      text,
      textEntities,
      attachments: attachments.length > 0 ? attachments : undefined,
      editedAt: message.edit_date
        ? unixToIso(message.edit_date)
        : undefined,
    }) as Record<string, unknown>;
  } else {
    kind = "chat.message.received";
    const replyTargetUser = (message as unknown as MessageWithReply)
      .reply_to_message?.from;
    const mechanical: MessageMechanical = {
      mentionsParam: detectMentionsParam(text, entities, ctx),
      repliesToParam:
        !!ctx.botUserId &&
        !!replyTargetUser &&
        String(replyTargetUser.id) === ctx.botUserId,
      isDirectMessage: message.chat.type === "private",
      isGroupMessage:
        message.chat.type === "group" ||
        message.chat.type === "supergroup",
      isTopicMessage: message.message_thread_id !== undefined,
      hasCommandLikeText: detectCommandLike(text, entities),
    };
    payload = chatMessageReceivedPayloadSchema.parse({
      platformMessageId: String(message.message_id),
      text,
      textEntities,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo,
      mentions,
      mechanical,
    }) as Record<string, unknown>;
  }

  return {
    kind,
    dedupeKey: idempotencyKeys.telegramUpdate(ctx.accountId, update.update_id),
    // Use the edit time for edits so an edited older message sorts to "now" and
    // still lands in the actor's recent-events window (message.date is the
    // original post time, which would sort it into the past and be missed).
    occurredAt: unixToIso(
      edited && message.edit_date ? message.edit_date : message.date,
    ),
    source,
    platform: buildPlatformRef(ctx.accountId, access),
    payload,
    access,
    chatTitle: message.chat.title,
  };
}

function normalizeReaction(
  reaction: TelegramMessageReactionUpdated,
  ctx: NormalizeContext,
  update: TelegramUpdate,
): NormalizedInbound {
  const access = buildAccessContext(
    reaction.chat.type,
    String(reaction.chat.id),
    reaction.user ? String(reaction.user.id) : undefined,
    reaction.message_thread_id,
  );

  const source: ActorRef = reaction.user
    ? toUserActor(reaction.user)
    : {
        kind: "user",
        platform: "telegram",
        platformUserId: String(
          reaction.actor_chat?.id ?? reaction.chat.id,
        ),
        isBot: false,
      };

  const payload = chatReactionChangedPayloadSchema.parse({
    targetPlatformMessageId: String(reaction.message_id),
    oldReactions:
      reaction.old_reaction.length > 0
        ? mapReactions(reaction.old_reaction)
        : undefined,
    newReactions: mapReactions(reaction.new_reaction),
    changedBy: reaction.user ? toUserActor(reaction.user) : undefined,
  }) as Record<string, unknown>;

  return {
    kind: "chat.reaction.changed",
    dedupeKey: idempotencyKeys.telegramUpdate(ctx.accountId, update.update_id),
    occurredAt: unixToIso(reaction.date),
    source,
    platform: buildPlatformRef(ctx.accountId, access),
    payload,
    access,
    chatTitle: reaction.chat.title,
  };
}

function normalizeCallback(
  callbackQuery: TelegramCallbackQuery,
  ctx: NormalizeContext,
  update: TelegramUpdate,
): NormalizedInbound {
  const chat = callbackQuery.message?.chat;
  const access = buildAccessContext(
    chat?.type ?? "private",
    String(chat?.id ?? callbackQuery.from.id),
    String(callbackQuery.from.id),
    callbackQuery.message?.message_thread_id,
  );

  const { actionId, surfaceId, value } = parseCallbackData(callbackQuery.data);

  const payload = chatActionCallbackPayloadSchema.parse({
    callbackId: callbackQuery.id,
    surfaceId,
    actionId,
    value,
    platformMessageId: callbackQuery.message
      ? String(callbackQuery.message.message_id)
      : undefined,
  }) as Record<string, unknown>;

  return {
    kind: "chat.action.callback",
    dedupeKey: idempotencyKeys.telegramUpdate(ctx.accountId, update.update_id),
    // A button press has no timestamp of its own; the message.date is when the
    // button was originally sent, not pressed. Use now.
    occurredAt: nowIso(),
    source: toUserActor(callbackQuery.from),
    platform: buildPlatformRef(ctx.accountId, access),
    payload,
    access,
    chatTitle: callbackQuery.message?.chat.title,
  };
}

export function normalizeTelegramUpdate(
  update: TelegramUpdate,
  ctx: NormalizeContext,
): NormalizedInbound | null {
  if (update.message) {
    return normalizeMessage(update.message, ctx, update, false);
  }
  if (update.edited_message) {
    return normalizeMessage(update.edited_message, ctx, update, true);
  }
  if (update.message_reaction) {
    return normalizeReaction(update.message_reaction, ctx, update);
  }
  if (update.callback_query) {
    return normalizeCallback(update.callback_query, ctx, update);
  }
  // Unsupported update types (channel_post, edited_channel_post, ...).
  return null;
}
