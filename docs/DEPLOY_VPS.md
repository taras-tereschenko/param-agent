# Deploying Param on a VPS (Hetzner CX23 / Ubuntu)

Copy-paste runbook for a fresh Ubuntu 22.04/24.04 VPS. Param uses Telegram long
polling, so **no public HTTPS/inbound port is required** for the core bot. Run
the app/worker behind the firewall; reach the operator/health endpoints over
Tailscale.

The Session Actor brain here is your local **Codex CLI** (direct-cli mode). Its
non-interactive output reliability is the first thing to prove (Step 7).

## Quick start (one-liner)

On a fresh box, this installs prerequisites (curl/git/unzip/bun), clones Param,
installs deps, installs local Postgres + pgvector, runs the interactive config
questions, provisions the DB, and migrates:

```bash
curl -fsSL https://raw.githubusercontent.com/taras-tereschenko/param-agent/feat/param-implementation/scripts/bootstrap.sh | bash
```

(The interactive `setup` prompts still work when piped — the script reads your
answers from `/dev/tty`. Postgres + pgvector install by default; if you already
have a database, skip that with `... | bash -s -- --skip-postgres`.) After it
finishes, wire the brain (Step 4 below).

Note: the one-liner is a **single-user** layout — it installs as the user who
runs it, into `$HOME/param-agent`, and does **not** create a dedicated `param`
user or systemd services. To run Param as a hardened background service, follow
the manual steps below instead (dedicated `param` user under `/var/lib/param-agent`
+ systemd); they are a **different, production layout**, not just the one-liner
broken out. For a quick first run after the one-liner, start it in the
foreground from the install dir: `bun run start:worker` (and `bun run start`).

## 0. Assumptions
- You have root/sudo, a Telegram bot token from @BotFather, and your Telegram
  numeric user id (get it after Step 5 with
  `sudo -u param bash -lc 'cd ~/app && TELEGRAM_BOT_TOKEN=<token> bun run discover-telegram'`,
  or just message @userinfobot).

## 1. System packages
```bash
sudo apt-get update
sudo apt-get install -y curl git unzip ufw
```

## 2. Bun
```bash
curl -fsSL https://bun.sh/install | bash
# add to PATH for this shell + persist (adjust for your shell):
export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"
bun --version
```

## 3. Postgres + pgvector
```bash
# Add PostgreSQL's official PGDG apt repo (current server + the pgvector
# package; the distro repos frequently lack pgvector). `-y` = non-interactive.
sudo apt-get install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y

sudo apt-get install -y postgresql postgresql-contrib
# pgvector package name matches the server major version (e.g. 18):
PGV=$(psql -V | grep -oE '[0-9]+' | head -1)
sudo apt-get install -y "postgresql-${PGV}-pgvector"
sudo systemctl enable --now postgresql

# create role + db (pick a strong password):
sudo -u postgres psql <<'SQL'
CREATE ROLE param WITH LOGIN PASSWORD 'REPLACE_ME_STRONG';
CREATE DATABASE param OWNER param;
SQL
```
`db:migrate` enables the `pgcrypto` + `vector` extensions itself (Step 6).

## 4. Codex CLI (the chat brain) + auth
```bash
# Official install script (standalone Rust binary, no Node.js needed):
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex --version
codex login                     # or run `codex` and choose "Sign in with ChatGPT"
# Confirm a headless run works and note the exact flags for your version:
echo "say hi in one word" | codex exec
```
> npm (`npm i -g @openai/codex`, needs Node 22+) is a fallback if the script
> is unavailable.
> If `codex exec` reads the prompt as an ARG rather than stdin, or uses
> different flags, set `runtimes.codex.args` accordingly in Step 6.

## 5. Get the code
The `param` service user needs its own Bun (Step 2 installed Bun only for you).
Its home is `/var/lib/param-agent`, so Bun lands at `/var/lib/param-agent/.bun`.
```bash
sudo useradd --system --create-home --home /var/lib/param-agent param || true
sudo mkdir -p /var/lib/param-agent && sudo chown -R param:param /var/lib/param-agent
sudo -u param bash -lc '
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"
  git clone https://github.com/taras-tereschenko/param-agent.git ~/app
  cd ~/app && git checkout feat/param-implementation && bun install
'
```

