import { timingSafeEqual } from "node:crypto";

import { type Context, Hono, type Next } from "hono";

import { getDb } from "../db/client";
import { checkSystemHealth } from "../ops/health";
import { enqueueJob } from "../orchestrator/run-queue";

/** Constant-time string compare (length-guarded) to avoid a timing side-channel. */
function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * The Hono HTTP surface. The app process does NOT run long actor work: it
 * serves health, optional Telegram webhook intake, Mini App pages, and internal
 * operator endpoints, persisting/enqueuing work for the worker.
 */
export function createApp() {
  const app = new Hono();

  // Defense-in-depth for the endpoints that expose internals: when
  // PARAM_OPERATOR_TOKEN is set, require it as a bearer token. (Primary
  // protection is loopback binding — see app/main.ts — this guards the case
  // where the operator deliberately binds to a public/Tailscale interface.)
  const operatorToken = process.env.PARAM_OPERATOR_TOKEN;
  const requireOperatorAuth = async (c: Context, next: Next) => {
    if (operatorToken) {
      const header = c.req.header("authorization") ?? "";
      if (!secretEquals(header, `Bearer ${operatorToken}`)) {
        return c.json({ ok: false, error: "unauthorized" }, 401);
      }
    }
    await next();
  };
  app.use("/operator/*", requireOperatorAuth);
  app.use("/health/db", requireOperatorAuth);

  app.get("/", (c) => c.text("Param is online"));

  app.get("/health", (c) => c.json({ ok: true, service: "param-app" }));

  app.get("/health/db", async (c) => {
    try {
      const db = await getDb();
      const snapshot = await checkSystemHealth(db);
      return c.json(snapshot, snapshot.ok ? 200 : 503);
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        503,
      );
    }
  });

  // Optional Telegram webhook intake. Polling is the default transport; this
  // endpoint exists for deployments that prefer webhook mode. It acknowledges
  // fast and enqueues the update for the worker, which normalizes + access-
  // checks + ingests it through the SAME pipeline as polling (see the
  // telegram_webhook_update job handler).
  app.post("/webhooks/telegram/:account", async (c) => {
    // SECURITY: fail CLOSED. Without a configured secret, an attacker could POST
    // a forged update with `from.id = <owner>` and the worker would ingest it as
    // a genuine owner message (full impersonation / remote drive). Webhook mode
    // therefore REQUIRES TELEGRAM_WEBHOOK_SECRET, and the header must match it.
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!secret) {
      return c.json(
        { ok: false, error: "webhook secret not configured" },
        503,
      );
    }
    if (!secretEquals(c.req.header("x-telegram-bot-api-secret-token") ?? "", secret)) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const account = c.req.param("account");
    const update = (await c.req.json().catch(() => null)) as
      | { update_id?: number }
      | null;
    // Ignore malformed bodies (still 200 so Telegram doesn't hammer retries).
    if (!update || typeof update.update_id !== "number") {
      return c.json({ ok: true });
    }
    try {
      const db = await getDb();
      await enqueueJob(
        db,
        "telegram_webhook_update",
        { account, update },
        // update_id is unique per bot, so this dedupes Telegram's retries.
        { idempotencyKey: `telegram_webhook:${account}:${update.update_id}` },
      );
    } catch (error) {
      // Report a 500 so Telegram retries later rather than dropping the update.
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
    return c.json({ ok: true });
  });

  // Mini App page shell (requires public HTTPS to actually be used).
  app.get("/mini-apps/:surfaceId", (c) =>
    c.json({ ok: true, surfaceId: c.req.param("surfaceId") }),
  );

  // Internal operator endpoint (should sit behind Tailscale/private access).
  app.get("/operator/health", async (c) => {
    try {
      const db = await getDb();
      return c.json(await checkSystemHealth(db));
    } catch {
      return c.json(await checkSystemHealth());
    }
  });

  return app;
}
