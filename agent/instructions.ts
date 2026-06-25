import { defineDynamic, defineInstructions } from "eve/instructions";
import type { DynamicResolveContext } from "eve/instructions";
import { PARAM_BASE_INSTRUCTIONS } from "./lib/base-instructions.js";
import { buildParamContextPrompt, fetchParamContext } from "./lib/memory-internal.js";
import { telegramScopeFromDynamicContext } from "./lib/memory/scopes.js";

function isTelegramChannel(ctx: DynamicResolveContext) {
  return ctx.channel.kind === "telegram" || ctx.channel.kind === "channel:telegram";
}

function buildSessionPrompt(ctx: DynamicResolveContext) {
  const parts = ["# Runtime Context"];

  parts.push(`Channel: ${ctx.channel.kind ?? "unknown"}`);

  const principal = ctx.session.auth.current;
  if (principal) {
    parts.push(`Current principal: ${principal.principalId}`);
    parts.push(`Principal type: ${principal.principalType}`);
  }

  if (isTelegramChannel(ctx)) {
    parts.push(
      [
        "# Telegram Behavior",
        "Use the Telegram context attached to the current turn.",
        "DMs, groups, and forum topics are separate sessions.",
        "In groups, do not assume every visible message needs an answer.",
        "If the current message is ambient context, reply only when a real friend would naturally jump in.",
        "When you do answer, keep Telegram messages short.",
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx: DynamicResolveContext) => {
      const principalId = (ctx.session.auth.current ?? ctx.session.auth.initiator)?.principalId;
      const paramContext = principalId
        ? await fetchParamContext(principalId, { scope: telegramScopeFromDynamicContext(ctx) })
        : undefined;
      const contextPrompt = paramContext ? buildParamContextPrompt(paramContext) : "";

      return defineInstructions({
        markdown: [PARAM_BASE_INSTRUCTIONS, buildSessionPrompt(ctx), contextPrompt]
          .filter(Boolean)
          .join("\n\n---\n\n"),
      });
    },
  },
});
