import { describe, expect, test } from "bun:test";
import type { TelegramUpdate } from "@chat-adapter/telegram";

import {
  BotApiTransport,
  buildRawPayloadRef,
  buildSendMessageParams,
  evaluateTelegramAccess,
  normalizeTelegramUpdate,
  TelegramChannelAdapter,
  type NormalizedInbound,
  type SendMessageParams,
  type SetMessageReactionParams,
  type AnswerCallbackQueryParams,
  type TelegramAccessLists,
  type TelegramTransport,
} from "../../src/channels/index";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const BOT_USER_ID = "999";
const BOT_USERNAME = "parambot";
const ACCOUNT_ID = "main";

function makeLists(
  overrides: Partial<TelegramAccessLists> = {},
): TelegramAccessLists {
  return {
    allowedPrivateUserIds: [],
    allowedGroupChatIds: [],
    allowedTopicIds: [],
    ...overrides,
  };
}

function privateMessageUpdate(
  updateId: number,
  fromId: string,
  text: string,
): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId * 10,
      date: 1_700_000_000,
      chat: { id: Number(fromId), type: "private" },
      from: { id: Number(fromId), is_bot: false, first_name: "User" },
      text,
    },
  } as unknown as TelegramUpdate;
}

/* -------------------------------------------------------------------------- */
/* Fake transport                                                             */
/* -------------------------------------------------------------------------- */

class FakeTransport implements TelegramTransport {
  readonly sent: SendMessageParams[] = [];
  readonly reactions: SetMessageReactionParams[] = [];
  readonly answered: AnswerCallbackQueryParams[] = [];

  constructor(private readonly scripted: TelegramUpdate[]) {}

  async getUpdates(): Promise<TelegramUpdate[]> {
    return this.scripted;
  }

  async sendMessage(
    params: SendMessageParams,
  ): Promise<{ messageId: string }> {
    this.sent.push(params);
    return { messageId: "sent-1" };
  }

  async setMessageReaction(params: SetMessageReactionParams): Promise<void> {
    this.reactions.push(params);
  }

  async answerCallbackQuery(
    params: AnswerCallbackQueryParams,
  ): Promise<void> {
    this.answered.push(params);
  }

  async getMe(): Promise<{ id: string; username?: string }> {
    return { id: BOT_USER_ID, username: BOT_USERNAME };
  }
}

/* -------------------------------------------------------------------------- */
/* Access policy                                                              */
/* -------------------------------------------------------------------------- */

