import { Hono } from "hono";

export function createApp() {
  const app = new Hono();

  app.get("/", (c) => c.text("Param is online"));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "param-app",
    }),
  );

  return app;
}

