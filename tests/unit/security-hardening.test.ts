import { afterEach, describe, expect, test } from "bun:test";

import { createApp } from "../../src/app/server";
import { redactString, redactValue } from "../../src/security/redaction";

describe("redaction — URL userinfo password", () => {
  test("masks a short (sub-40-char) DB password in a connection URL", () => {
    // The auto-generated DB password is 32 chars — below LONG_TOKEN's threshold.
    const url = "postgresql://param:aB3short_pw_32charslong_xxxx@127.0.0.1:5432/param";
    const out = redactString(url);
    expect(out).toBe("postgresql://param:<redacted>@127.0.0.1:5432/param");
    expect(out).not.toContain("aB3short_pw_32charslong_xxxx");
  });

  test("masks userinfo for other schemes and inside larger strings", () => {
    expect(redactString("using redis://u:p4ss@host:6379 now")).toContain(
      "redis://u:<redacted>@host:6379",
    );
    const nested = redactValue({
      detail: "connect failed: postgres://param:hunter2short@db:5432/x",
    }) as { detail: string };
    expect(nested.detail).not.toContain("hunter2short");
  });
});

describe("HTTP surface auth", () => {
  afterEach(() => {
    delete process.env.PARAM_OPERATOR_TOKEN;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  test("public /health needs no auth", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "param-app" });
  });

  test("/operator/* requires the bearer token when configured", async () => {
    process.env.PARAM_OPERATOR_TOKEN = "s3cret";
    const app = createApp();
    expect((await app.request("/operator/health")).status).toBe(401);
    expect(
      (
        await app.request("/operator/health", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
  });

  test("/health/db requires the bearer token when configured", async () => {
    process.env.PARAM_OPERATOR_TOKEN = "s3cret";
    const res = await createApp().request("/health/db");
    expect(res.status).toBe(401);
  });

  test("webhook rejects a wrong/absent secret token when configured", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "hook-secret";
    const app = createApp();
    const bad = await app.request("/webhooks/telegram/1", {
      method: "POST",
      body: "{}",
      headers: { "x-telegram-bot-api-secret-token": "nope" },
    });
    expect(bad.status).toBe(401);
    const ok = await app.request("/webhooks/telegram/1", {
      method: "POST",
      body: "{}",
      headers: { "x-telegram-bot-api-secret-token": "hook-secret" },
    });
    expect(ok.status).toBe(200);
  });
});
