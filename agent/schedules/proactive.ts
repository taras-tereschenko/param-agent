import { defineSchedule } from "eve/schedules";
import telegram from "../channels/telegram.js";
import { buildProactiveWakePrompt, proactiveTelegramChatIds } from "../lib/proactive.js";

/**
 * A gentle daily proactive wake. It hands Param a wake prompt for each opt-in
 * chat; Param decides whether a friend would naturally reach out, and usually
 * stays quiet (which posts nothing). With no opt-in chats configured, nothing
 * fires. Tune the cadence as needed; Vercel evaluates the cron in UTC.
 */
export default defineSchedule({
  cron: "0 16 * * *",
  async run({ appAuth, receive, waitUntil }) {
    const chatIds = proactiveTelegramChatIds();
    if (chatIds.length === 0) return;

    const message = buildProactiveWakePrompt();
    for (const chatId of chatIds) {
      waitUntil(
        receive(telegram, {
          auth: appAuth,
          message,
          target: { chatId },
        }),
      );
    }
  },
});