describe("evaluateTelegramAccess", () => {
  test("allows an allow-listed private user", () => {
    const decision = evaluateTelegramAccess(
      { chatType: "private", chatId: "111", fromUserId: "111" },
      makeLists({ allowedPrivateUserIds: ["111"] }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.routeType).toBe("dm");
  });

  test("denies a non-listed private user", () => {
    const decision = evaluateTelegramAccess(
      { chatType: "private", chatId: "222", fromUserId: "222" },
      makeLists({ allowedPrivateUserIds: ["111"] }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.routeType).toBe("dm");
    expect(decision.reason).toContain("222");
  });

  test("allows an allow-listed group", () => {
    const decision = evaluateTelegramAccess(
      { chatType: "supergroup", chatId: "-100", fromUserId: "111" },
      makeLists({ allowedGroupChatIds: ["-100"] }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.routeType).toBe("group");
  });

  test("denies a non-listed group", () => {
    const decision = evaluateTelegramAccess(
      { chatType: "group", chatId: "-200", fromUserId: "111" },
      makeLists({ allowedGroupChatIds: ["-100"] }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("gates topics when allowedTopicIds is set", () => {
    const lists = makeLists({
      allowedGroupChatIds: ["-100"],
      allowedTopicIds: [{ chatId: "-100", topicId: "7" }],
    });

    const allowed = evaluateTelegramAccess(
      { chatType: "supergroup", chatId: "-100", messageThreadId: "7" },
      lists,
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.routeType).toBe("topic");

    const denied = evaluateTelegramAccess(
      { chatType: "supergroup", chatId: "-100", messageThreadId: "8" },
      lists,
    );
    expect(denied.allowed).toBe(false);
    expect(denied.routeType).toBe("topic");

    // A no-thread ("General") message in a topic-restricted chat is NOT in an
    // allow-listed topic, so it must be denied too (not slip through the group
    // allow-list).
    const general = evaluateTelegramAccess(
      { chatType: "supergroup", chatId: "-100" },
      lists,
    );
    expect(general.allowed).toBe(false);
  });

  test("allows any topic in an allowed group when no topics are listed", () => {
    const decision = evaluateTelegramAccess(
      { chatType: "supergroup", chatId: "-100", messageThreadId: "42" },
      makeLists({ allowedGroupChatIds: ["-100"] }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.routeType).toBe("topic");
  });

  test("denies channels by default", () => {
    const decision = evaluateTelegramAccess(
      { chatType: "channel", chatId: "-300" },
      makeLists({ allowedGroupChatIds: ["-300"] }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.routeType).toBe("channel");
  });
});

/* -------------------------------------------------------------------------- */
/* Normalization                                                              */
/* -------------------------------------------------------------------------- */

describe("normalizeTelegramUpdate", () => {
  const ctx = {
    accountId: ACCOUNT_ID,
    botUserId: BOT_USER_ID,
    botUsername: BOT_USERNAME,
  };

  test("maps a private text message to chat.message.received", () => {
    const inbound = normalizeTelegramUpdate(
      privateMessageUpdate(101, "111", "hello there"),
      ctx,
    );
    expect(inbound).not.toBeNull();
    const value = inbound as NormalizedInbound;
    expect(value.kind).toBe("chat.message.received");
    expect(value.dedupeKey).toBe(`telegram:update:${ACCOUNT_ID}:101`);
    expect(value.access.chatType).toBe("private");

    const mechanical = value.payload.mechanical as Record<string, boolean>;
    expect(mechanical.isDirectMessage).toBe(true);
    expect(mechanical.isGroupMessage).toBe(false);
    expect(mechanical.mentionsParam).toBe(false);
    expect(value.payload.text).toBe("hello there");
    expect(value.source.kind).toBe("user");
  });

  test("detects a bot mention in a group message", () => {
    const update = {
      update_id: 102,
      message: {
        message_id: 1020,
        date: 1_700_000_000,
        chat: { id: -100, type: "supergroup" },
        from: { id: 111, is_bot: false, first_name: "User" },
        text: "hey @parambot help",
        entities: [{ type: "mention", offset: 4, length: 9 }],
      },
    } as unknown as TelegramUpdate;

    const inbound = normalizeTelegramUpdate(update, ctx) as NormalizedInbound;
    const mechanical = inbound.payload.mechanical as Record<string, boolean>;
    expect(mechanical.mentionsParam).toBe(true);
    expect(mechanical.isGroupMessage).toBe(true);
    const mentions = inbound.payload.mentions as { isParam: boolean }[];
    expect(mentions[0]?.isParam).toBe(true);
  });

  test("does NOT false-positive @parambot_extra as a mention of @parambot", () => {
    const update = {
      update_id: 1021,
      message: {
        message_id: 1021,
        date: 1_700_000_000,
        chat: { id: -100, type: "supergroup" },
        from: { id: 111, is_bot: false, first_name: "User" },
        text: "hey @parambot_extra look",
        entities: [{ type: "mention", offset: 4, length: 15 }],
      },
    } as unknown as TelegramUpdate;
    const inbound = normalizeTelegramUpdate(update, ctx) as NormalizedInbound;
    const mechanical = inbound.payload.mechanical as Record<string, boolean>;
    expect(mechanical.mentionsParam).toBe(false);
  });

  test("detects a case-insensitive bot mention (@ParamBot)", () => {
    const update = {
      update_id: 1022,
      message: {
        message_id: 1022,
        date: 1_700_000_000,
        chat: { id: -100, type: "supergroup" },
        from: { id: 111, is_bot: false, first_name: "User" },
        text: "hey @ParamBot help",
        entities: [{ type: "mention", offset: 4, length: 9 }],
      },
    } as unknown as TelegramUpdate;
    const inbound = normalizeTelegramUpdate(update, ctx) as NormalizedInbound;
    const mechanical = inbound.payload.mechanical as Record<string, boolean>;
    expect(mechanical.mentionsParam).toBe(true);
  });

  test("detects a reply to the bot", () => {
    const update = {
      update_id: 103,
      message: {
        message_id: 1030,
        date: 1_700_000_000,
        chat: { id: -100, type: "supergroup" },
        from: { id: 111, is_bot: false, first_name: "User" },
        text: "yes",
        reply_to_message: {
          message_id: 900,
          date: 1_699_999_000,
          chat: { id: -100, type: "supergroup" },
          from: { id: Number(BOT_USER_ID), is_bot: true, first_name: "Param" },
          text: "question?",
        },
      },
    } as unknown as TelegramUpdate;

    const inbound = normalizeTelegramUpdate(update, ctx) as NormalizedInbound;
    const mechanical = inbound.payload.mechanical as Record<string, boolean>;
    expect(mechanical.repliesToParam).toBe(true);
    const replyTo = inbound.payload.replyTo as { platformMessageId: string };
    expect(replyTo.platformMessageId).toBe("900");
  });

  test("returns null for an unsupported update", () => {
    const inbound = normalizeTelegramUpdate(
      { update_id: 104 } as unknown as TelegramUpdate,
      ctx,
    );
    expect(inbound).toBeNull();
  });

  test("maps a message_reaction to chat.reaction.changed", () => {
    const update = {
      update_id: 105,
      message_reaction: {
        chat: { id: -100, type: "supergroup" },
        message_id: 1050,
        date: 1_700_000_000,
        user: { id: 111, is_bot: false, first_name: "User" },
        old_reaction: [],
        new_reaction: [{ type: "emoji", emoji: "👍" }],
      },
    } as unknown as TelegramUpdate;

    const inbound = normalizeTelegramUpdate(update, ctx) as NormalizedInbound;
    expect(inbound.kind).toBe("chat.reaction.changed");
    expect(inbound.payload.targetPlatformMessageId).toBe("1050");
    const newReactions = inbound.payload.newReactions as {
      kind: string;
      emoji?: string;
    }[];
    expect(newReactions[0]?.emoji).toBe("👍");
  });

  test("maps a callback_query to chat.action.callback", () => {
    const update = {
      update_id: 106,
      callback_query: {
        id: "cb-1",
        chat_instance: "ci-1",
        from: { id: 111, is_bot: false, first_name: "User" },
        data: 'approve:{"decision":"yes"}',
        message: {
          message_id: 1060,
          date: 1_700_000_000,
          chat: { id: 111, type: "private" },
        },
      },
    } as unknown as TelegramUpdate;

    const inbound = normalizeTelegramUpdate(update, ctx) as NormalizedInbound;
    expect(inbound.kind).toBe("chat.action.callback");
    expect(inbound.payload.callbackId).toBe("cb-1");
    expect(inbound.payload.actionId).toBe("approve");
    expect(inbound.payload.value).toEqual({ decision: "yes" });
    expect(inbound.payload.platformMessageId).toBe("1060");
  });
});

/* -------------------------------------------------------------------------- */
/* Send shaping                                                               */
/* -------------------------------------------------------------------------- */

describe("buildSendMessageParams", () => {
  test("includes chat_id and text", () => {
    const params = buildSendMessageParams("hi", { chatId: "111" });
    expect(params.chat_id).toBe("111");
    expect(params.text).toBe("hi");
    expect(params.message_thread_id).toBeUndefined();
    expect(params.reply_parameters).toBeUndefined();
  });

  test("sets message_thread_id when present", () => {
    const params = buildSendMessageParams("hi", {
      chatId: "-100",
      messageThreadId: "7",
    });
    expect(params.message_thread_id).toBe("7");
  });

  test("sets reply_parameters when a reply target is present", () => {
    const params = buildSendMessageParams("hi", {
      chatId: "-100",
      replyToPlatformMessageId: "900",
    });
    expect(params.reply_parameters).toEqual({ message_id: 900 });
  });
});

/* -------------------------------------------------------------------------- */
/* Adapter polling                                                            */
/* -------------------------------------------------------------------------- */

describe("TelegramChannelAdapter.pollOnce", () => {
  test("handles allowed updates, skips unauthorized ones, advances offset", async () => {
    const transport = new FakeTransport([
      privateMessageUpdate(500, "111", "allowed"),
      privateMessageUpdate(501, "222", "unauthorized"),
    ]);

    const handled: NormalizedInbound[] = [];
    const adapter = new TelegramChannelAdapter({
      accountId: ACCOUNT_ID,
      transport,
      accessLists: makeLists({ allowedPrivateUserIds: ["111"] }),
      unauthorizedBehavior: "ignore",
      botUserId: BOT_USER_ID,
      botUsername: BOT_USERNAME,
      async onInbound(inbound) {
        handled.push(inbound);
      },
    });

    const result = await adapter.pollOnce(undefined);

    expect(result.handled).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.nextOffset).toBe(502);
    expect(handled).toHaveLength(1);
    expect(handled[0]?.access.fromUserId).toBe("111");
  });

  test("handleUpdate ingests one allowed update (webhook intake path)", async () => {
    const transport = new FakeTransport([]);
    const handled: NormalizedInbound[] = [];
    const adapter = new TelegramChannelAdapter({
      accountId: ACCOUNT_ID,
      transport,
      accessLists: makeLists({ allowedPrivateUserIds: ["111"] }),
      unauthorizedBehavior: "ignore",
      botUserId: BOT_USER_ID,
      botUsername: BOT_USERNAME,
      async onInbound(inbound) {
        handled.push(inbound);
      },
    });

    const allowed = await adapter.handleUpdate(
      privateMessageUpdate(900, "111", "hi via webhook"),
    );
    expect(allowed).toBe(true);
    expect(handled).toHaveLength(1);

    // Unauthorized user is dropped (not handed to onInbound).
    const denied = await adapter.handleUpdate(
      privateMessageUpdate(901, "222", "forbidden"),
    );
    expect(denied).toBe(false);
    expect(handled).toHaveLength(1);
  });

  test("sender delivers text through the transport", async () => {
    const transport = new FakeTransport([]);
    const adapter = new TelegramChannelAdapter({
      accountId: ACCOUNT_ID,
      transport,
      accessLists: makeLists(),
      unauthorizedBehavior: "ignore",
      async onInbound() {},
    });

    await adapter.sender.sendText("hello", { chatId: "111" });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).toBe("hello");
  });

  test("sender delivers a UI surface with inline buttons", async () => {
    const transport = new FakeTransport([]);
    const adapter = new TelegramChannelAdapter({
      accountId: ACCOUNT_ID,
      transport,
      accessLists: makeLists(),
      unauthorizedBehavior: "ignore",
      async onInbound() {},
    });

    await adapter.sender.sendUi(
      {
        text: "Pick one",
        inlineButtons: [
          { text: "Yes", callbackData: "cb:s1:yes" },
          { text: "No", callbackData: "cb:s1:no" },
        ],
      },
      { chatId: "111", messageThreadId: "7" },
    );

    expect(transport.sent).toHaveLength(1);
    const params = transport.sent[0]!;
    expect(params.text).toBe("Pick one");
    expect(params.message_thread_id).toBe("7");
    const row = params.reply_markup?.inline_keyboard[0];
    expect(row).toEqual([
      { text: "Yes", callback_data: "cb:s1:yes" },
      { text: "No", callback_data: "cb:s1:no" },
    ]);
  });

  test("sender sends a buttonless UI surface as a plain message", async () => {
    const transport = new FakeTransport([]);
    const adapter = new TelegramChannelAdapter({
      accountId: ACCOUNT_ID,
      transport,
      accessLists: makeLists(),
      unauthorizedBehavior: "ignore",
      async onInbound() {},
    });

    await adapter.sender.sendUi({ text: "status: ok" }, { chatId: "111" });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).toBe("status: ok");
    expect(transport.sent[0]?.reply_markup).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Raw store                                                                  */
/* -------------------------------------------------------------------------- */

describe("buildRawPayloadRef", () => {
  test("captures the update sub-type and a stable hash", () => {
    const ref = buildRawPayloadRef(privateMessageUpdate(700, "111", "hi"));
    expect(ref.provider).toBe("telegram");
    expect(ref.kind).toBe("message");
    expect(ref.storage).toBe("inline");
    expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Referenced to keep the production Bot API transport in the compiled graph.
export const _transportType: typeof BotApiTransport = BotApiTransport;
