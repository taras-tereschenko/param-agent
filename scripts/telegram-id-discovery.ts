import { BotApiTransport } from "../src/channels";

/**
 * Print recent Telegram user/chat ids so the operator can configure the owner
 * trusted user id and allowed group/topic ids. Reads TELEGRAM_BOT_TOKEN.
 *
 * Usage: TELEGRAM_BOT_TOKEN=... bun scripts/telegram-id-discovery.ts
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("set TELEGRAM_BOT_TOKEN to discover ids");
  process.exit(1);
}

const transport = new BotApiTransport(token);
const me = await transport.getMe().catch(() => undefined);
if (me) {
  console.log(`bot: @${me.username ?? "unknown"} (id ${me.id})`);
}

const updates = await transport.getUpdates(undefined, 0);
if (updates.length === 0) {
  console.log(
    "no recent updates. Send your bot a DM (or add it to a group) then re-run.",
  );
} else {
  const seen = new Set<string>();
  for (const update of updates) {
    const raw = update as unknown as {
      message?: {
        from?: { id: number; username?: string; first_name?: string };
        chat?: { id: number; type: string; title?: string };
        message_thread_id?: number;
      };
    };
    const msg = raw.message;
    if (!msg) continue;
    const key = `${msg.from?.id}:${msg.chat?.id}:${msg.message_thread_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (msg.from) {
      console.log(
        `user id ${msg.from.id} (@${msg.from.username ?? msg.from.first_name ?? "?"})`,
      );
    }
    if (msg.chat) {
      const topic = msg.message_thread_id
        ? ` topic ${msg.message_thread_id}`
        : "";
      console.log(
        `chat id ${msg.chat.id} type ${msg.chat.type}${topic} ${msg.chat.title ?? ""}`.trim(),
      );
    }
  }
}
