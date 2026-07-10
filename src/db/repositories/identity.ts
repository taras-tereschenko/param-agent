import { and, eq, isNull } from "drizzle-orm";

import type { JsonObject } from "../schema";
import type { ParamDb } from "../client";
import {
  channelAccounts,
  platformChats,
  sessionParticipants,
  userAccounts,
  users,
} from "../schema";

export async function ensureChannelAccount(
  db: ParamDb,
  platform: string,
  label: string,
  config: JsonObject = {},
): Promise<{ id: string }> {
  const [row] = await db
    .insert(channelAccounts)
    .values({ platform, label, config })
    .onConflictDoUpdate({
      target: [channelAccounts.platform, channelAccounts.label],
      set: { updatedAt: new Date() },
    })
    .returning({ id: channelAccounts.id });
  if (!row) {
    throw new Error(`channel account upsert failed: ${platform}/${label}`);
  }
  return row;
}

export type UpsertUserAccountInput = {
  platform: string;
  platformUserId: string;
  username?: string | null;
  displayName?: string | null;
  isBot?: boolean;
  rawProfile?: JsonObject;
};

/**
 * Upsert a platform account and its owning person identity. Creates the `users`
 * row lazily the first time an account is seen.
 */
export async function upsertUserAccount(
  db: ParamDb,
  input: UpsertUserAccountInput,
): Promise<{ userId: string; accountId: string }> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(userAccounts)
    .where(
      and(
        eq(userAccounts.platform, input.platform),
        eq(userAccounts.platformUserId, input.platformUserId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(userAccounts)
      .set({
        username: input.username ?? existing.username,
        displayName: input.displayName ?? existing.displayName,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(userAccounts.id, existing.id));
    return { userId: existing.userId, accountId: existing.id };
  }

  const [user] = await db
    .insert(users)
    .values({ displayName: input.displayName ?? null })
    .returning({ id: users.id });
  if (!user) {
    throw new Error("user insert failed");
  }

  const [account] = await db
    .insert(userAccounts)
    .values({
      userId: user.id,
      platform: input.platform,
      platformUserId: input.platformUserId,
      username: input.username ?? null,
      displayName: input.displayName ?? null,
      isBot: input.isBot ?? false,
      rawProfile: input.rawProfile,
    })
    .onConflictDoUpdate({
      target: [userAccounts.platform, userAccounts.platformUserId],
      set: { lastSeenAt: now, updatedAt: now },
    })
    .returning({ id: userAccounts.id, userId: userAccounts.userId });
  if (!account) {
    throw new Error("user account insert failed");
  }
  return { userId: account.userId, accountId: account.id };
}

export type UpsertPlatformChatInput = {
  platform: string;
  accountId: string;
  platformChatId: string;
  chatType: string;
  title?: string | null;
  messageThreadId?: string | null;
  rawChat?: JsonObject;
};

export async function upsertPlatformChat(
  db: ParamDb,
  input: UpsertPlatformChatInput,
): Promise<{ id: string }> {
  const now = new Date();
  // The unique index uses coalesce(message_thread_id,'') which cannot be an
  // ON CONFLICT arbiter target, so match-then-write explicitly.
  const threadId = input.messageThreadId ?? null;
  const [existing] = await db
    .select({ id: platformChats.id })
    .from(platformChats)
    .where(
      and(
        eq(platformChats.platform, input.platform),
        eq(platformChats.accountId, input.accountId),
        eq(platformChats.platformChatId, input.platformChatId),
        threadId === null
          ? isNull(platformChats.messageThreadId)
          : eq(platformChats.messageThreadId, threadId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(platformChats)
      .set({
        lastSeenAt: now,
        updatedAt: now,
        // Only overwrite the title when a new one is provided; never clobber a
        // known title to null on updates that don't carry one.
        ...(input.title ? { title: input.title } : {}),
      })
      .where(eq(platformChats.id, existing.id));
    return existing;
  }

  const [row] = await db
    .insert(platformChats)
    .values({
      platform: input.platform,
      accountId: input.accountId,
      platformChatId: input.platformChatId,
      chatType: input.chatType,
      title: input.title ?? null,
      messageThreadId: threadId,
      rawChat: input.rawChat,
    })
    .returning({ id: platformChats.id });
  if (!row) {
    throw new Error("platform chat insert failed");
  }
  return row;
}

export async function upsertParticipant(
  db: ParamDb,
  input: {
    sessionId: string;
    userId?: string | null;
    platformUserId: string;
    role?: string;
  },
): Promise<void> {
  const now = new Date();
  await db
    .insert(sessionParticipants)
    .values({
      sessionId: input.sessionId,
      userId: input.userId ?? null,
      platformUserId: input.platformUserId,
      role: input.role ?? "member",
    })
    .onConflictDoUpdate({
      target: [
        sessionParticipants.sessionId,
        sessionParticipants.platformUserId,
      ],
      set: { lastSeenAt: now, updatedAt: now },
    });
}

export const identityRepository = {
  ensureChannelAccount,
  upsertUserAccount,
  upsertPlatformChat,
  upsertParticipant,
};
