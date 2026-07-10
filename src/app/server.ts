import { type Context, Hono, type Next } from "hono";

import { getDb } from "../db/client";
import { checkSystemHealth } from "../ops/health";

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
      if (c.req.header("authorization") !== `Bearer ${operatorToken}`) {
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
  // fast and relies on the worker for actor work.
  app.post("/webhooks/telegram/:account", async (c) => {
    // Validate Telegram's secret token before doing anything, so forged updates
    // are rejected (and so wiring the processing later can't skip this check).
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (
      secret &&
      c.req.header("x-telegram-bot-api-secret-token") !== secret
    ) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    await c.req.json().catch(() => ({}));
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
