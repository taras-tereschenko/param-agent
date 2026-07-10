#!/usr/bin/env bash
#
# Param one-shot bootstrap.
#
#   curl -fsSL https://raw.githubusercontent.com/taras-tereschenko/param-agent/feat/param-implementation/scripts/bootstrap.sh | bash
#
# Checks/installs prerequisites (curl, git, unzip, bun), clones Param, installs
# dependencies, and runs the interactive setup (config questions). With
# --with-postgres it also installs local Postgres + pgvector, provisions the DB
# from .env, and runs migrations. Idempotent: safe to re-run.
#
# Flags:
#   --with-postgres   also install local Postgres + pgvector, provision + migrate
#   --no-setup        skip the interactive `bun run setup`
#   --repo <url>      git repo (default: the public Param repo)
#   --branch <name>   branch (default: feat/param-implementation)
#   --dir <path>      install dir (default: $HOME/param-agent)
set -euo pipefail

REPO_URL="${PARAM_REPO_URL:-https://github.com/taras-tereschenko/param-agent.git}"
BRANCH="${PARAM_BRANCH:-feat/param-implementation}"
TARGET_DIR="${PARAM_DIR:-$HOME/param-agent}"
WITH_POSTGRES=0
RUN_SETUP=1
PROVISION_DB=0   # set to 1 only when auto DB provisioning is supported here

log()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Param one-shot bootstrap.
Installs prerequisites (curl, git, unzip, bun), clones Param, installs deps,
and runs the interactive setup. With --with-postgres it also installs local
Postgres + pgvector (apt-based Linux only), provisions the DB from .env, and
migrates. Idempotent.

Flags:
  --with-postgres   also install + provision local Postgres (apt-based Linux)
  --no-setup        skip the interactive `bun run setup`
  --repo <url>      git repo (default: the public Param repo)
  --branch <name>   branch (default: feat/param-implementation)
  --dir <path>      install dir (default: $HOME/param-agent)
  -h, --help        show this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --with-postgres) WITH_POSTGRES=1 ;;
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

# Run `psql` as postgres with PARAM_DB_PW preserved in ITS environment, so the
# password can be read via psql's \getenv and never appears in argv / ps /
# /proc/<pid>/cmdline (which cmdline exposes world-readable).
pg_su_env_psql() {
  if command -v sudo >/dev/null 2>&1; then
    sudo --preserve-env=PARAM_DB_PW -u postgres psql "$@"
  elif [ "$(id -u)" -eq 0 ]; then
    PARAM_DB_PW="$PARAM_DB_PW" runuser -u postgres -- psql "$@"
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

# 6. Interactive setup (config questions). Requires a TTY.
if [ "$RUN_SETUP" -eq 1 ]; then
  if [ -t 0 ]; then
    log "running setup (configuration questions)"
    bun run setup
  else
    warn "no interactive terminal (script was piped); run 'cd $TARGET_DIR && bun run setup' to configure"
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
    export PARAM_DB_PW="$PW"
    # Create-or-update the role WITHOUT the password on argv: psql reads it from
    # the environment via \getenv, and :'pw' quotes it safely into SQL.
    pg_su_env_psql >/dev/null 2>&1 <<'SQL' || true
\getenv pw PARAM_DB_PW
CREATE ROLE param LOGIN PASSWORD :'pw';
SQL
    pg_su_env_psql >/dev/null 2>&1 <<'SQL' || true
\getenv pw PARAM_DB_PW
ALTER ROLE param LOGIN PASSWORD :'pw';
SQL
    unset PARAM_DB_PW
    pg_su psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='param'" | grep -q 1 \
      || die "could not create the 'param' Postgres role (try: sudo -u postgres psql)"
    pg_su psql -tAc "SELECT 1 FROM pg_database WHERE datname='param'" | grep -q 1 \
      || pg_su createdb -O param param
    pg_su psql -d param -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1 || true
    pg_su psql -d param -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || true
    log "running migrations"
    bun run db:migrate
    bun run db:check
  else
    warn "could not read DATABASE_URL from .env; skipping DB provisioning"
  fi
fi

log "Bootstrap complete."
cat <<EOF

Next steps:
  cd $TARGET_DIR
$([ "$RUN_SETUP" -eq 0 ] && echo "  bun run setup                 # configure (owner id, bot token, DB url)")
  # brain: install Codex CLI + 'codex login' (or set OPENAI_API_KEY), OR use the MockActor
$([ "$PROVISION_DB" -eq 0 ] && echo "  bun run db:migrate && bun run db:check   # once Postgres+pgvector is available")
  bun run start:worker          # polling + jobs + actor runs (foreground to test)
  bun run start                 # Hono app (health endpoints)

Systemd units + hardening: docs/DEPLOY_VPS.md
EOF
