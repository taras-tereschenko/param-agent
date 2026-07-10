import { createApp } from "./server";

const app = createApp();

const port = Number(process.env.PORT ?? 8080);
// Bind to loopback by default so health/operator endpoints are never exposed on
// a public interface (Param needs no inbound port in polling mode; reach the
// operator endpoints over Tailscale/SSH). Set PARAM_BIND_HOST=0.0.0.0 only for
// webhook mode behind a trusted reverse proxy.
const hostname = process.env.PARAM_BIND_HOST ?? "127.0.0.1";

export default {
  port,
  hostname,
  fetch: app.fetch,
};