## 6. Configure + migrate
Run as `param` via a login shell (`bash -lc`) so its `~/.bun/bin` is on PATH.
```bash
sudo -u param bash -lc 'cd ~/app && bun run setup'   # prompts: owner id, bot token, DATABASE_URL
# DATABASE_URL should be: postgresql://param:REPLACE_ME_STRONG@127.0.0.1:5432/param
sudo -u param bash -lc 'cd ~/app && bun run db:migrate && bun run db:check'
```
(`db:migrate` creates the `pgcrypto` + `vector` extensions as role `param`. On
the PGDG stack from Step 3 both are "trusted" so `param` can create them; on an
older Postgres/pgvector they may need a superuser — then run
`sudo -u postgres psql -d param -c 'CREATE EXTENSION vector; CREATE EXTENSION pgcrypto;'`
before `db:migrate`.)
Then edit `param.config.local.ts` (created by setup) to:
- keep `channels.telegram.enabled: true`, `mode: "polling"`;
- set `channels.telegram.access.allowedPrivateUserIds` to just your id at first;
- keep `actor.defaultRuntime: "codex"` and `runtimes.codex.adapter: "direct-cli"`,
  `command: "codex"`, and `args` matching your `codex exec` invocation.

## 7. PROVE the Codex chat-brain (first gate)
Run the worker in the foreground and DM your bot:
```bash
sudo -u param bash -lc 'cd ~/app && PARAM_LOG_LEVEL=debug bun run start:worker'
```
(One-liner / single-user install: just `cd ~/param-agent && PARAM_LOG_LEVEL=debug bun run start:worker` — no `sudo -u param`.)
- Expect a `actor inference resolved { provider: "codex-cli" }` log.
- DM the bot "hey" — you should get a short, coherent reply.
- If Param stays silent and logs `codex cli produced no valid outputs`, Codex is
  not returning the strict JSON output. Fix by tuning `runtimes.codex.args` /
  the invocation, or (fallback) leave `codex` unavailable so Param uses the
  MockActor while you wire an API provider. Param never crashes on bad output —
  it stays quiet. Record the result in `docs/CODEX_CHAT_BRAIN_PROOF.md`.

## 8. Services (systemd)
`/etc/systemd/system/param-worker.service`:
```ini
[Unit]
Description=Param worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=param
WorkingDirectory=/var/lib/param-agent/app
ExecStart=/var/lib/param-agent/.bun/bin/bun run start:worker
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
> Do NOT add `EnvironmentFile=.../.env`: `.env` is in Bun's dotenv format (a `$`
> in a password is stored escaped as `\$`), and systemd's own parser reads that
> differently. Bun auto-loads `.env` from `WorkingDirectory`, and a value
> already present in the process env is NOT overridden — so a systemd-injected
> value would win and mangle a `$`-containing password. Letting Bun load `.env`
> keeps parsing consistent.

`/etc/systemd/system/param-app.service` (same, `ExecStart=... run start`, and
`Environment=PORT=8080`).
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now param-worker param-app
```

## 9. Verify + secure
```bash
curl -s localhost:8080/health          # {"ok":true,...}
curl -s localhost:8080/health/db       # db + extensions ok
journalctl -u param-worker -f          # watch it poll + reply
sudo ufw allow OpenSSH && sudo ufw enable   # do NOT expose 8080 publicly
# reach /operator/health over Tailscale, not the public interface.
```

## 10. Restart survival
`systemctl restart param-worker` (or reboot): the worker runs recovery on boot
(reclaims leased runs, requeues jobs) and resumes polling from Telegram's
confirmed offset. Migrations are idempotent; re-running `db:migrate` is safe.

## Rollback
`sudo systemctl stop param-worker param-app`. State is in Postgres; no
destructive migration is applied on stop.
