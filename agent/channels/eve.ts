import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

// SECURITY: localDev() grants ANY loopback request (isLoopbackRequest), not just
// `eve dev`. Self-hosted behind a public tunnel (Tailscale Funnel proxies
// internet traffic to localhost), that would expose the eve session API to the
// internet unauthenticated. So it is opt-in via PARAM_LOCAL_DEV for local
// development only — never set it in production. By default the session API is
// locked (vercelOidc has no tokens off Vercel; placeholderAuth denies), which is
// fine because Param is Telegram-first and has no web client yet.
export default eveChannel({
  auth: [
    ...(process.env.PARAM_LOCAL_DEV === "true" ? [localDev()] : []),
    vercelOidc(),
    placeholderAuth(),
  ],
});
