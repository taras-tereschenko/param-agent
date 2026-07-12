import { createApp } from "./server";
import { logger } from "../observability/logger";

const app = createApp();

const port = Number(process.env.PORT ?? 8080);
// Bind to loopback by default so health/operator endpoints are never exposed on
// a public interface (Param needs no inbound port in polling mode; reach the
// operator endpoints over Tailscale/SSH). Set PARAM_BIND_HOST=0.0.0.0 only for
// webhook mode behind a trusted reverse proxy.
const hostname = process.env.PARAM_BIND_HOST?.trim() || "127.0.0.1";

// SECURITY: if the app is bound to a NON-loopback interface, /operator/* and
// /health/db must be protected by PARAM_OPERATOR_TOKEN — otherwise anyone who
// can reach the port reads internal system/DB health. Warn loudly (don't hard
// exit, since a trusted reverse proxy / firewall may gate the port) so the
// exposure is never silent.
const isLoopback =
  hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
if (!isLoopback && !process.env.PARAM_OPERATOR_TOKEN?.trim()) {
  logger.child("app").warn("operator endpoints exposed without a token", {
    hostname,
    fix: "set PARAM_OPERATOR_TOKEN in .env, or bind PARAM_BIND_HOST to loopback",
  });
}

export default {
  port,
  hostname,
  fetch: app.fetch,
};
