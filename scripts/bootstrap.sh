#!/usr/bin/env bash
#
# Param one-shot bootstrap.
#
#   curl -fsSL https://raw.githubusercontent.com/taras-tereschenko/param-agent/feat/param-implementation/scripts/bootstrap.sh | bash
#
# Checks/installs prerequisites (curl, git, unzip, bun), clones Param, installs
# dependencies, and runs the interactive setup (config questions). By default it
# also installs local Postgres + pgvector, provisions the DB from .env, and runs
# migrations. Idempotent: safe to re-run.
#
# Flags:
#   --skip-postgres   do NOT install local Postgres (bring your own / remote DB)
#   --no-setup        skip the interactive `bun run setup`
#   --repo <url>      git repo (default: the public Param repo)
#   --branch <name>   branch (default: feat/param-implementation)
#   --dir <path>      install dir (default: $HOME/param-agent)
#   -h, --help        show this help
set -euo pipefail

REPO_URL="${PARAM_REPO_URL:-https://github.com/taras-tereschenko/param-agent.git}"
BRANCH="${PARAM_BRANCH:-feat/param-implementation}"
TARGET_DIR="${PARAM_DIR:-$HOME/param-agent}"
WITH_POSTGRES=1   # install local Postgres by default; --skip-postgres opts out
RUN_SETUP=1
PROVISION_DB=0   # set to 1 only when auto DB provisioning is supported here
DB_READY=0       # set to 1 only after the DB is actually provisioned + migrated
SERVICES_UP=0    # set to 1 only after the systemd services are actually started

log()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Param one-shot bootstrap.
Installs prerequisites (curl, git, unzip, bun), clones Param, installs deps,
and runs the interactive setup. By default it also installs local Postgres +
pgvector (apt-based Linux only), provisions the DB from .env, and migrates.
Idempotent.

Flags:
  --skip-postgres   do NOT install local Postgres (bring your own / remote DB)
  --no-setup        skip the interactive `bun run setup`
  --repo <url>      git repo (default: the public Param repo)
  --branch <name>   branch (default: feat/param-implementation)
  --dir <path>      install dir (default: $HOME/param-agent)
  -h, --help        show this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-postgres) WITH_POSTGRES=0 ;;
    --with-postgres) WITH_POSTGRES=1 ;;  # accepted for back-compat (now default)
    --no-setup) RUN_SETUP=0 ;;
    --repo) [ $# -ge 2 ] || die "--repo requires a value"; REPO_URL="$2"; shift ;;
    --branch) [ $# -ge 2 ] || die "--branch requires a value"; BRANCH="$2"; shift ;;
    --dir) [ $# -ge 2 ] || die "--dir requires a value"; TARGET_DIR="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown flag: $1 (see --help)" ;;
  esac
  shift
done

OS="$(uname -s)"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else warn "not root and no sudo; package installs may fail"; fi
fi

pkg_install() {
  case "$OS" in
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        $SUDO apt-get update -y -qq >/dev/null 2>&1 || true
        $SUDO apt-get install -y -qq "$@" >/dev/null 2>&1
      elif command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y "$@" >/dev/null 2>&1
      elif command -v pacman >/dev/null 2>&1; then $SUDO pacman -Sy --noconfirm "$@" >/dev/null 2>&1
      else die "no supported package manager (apt/dnf/pacman)"; fi ;;
    Darwin)
      command -v brew >/dev/null 2>&1 || die "Homebrew is required on macOS (https://brew.sh)"
      brew install "$@" >/dev/null 2>&1 ;;
    *) die "unsupported OS: $OS" ;;
  esac
}

ensure_cmd() { # ensure_cmd <command> <package>
  if command -v "$1" >/dev/null 2>&1; then
    log "$1 present"
  else
    log "installing $2"; pkg_install "$2"
    command -v "$1" >/dev/null 2>&1 || die "failed to install $1"
  fi
}

