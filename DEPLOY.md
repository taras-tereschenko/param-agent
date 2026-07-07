# Deploying Param

Param runs as a single self-hosted process on a VPS (e.g. Hetzner). There is no
Vercel/serverless part: inference goes through your Codex (ChatGPT Plus/Pro)
subscription via the local Codex CLI (`ai-sdk-provider-codex-cli`), which needs a
persistent host. The Telegram webhook is exposed publicly with **Tailscale
Funnel** — no domain or reverse proxy required.

High-level rationale is in `GOAL.md`; the full env-var list is in `.env.example`.

## 1. Prerequisites

- A VPS you control (Hetzner is fine) with Bun installed.
- The **Codex CLI**, installed and logged in on the VPS:
  `npm i -g @openai/codex && codex login`. It's headless, so use the device-code
  flow, or copy `~/.codex/auth.json` from a machine where you've already logged
  in. Tokens must live in the `$HOME` of the user that runs Param.
- A **Telegram bot** from [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`
  (note its username and numeric id) and a strong random `TELEGRAM_WEBHOOK_SECRET_TOKEN`.
- A **Tailscale** account (free personal plan) with Funnel enabled for the node.
- Optional: Postgres for memory + Action Review audit — install it locally on the
  VPS or use Neon's free tier.
- Your Telegram user id(s) for the allow/trust lists.

## 2. Get the code onto the VPS

```bash
git clone <repo> && cd param-agent
bun install
cp .env.example .env      # then fill it in (step 3)
```

## 3. Environment (`.env`)

Required: `PARAM_CODEX_MODEL` (e.g. `gpt-5.5`), `PARAM_CODEX_CONTEXT_WINDOW`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`TELEGRAM_BOT_ID`, `PARAM_ALLOWED_TELEGRAM_USER_IDS`,
`PARAM_TRUSTED_TELEGRAM_USER_IDS` (keep allowed ≠ trusted), and
`PARAM_PUBLIC_BASE_URL` = your Funnel URL from step 5 (e.g.
`https://vps.tailnet-name.ts.net`).

Recommended: `DATABASE_URL` (+ `PARAM_INTERNAL_API_SECRET`,
`PARAM_INTERNAL_API_ORIGIN`). Optional: `PARAM_PROACTIVE_TELEGRAM_CHAT_IDS`,
`PARAM_TELEGRAM_MAX_MESSAGES`.

Fail-closed: with no `TELEGRAM_WEBHOOK_SECRET_TOKEN`, the webhook rejects every
update, so the bot stays silent.

## 4. Database (if using memory/audit)

```bash
bun run db:migrate
bun run db:smoke        # optional sanity check
```

## 5. Expose the webhook with Tailscale Funnel

Telegram must reach Param over public HTTPS. `eve start` serves on port `3000`
(override with `PORT`); Funnel publishes it on a valid `*.ts.net` cert.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Enable Funnel for this node in the Tailscale admin console (ACL nodeAttrs),
# then publish the local port:
sudo tailscale funnel 3000
sudo tailscale funnel status      # prints the public https://<node>.<tailnet>.ts.net URL
```

Put that URL in `PARAM_PUBLIC_BASE_URL`.

## 6. Run Param (systemd)

`/etc/systemd/system/param.service` (run as the user that did `codex login`, so
`~/.codex/auth.json` is in scope):

```ini
[Unit]
Description=Param
After=network-online.target

[Service]
User=param
WorkingDirectory=/home/param/param-agent
EnvironmentFile=/home/param/param-agent/.env
ExecStartPre=/home/param/.bun/bin/bun run build
ExecStart=/home/param/.bun/bin/bun run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now param
journalctl -u param -f        # watch logs
```

`eve start` serves `/eve/v1/telegram` and runs the proactive cron in-process,
using Eve's local (on-disk) Workflow world for durable background work — no
Vercel needed.

## 7. Register the webhook and verify

```bash
bun run telegram:webhook:set        # registers <PARAM_PUBLIC_BASE_URL>/eve/v1/telegram
bun run telegram:webhook:get        # verify url + pending count
```

- DM the bot from an allowed user → Param replies (the first turn also confirms
  Codex auth; watch `journalctl -u param`).
- Try a reaction or a `[[param:link:…]]` button.
- Set `PARAM_PROACTIVE_TELEGRAM_CHAT_IDS` to enable proactive wakes.

## Security

- **Codex is read-only.** `agent/agent.ts` runs `codexExec` with
  `sandboxMode: "read-only"` and `approvalMode: "never"`, so a crafted or injected
  chat prompt cannot make Codex run commands or write files on the VPS. Do not
  loosen this.
- **eve session API is locked by default.** `agent/channels/eve.ts` only trusts
  loopback when `PARAM_LOCAL_DEV=true` (local dev). Leave it unset in production —
  otherwise, because Funnel proxies the internet to localhost, the session API
  (`/eve/v1/session`, which can drive Param) would be publicly reachable
  unauthenticated. The Telegram webhook is separately gated by
  `TELEGRAM_WEBHOOK_SECRET_TOKEN` (fail-closed).
- **Expose only the webhook.** Prefer scoping Tailscale Funnel to the
  `/eve/v1/telegram` path; keep SSH and Postgres on the tailnet (never public).
- **Access control.** Set `PARAM_ALLOWED_TELEGRAM_USER_IDS` /
  `PARAM_TRUSTED_TELEGRAM_USER_IDS`; never `PARAM_ALLOW_UNRESTRICTED_TELEGRAM=true`
  in production.
- **Secret hygiene.** Protect `~/.codex/auth.json` (your subscription token,
  `chmod 600`, service-user only) and `.env` (not world-readable). If the VPS is
  compromised, that token is compromised.

## Not implemented yet

Memory-review, pgvector search, adapter runners, and Mini Apps remain unbuilt
(see `GOAL.md` → "Current Known Gaps").
