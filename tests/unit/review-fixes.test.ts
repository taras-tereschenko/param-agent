import { describe, expect, test } from "bun:test";

import { isSafeOutboundUrl, isPrivateHost } from "../../src/security/url-safety";
import { redactString } from "../../src/security/redaction";
import { evaluateTelegramAccess } from "../../src/channels/telegram/policy";
import { applyStyleFixes, checkStyle, MAX_BUBBLE_LENGTH } from "../../src/actor/style-guard";
import {
  buildSendMessageParams,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  truncateForTelegram,
} from "../../src/channels/telegram/send";
import { normalizeTelegramUpdate } from "../../src/channels/telegram/normalize";
import type { TelegramUpdate } from "@chat-adapter/telegram";
import { isSafeThemeValue, validateThemePatch } from "../../src/ui/theme";
import { buildDefaultToolset } from "../../src/worker/dispatch";

describe("SSRF url safety (hardened)", () => {
  test("blocks loopback / private / metadata / encoded forms", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "::1",
      "0x7f000001",
      "2130706433",
      "::ffff:169.254.169.254",
    ]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  test("allows a normal public host, blocks non-http schemes", () => {
    expect(isSafeOutboundUrl("https://example.com/x").safe).toBe(true);
    expect(isSafeOutboundUrl("http://127.0.0.1/").safe).toBe(false);
    expect(isSafeOutboundUrl("file:///etc/passwd").safe).toBe(false);
    expect(isSafeOutboundUrl("http://2130706433/").safe).toBe(false);
  });
});

describe("secret redaction (hardened)", () => {
  test("masks telegram bot token, bearer, sk- and long tokens", () => {
    const token = "123456789:AAF-abcDEF_ghiJKLmnoPQRstuvWXyz012345";
    expect(redactString(`getUpdates failed for ${token}`)).not.toContain(token);
    expect(redactString("Authorization: Bearer abcdef.ghijkl")).toContain(
      "<redacted>",
    );
    expect(redactString("key sk-ABCDEFGH12345678")).toContain("<redacted>");
  });
});

describe("telegram topic gating is per-chat", () => {
  const lists = {
    allowedPrivateUserIds: [],
    allowedGroupChatIds: ["-100A", "-100B"],
    allowedTopicIds: [{ chatId: "-100A", topicId: "7" }],
  };
  test("chat A gates topics; chat B (no entries) allows any topic", () => {
    // chat A, wrong topic -> denied
    expect(
      evaluateTelegramAccess(
        { chatType: "supergroup", chatId: "-100A", messageThreadId: "9" },
        lists,
      ).allowed,
    ).toBe(false);
    // chat A, listed topic -> allowed
    expect(
      evaluateTelegramAccess(
        { chatType: "supergroup", chatId: "-100A", messageThreadId: "7" },
        lists,
      ).allowed,
    ).toBe(true);
    // chat B, any topic -> allowed (no topic restriction leaks from A)
    expect(
      evaluateTelegramAccess(
        { chatType: "supergroup", chatId: "-100B", messageThreadId: "9" },
        lists,
      ).allowed,
    ).toBe(true);
  });
});

describe("over-length handling", () => {
  test("style guard truncates instead of dropping", () => {
    const long = "a ".repeat(500).trim();
    expect(checkStyle(long).some((v) => v.code === "too_long")).toBe(true);
    const fixed = applyStyleFixes(long);
    expect(fixed.length).toBeLessThanOrEqual(MAX_BUBBLE_LENGTH);
    expect(fixed.endsWith("…")).toBe(true);
  });

  test("sendText params never exceed the Telegram limit", () => {
    const huge = "x".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 500);
    expect(truncateForTelegram(huge).length).toBeLessThanOrEqual(
      TELEGRAM_MAX_MESSAGE_LENGTH,
    );
    const params = buildSendMessageParams(huge, { chatId: "1" });
    expect(params.text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
  });
});

describe("ui theme value validation", () => {
  test("accepts a safe color token, rejects raw CSS / url()", () => {
    expect(
      validateThemePatch({
        system: "shadcn-css-variables",
        scope: "surface",
        tokens: { primary: "240 5% 10%" },
      }).ok,
    ).toBe(true);
    const bad = validateThemePatch({
      system: "shadcn-css-variables",
      scope: "surface",
      tokens: { primary: "url(http://evil/x)" },
    });
    expect(bad.ok).toBe(false);
    expect(bad.rejectedValues).toContain("primary");
    expect(isSafeThemeValue("primary", "}; background: red")).toBe(false);
    expect(isSafeThemeValue("radius", "0.5rem")).toBe(true);
  });

  test("non-allowlisted token rejected; profile scope needs review", () => {
    const res = validateThemePatch({
      system: "shadcn-css-variables",
      scope: "global",
      tokens: { evil: "x" },
    });
    expect(res.ok).toBe(false);
    expect(res.rejectedTokens).toContain("evil");
    expect(res.requiresActionReview).toBe(true);
  });
});

describe("default toolset", () => {
  test("registers safe read tools + self-management definitions", () => {
    const { registry, handlers } = buildDefaultToolset();
    expect(registry.has("system.health")).toBe(true);
    expect(registry.has("service.status")).toBe(true);
    expect(registry.has("service.restart")).toBe(true);
    expect(handlers.has("service.status")).toBe(true);
    // consequential self-management tool is manual-approval, not auto
    expect(registry.get("service.restart")?.approvalMode).toBe("manual");
  });
});

describe("callback decoding matches the UI encoder", () => {
  test("cb:<surface>:<action>:<value> decodes surfaceId/actionId/value", () => {
    const value = encodeURIComponent(JSON.stringify({ x: 1 }));
    const update = {
      update_id: 5,
      callback_query: {
        id: "cbq1",
        from: { id: 42, is_bot: false, first_name: "Sam" },
        message: {
          message_id: 10,
          date: 1_700_000_000,
          chat: { id: 99, type: "private" },
        },
        data: `cb:surf1:approve:${value}`,
      },
    } as unknown as TelegramUpdate;
    const inbound = normalizeTelegramUpdate(update, { accountId: "main" });
    expect(inbound?.kind).toBe("chat.action.callback");
    const payload = inbound?.payload as {
      actionId: string;
      surfaceId?: string;
      value?: { x?: number };
    };
    expect(payload.actionId).toBe("approve");
    expect(payload.surfaceId).toBe("surf1");
    expect(payload.value?.x).toBe(1);
    // occurredAt is press time (~now), not the button message's send time.
    expect(new Date(inbound!.occurredAt).getFullYear()).toBeGreaterThanOrEqual(
      2025,
    );
  });
});