# Run psql as the postgres superuser regardless of whether we have sudo.
pg_su() {
  if command -v sudo >/dev/null 2>&1; then sudo -u postgres "$@";
  elif [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@";
  else die "need root or sudo to manage Postgres"; fi
}

log "Param bootstrap  (os=$OS  dir=$TARGET_DIR  branch=$BRANCH)"

# 1. Prerequisites.
ensure_cmd curl curl
ensure_cmd git git
ensure_cmd unzip unzip   # the bun installer needs unzip to extract the binary

# 2. Bun.
if command -v bun >/dev/null 2>&1; then
  log "bun present ($(bun --version))"
else
  log "installing bun"
  curl -fsSL https://bun.sh/install | bash >/dev/null
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
command -v bun >/dev/null 2>&1 || die "bun not on PATH after install"
log "bun $(bun --version)"

# 3. Clone or update Param.
if [ -d "$TARGET_DIR/.git" ]; then
  log "updating existing checkout at $TARGET_DIR"
  git -C "$TARGET_DIR" fetch --quiet origin "$BRANCH"
  git -C "$TARGET_DIR" checkout --quiet "$BRANCH"
  git -C "$TARGET_DIR" pull --quiet --ff-only origin "$BRANCH" || warn "could not fast-forward; leaving as-is"
elif [ -e "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  die "$TARGET_DIR exists and is not a Param checkout; remove it or pass --dir <path>"
else
  log "cloning Param into $TARGET_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
fi
cd "$TARGET_DIR"

# 4. Dependencies.
log "installing dependencies (bun install)"
bun install

# 5. Optional: local Postgres + pgvector. The automated install + provisioning
#    path is apt-based Linux only (the VPS target); other platforms get clear
#    manual guidance instead of a half-configured DB.
if [ "$WITH_POSTGRES" -eq 1 ]; then
  if [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    log "installing Postgres + pgvector"
    # Prefer PostgreSQL's official PGDG apt repo: it ships a current server AND
    # the matching postgresql-<v>-pgvector package (the distro repos frequently
    # lack pgvector). Best-effort with `-y` (non-interactive) — if the repo
    # setup fails we fall back to the distro packages, and the pgvector guard in
    # step 7 still fails loudly if the extension is ultimately unavailable.
    if pkg_install postgresql-common \
      && $SUDO /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null 2>&1; then
      log "added the PostgreSQL PGDG apt repository"
    else
      warn "could not add the PGDG repo; falling back to the distro Postgres packages"
    fi
    pkg_install postgresql postgresql-contrib
    PGV="$(psql --version | grep -oE '[0-9]+' | head -1)"
    pkg_install "postgresql-${PGV}-pgvector" \
      || warn "pgvector package postgresql-${PGV}-pgvector unavailable; install it manually"
    $SUDO systemctl enable --now postgresql >/dev/null 2>&1 || true
    log "postgres $(psql --version | awk '{print $3}')"
    PROVISION_DB=1
  else
    warn "auto Postgres install is only supported on apt-based Linux; install Postgres + pgvector manually, then run 'bun run db:migrate'"
  fi
fi

# 6. Interactive setup (config questions). Needs a terminal to read answers.
#    When piped (curl | bash), our own stdin is the script text, so setup reads
#    the answers from /dev/tty (the controlling terminal) instead — the standard
#    trick that lets `curl ... | bash` still prompt. We require stdout to be a
#    terminal too ([ -t 1 ]): setup needs an interactive stdout, and without
#    this guard a piped run whose output is redirected to a file would abort the
#    whole bootstrap. Falls back to a clear message when there is no usable
#    terminal (e.g. CI, or output redirected to a file).
#
# Tell setup whether we're provisioning a local DB (it generates the password
# and never prompts) or the user brings their own (it asks for connection
# details). PROVISION_DB is 1 only when a local Postgres will actually be set up.
if [ "$PROVISION_DB" -eq 1 ]; then
  export PARAM_SETUP_DB_MODE=local
else
  export PARAM_SETUP_DB_MODE=external
fi
if [ "$RUN_SETUP" -eq 1 ]; then
  if [ -t 0 ] && [ -t 1 ]; then
    log "running setup (configuration questions)"
    bun run setup
  elif [ -t 1 ] && { : </dev/tty; } 2>/dev/null; then
    log "running setup (configuration questions)"
    bun run setup </dev/tty
  else
    warn "no interactive terminal available; run 'cd $TARGET_DIR && bun run setup' to configure"
    RUN_SETUP=0
  fi
fi

# 7. Provision the DB + migrate (only when auto-provisioning is supported and
#    .env exists). The DB password is read from .env and never printed/argv'd.
if [ "$PROVISION_DB" -eq 1 ] && [ -f .env ]; then
  log "provisioning database from .env"
  # decodeURIComponent: URL userinfo is percent-encoded; the Postgres client
  # decodes it on connect, so the role must be created with the DECODED password.
  PW="$(bun -e 'try{process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL||"").password))}catch(e){}')"
  if [ -n "$PW" ]; then
    # Escape the password for a SQL single-quoted literal by doubling quotes.
    # With standard_conforming_strings=on (the default since PG 9.1) backslashes
    # are literal, so quote-doubling alone is injection-safe. The password then
    # travels ONLY via psql's stdin (the heredoc below) — never on argv / ps /
    # /proc/<pid>/cmdline, never written to a lasting file. The heredoc is
    # unquoted so $PW_SQL expands, but shell expansion is single-pass: the $, `,
    # or $(...) that the password itself may contain are inserted literally and
    # never re-evaluated. Works on every psql version (no \getenv / PG16 dep).
    PW_SQL="$(printf '%s' "$PW" | sed "s/'/''/g")"
    if pg_su psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='param'" | grep -q 1; then
      pg_su psql -q >/dev/null 2>&1 <<SQL || true
ALTER ROLE param LOGIN PASSWORD '$PW_SQL';
SQL
    else
      pg_su psql -q >/dev/null 2>&1 <<SQL || true
CREATE ROLE param LOGIN PASSWORD '$PW_SQL';
SQL
    fi
    unset PW PW_SQL
    pg_su psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='param'" | grep -q 1 \
      || die "could not create the 'param' Postgres role (try: sudo -u postgres psql)"
    pg_su psql -tAc "SELECT 1 FROM pg_database WHERE datname='param'" | grep -q 1 \
      || pg_su createdb -O param param
    pg_su psql -d param -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1 || true
    # pgvector is required by the schema. If it can't be created (package
    # missing), fail clearly NOW instead of letting db:migrate crash opaquely.
    if ! pg_su psql -d param -v ON_ERROR_STOP=1 \
        -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1; then
      die "could not enable the pgvector 'vector' extension in the 'param' database; install the pgvector package for your Postgres (e.g. postgresql-${PGV:-NN}-pgvector) and re-run"
    fi
    log "running migrations"
    bun run db:migrate
    bun run db:check
    DB_READY=1
  else
    warn "DATABASE_URL has no usable password (peer-auth, or a malformed % escape); skipping automatic role/DB provisioning. Create the 'param' role + database yourself (see docs/DEPLOY_VPS.md), then run 'bun run db:migrate && bun run db:check'."
  fi
fi

# 8. Chat brain: install the Codex CLI (optional — the OpenAI API brain needs no
#    CLI, only OPENAI_API_KEY). Non-fatal; skip if already present.
if ! command -v codex >/dev/null 2>&1; then
  log "installing Codex CLI (optional chat brain)"
  curl -fsSL https://chatgpt.com/codex/install.sh | sh >/dev/null 2>&1 \
    || warn "could not auto-install Codex; the OpenAI API brain (OPENAI_API_KEY) does not need it"
fi

# 8b. Tailscale (installed by default) for private access to the box. The app
#     endpoints stay bound to loopback; reach them over the tailnet (SSH in over
#     Tailscale, then curl localhost).
#
#     Connecting the box uses a BROWSER LOGIN, exactly like `codex login`:
#     `tailscale up` prints a one-time URL, you open it and approve, and the box
#     joins your tailnet — no key to paste. An auth key is used only as a
#     non-interactive fallback when TAILSCALE_AUTH_KEY is set (CI/automation).
if [ "$OS" = "Linux" ]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    log "installing Tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1 \
      || warn "could not auto-install Tailscale (see https://tailscale.com/download)"
  fi
  if command -v tailscale >/dev/null 2>&1; then
    TS_KEY=""
    [ -f .env ] && TS_KEY="$(bun -e 'process.stdout.write((process.env.TAILSCALE_AUTH_KEY||"").trim())')"
    if [ -n "$TS_KEY" ]; then
      log "connecting to your tailnet (auth key)"
      $SUDO tailscale up --authkey="$TS_KEY" --hostname=param-agent >/dev/null 2>&1 \
        || warn "tailscale up failed; run 'sudo tailscale up' manually"
      unset TS_KEY
    elif { : </dev/tty; } 2>/dev/null; then
      # Browser login (codex-style). Ask first — if you decline (or walk away),
      # the install still finishes; Tailscale is optional. When you say yes we
      # run `tailscale up` with its I/O on the terminal so the login URL is
      # visible; it blocks until you approve in the browser.
      printf '\nConnect this box to your Tailscale network now?\n  It prints a login link to open in your browser (just like `codex login`).\n  Optional — press Enter/N to skip and do it later. [y/N] ' >/dev/tty
      read -r TS_ANSWER </dev/tty || TS_ANSWER=""
      case "$TS_ANSWER" in
        [yY]*)
          log "starting Tailscale login — open the link it prints below"
          if ! $SUDO tailscale up --hostname=param-agent </dev/tty >/dev/tty 2>&1; then
            warn "tailscale login didn't complete; run 'sudo tailscale up' anytime to retry"
          fi
          ;;
        *)
          warn "skipped Tailscale — connect anytime with 'sudo tailscale up' (prints a browser login link)"
          ;;
      esac
      unset TS_ANSWER
    else
      warn "Tailscale installed; no terminal for login — connect later with 'sudo tailscale up' (prints a browser login link)"
    fi
  fi
fi

# 9. Start Param as a background service (systemd) so it runs now and on boot.
#    The worker refuses to run the fake actor in production, so we only START it
#    once a real brain is configured (OPENAI_API_KEY in .env, or codex present).
if command -v systemctl >/dev/null 2>&1 && [ -f .env ] \
  && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "installing systemd services (param-worker, param-app)"
  RUN_USER="$(id -un)"
  BUN_BIN="$BUN_INSTALL/bin/bun"
  SVC_PATH="$BUN_INSTALL/bin:$HOME/.codex/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
  HAS_BRAIN=""
  if bun -e 'process.exit((process.env.OPENAI_API_KEY||"").trim()?0:1)' >/dev/null 2>&1; then
    HAS_BRAIN=1
  fi
  if command -v codex >/dev/null 2>&1; then HAS_BRAIN=1; fi

  $SUDO tee /etc/systemd/system/param-worker.service >/dev/null <<UNIT
[Unit]
Description=Param worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$TARGET_DIR
Environment=PATH=$SVC_PATH
ExecStart=$BUN_BIN run start:worker
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true

[Install]
WantedBy=multi-user.target
UNIT

  $SUDO tee /etc/systemd/system/param-app.service >/dev/null <<UNIT
[Unit]
Description=Param app (health/webhook)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$TARGET_DIR
Environment=PATH=$SVC_PATH
Environment=PORT=8080
ExecStart=$BUN_BIN run start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true

[Install]
WantedBy=multi-user.target
UNIT

  $SUDO systemctl daemon-reload >/dev/null 2>&1 || true
  $SUDO systemctl enable param-worker param-app >/dev/null 2>&1 || true
  if [ -n "$HAS_BRAIN" ]; then
    # If an OpenAI key is configured, verify the brain actually replies BEFORE
    # starting, so a bad key/model surfaces now (with the real error) instead of
    # a silent, mute service. (Codex-subscription path may need `codex login`
    # first, so it isn't gated here.)
    BRAIN_OK=1
    if bun -e 'process.exit((process.env.OPENAI_API_KEY||"").trim()?0:1)' >/dev/null 2>&1; then
      log "verifying the brain replies"
      if ! bun run brain:check; then
        BRAIN_OK=""
        warn "brain check failed (see the error above) — services installed but NOT started. Fix OPENAI_API_KEY / PARAM_OPENAI_MODEL in $TARGET_DIR/.env, then: ${SUDO:+$SUDO }systemctl start param-worker param-app"
      fi
    fi
    if [ -n "$BRAIN_OK" ]; then
      if $SUDO systemctl restart param-worker param-app; then
        SERVICES_UP=1
        log "Param services started (param-worker + param-app)"
      else
        warn "services installed but failed to start; check 'journalctl -u param-worker -e'"
      fi
    fi
  else
    warn "no brain configured yet — set OPENAI_API_KEY in $TARGET_DIR/.env (or run 'codex login'), then: ${SUDO:+$SUDO }systemctl start param-worker param-app"
  fi
fi

log "Bootstrap complete."
if [ "$SERVICES_UP" -eq 1 ]; then
cat <<EOF

Param is up and running as a service. DM your bot on Telegram — it should reply.
  systemctl status param-worker      # worker: Telegram polling + actor runs
  journalctl -u param-worker -f      # live logs
  sudo systemctl restart|stop param-worker param-app

Hardening (dedicated user, Tailscale, firewall): docs/DEPLOY_VPS.md
EOF
else
cat <<EOF

Next steps:
  cd $TARGET_DIR
$([ "$RUN_SETUP" -eq 0 ] && echo "  bun run setup                 # configure (owner id, bot token, OpenAI key)")
$([ "$DB_READY" -eq 0 ] && echo "  bun run db:migrate && bun run db:check   # once Postgres+pgvector is available")
  # brain: set OPENAI_API_KEY in .env (recommended), or 'codex login'
  bun run start:worker          # polling + jobs + actor runs (foreground to test)
  bun run start                 # Hono app (health endpoints)

Systemd units + hardening: docs/DEPLOY_VPS.md
EOF
fi
