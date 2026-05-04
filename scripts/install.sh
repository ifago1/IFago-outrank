#!/usr/bin/env bash
#
# Bare-metal installer voor Ubuntu/Debian VPS — geen Docker nodig.
#
# Wat dit doet:
#   1. Installeert OS-deps: curl, git, build-essential, postgresql-16,
#      redis-server, caddy
#   2. Installeert Node 22 via NodeSource + activeert pnpm via corepack
#   3. Maakt OS user `outreach` aan + zet repo-perms
#   4. Roept `pnpm setup` aan (interactive .env wizard)
#   5. Maakt Postgres user/database aan met het wachtwoord uit .env
#   6. Runt `pnpm install` + `pnpm db:migrate` + `pnpm --filter @outreach/web build`
#   7. Schrijft systemd units (web/worker/scheduler/migrate) + Caddyfile
#   8. Start alles via systemctl
#
# Idempotent: rerunnen na een mislukte install of voor updates is veilig.
#
# Usage:
#   sudo bash scripts/install.sh                # eerste install
#   sudo bash scripts/install.sh --update       # git pull + rebuild + restart
#   sudo bash scripts/install.sh --skip-os      # OS-deps al geinstalleerd
#   sudo bash scripts/install.sh --no-caddy     # Caddy overslaan (eigen reverse proxy)

set -euo pipefail

# ────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────
APP_USER="outreach"
APP_DIR="/opt/outreach"
NODE_MAJOR="22"
PG_DB="outreach"
PG_USER="outreach"
PG_VERSION="16"

# ────────────────────────────────────────────────────────────
# Args
# ────────────────────────────────────────────────────────────
UPDATE=0
SKIP_OS=0
NO_CADDY=0
for arg in "$@"; do
  case "$arg" in
    --update)    UPDATE=1 ;;
    --skip-os)   SKIP_OS=1 ;;
    --no-caddy)  NO_CADDY=1 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────
log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "Dit script vereist root (run met sudo)."
  fi
}

# Detect OS — we only support Ubuntu / Debian here.
detect_os() {
  if ! command -v apt-get >/dev/null 2>&1; then
    die "apt-get niet gevonden. Dit script is voor Ubuntu/Debian."
  fi
  . /etc/os-release || die "Kan /etc/os-release niet lezen."
  case "$ID" in
    ubuntu|debian) ok "Detected $PRETTY_NAME" ;;
    *) warn "Untested OS ($ID). Doorgaan op eigen risico." ;;
  esac
}

# ────────────────────────────────────────────────────────────
# OS dependencies
# ────────────────────────────────────────────────────────────
install_os_deps() {
  log "OS-packages installeren…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    curl ca-certificates gnupg lsb-release \
    git build-essential \
    postgresql-${PG_VERSION} postgresql-contrib \
    redis-server \
    debian-keyring debian-archive-keyring apt-transport-https
  ok "OS packages geïnstalleerd."
}

install_node() {
  if command -v node >/dev/null 2>&1 && node -v | grep -q "^v${NODE_MAJOR}\."; then
    ok "Node ${NODE_MAJOR} al aanwezig ($(node -v))."
    return
  fi
  log "Node ${NODE_MAJOR} installeren via NodeSource…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  ok "Node $(node -v) geïnstalleerd."
}

install_pnpm() {
  log "pnpm activeren via corepack…"
  corepack enable
  corepack prepare pnpm@9.12.0 --activate
  ok "pnpm $(pnpm -v) klaar."
}

install_caddy() {
  if [[ $NO_CADDY -eq 1 ]]; then
    warn "--no-caddy: Caddy overslaan. Configureer zelf je reverse proxy naar 127.0.0.1:3000."
    return
  fi
  if command -v caddy >/dev/null 2>&1; then
    ok "Caddy al aanwezig ($(caddy version | head -1))."
    return
  fi
  log "Caddy installeren…"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
  ok "Caddy $(caddy version | head -1) geïnstalleerd."
}

# ────────────────────────────────────────────────────────────
# OS user + repo
# ────────────────────────────────────────────────────────────
ensure_app_user() {
  if id -u "$APP_USER" >/dev/null 2>&1; then
    ok "OS-user '$APP_USER' bestaat al."
  else
    log "OS-user '$APP_USER' aanmaken…"
    useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" --create-home "$APP_USER"
    ok "Aangemaakt."
  fi
}

ensure_repo() {
  if [[ ! -d "$APP_DIR/.git" ]]; then
    die "Verwacht git repo in $APP_DIR (clone hem eerst)."
  fi
  log "Repo permissions zetten…"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  ok "Klaar."
}

# ────────────────────────────────────────────────────────────
# Setup wizard + Postgres provisioning
# ────────────────────────────────────────────────────────────
run_setup_wizard() {
  if [[ -f "$APP_DIR/.env" ]] && [[ $UPDATE -eq 0 ]]; then
    warn ".env bestaat al — wizard skip. Handmatig editen kan met:"
    warn "  sudo -u $APP_USER -- env HOME=$APP_DIR pnpm --dir=$APP_DIR setup"
    return
  fi
  if [[ $UPDATE -eq 1 ]]; then
    return
  fi

  log "Setup wizard starten (interactive)…"
  log "  Tip: Postgres-default 'postgres://outreach:<wachtwoord>@127.0.0.1:5432/outreach'"
  # Run as outreach user so files end up owned right.
  # `pnpm run setup` (not bare `pnpm setup`) avoids pnpm's built-in
  # `setup` command which requires an interactive shell and fails on
  # `nologin` users.
  sudo -u "$APP_USER" -- env HOME="$APP_DIR" \
    bash -c "cd $APP_DIR && pnpm install --frozen-lockfile && pnpm run setup"
}

provision_postgres() {
  log "Postgres user/database provisionen…"
  systemctl enable --now postgresql
  systemctl is-active --quiet postgresql || die "Postgres start niet — check 'systemctl status postgresql'."

  # Lees POSTGRES_PASSWORD uit .env (gegenereerd door wizard)
  local pg_pass
  pg_pass=$(grep -E '^POSTGRES_PASSWORD=' "$APP_DIR/.env" | sed 's/^POSTGRES_PASSWORD=//' | sed 's/^"\(.*\)"$/\1/')
  if [[ -z "$pg_pass" ]]; then
    die "POSTGRES_PASSWORD niet gevonden in $APP_DIR/.env. Run de wizard opnieuw."
  fi

  # Idempotent: create user als hij niet bestaat, anders password resetten.
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1; then
    log "Postgres user '${PG_USER}' bestaat — wachtwoord syncen met .env."
    sudo -u postgres psql -c "ALTER ROLE ${PG_USER} WITH PASSWORD '${pg_pass//\'/\'\'}';" >/dev/null
  else
    log "Postgres user '${PG_USER}' aanmaken…"
    sudo -u postgres psql -c "CREATE ROLE ${PG_USER} WITH LOGIN PASSWORD '${pg_pass//\'/\'\'}';" >/dev/null
  fi

  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
    ok "Postgres database '${PG_DB}' bestaat al."
  else
    log "Postgres database '${PG_DB}' aanmaken…"
    sudo -u postgres createdb -O "${PG_USER}" "${PG_DB}"
  fi

  # Sanity: kan de app verbinden?
  if PGPASSWORD="$pg_pass" psql -h 127.0.0.1 -U "${PG_USER}" -d "${PG_DB}" -c '\q' >/dev/null 2>&1; then
    ok "Postgres verbinding werkt."
  else
    die "Postgres verbinding faalt. Check pg_hba.conf voor 127.0.0.1 / scram-sha-256 of md5."
  fi
}

ensure_redis() {
  log "Redis enablen + starten…"
  systemctl enable --now redis-server || systemctl enable --now redis
  ok "Redis draait."
}

# ────────────────────────────────────────────────────────────
# App build
# ────────────────────────────────────────────────────────────
install_app() {
  log "pnpm install (frozen lockfile)…"
  sudo -u "$APP_USER" -- env HOME="$APP_DIR" \
    bash -c "cd $APP_DIR && pnpm install --frozen-lockfile"

  log "Database migraties…"
  # Source .env so DATABASE_URL is available to the migrate script.
  sudo -u "$APP_USER" -- env HOME="$APP_DIR" \
    bash -c "cd $APP_DIR && set -a && . ./.env && set +a && pnpm db:migrate"

  log "Web app builden (Next standalone)…"
  sudo -u "$APP_USER" -- env HOME="$APP_DIR" \
    bash -c "cd $APP_DIR && set -a && . ./.env && set +a && pnpm --filter @outreach/web build"
  ok "Build klaar."
}

# ────────────────────────────────────────────────────────────
# Systemd units
# ────────────────────────────────────────────────────────────
NODE_BIN=""
detect_node_bin() {
  NODE_BIN=$(command -v node)
  [[ -n "$NODE_BIN" ]] || die "node binary niet gevonden in PATH."
}

write_systemd_units() {
  detect_node_bin
  log "Systemd units schrijven…"

  cat > /etc/systemd/system/outreach-migrate.service <<EOF
[Unit]
Description=Outreach DB migrations (one-shot)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=oneshot
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=HOME=${APP_DIR}
ExecStart=${APP_DIR}/node_modules/.bin/tsx ${APP_DIR}/packages/db/src/migrate.ts
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/outreach-web.service <<EOF
[Unit]
Description=Outreach Dashboard (Next.js)
After=network.target postgresql.service outreach-migrate.service
Requires=postgresql.service
Wants=outreach-migrate.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=${NODE_BIN} ${APP_DIR}/apps/web/.next/standalone/apps/web/server.js
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/outreach-worker.service <<EOF
[Unit]
Description=Outreach BullMQ Worker (mail send loop)
After=network.target postgresql.service redis-server.service outreach-migrate.service
Requires=postgresql.service
Wants=redis-server.service outreach-migrate.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
Environment=HOME=${APP_DIR}
ExecStart=${APP_DIR}/node_modules/.bin/tsx ${APP_DIR}/scripts/worker.ts
Restart=on-failure
RestartSec=10

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/outreach-scheduler.service <<EOF
[Unit]
Description=Outreach BullMQ Tick Scheduler (one-shot)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=oneshot
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=HOME=${APP_DIR}
ExecStart=${APP_DIR}/node_modules/.bin/tsx ${APP_DIR}/scripts/schedule-ticks.ts
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  ok "Systemd units geschreven."
}

# ────────────────────────────────────────────────────────────
# Caddy
# ────────────────────────────────────────────────────────────
write_caddyfile() {
  if [[ $NO_CADDY -eq 1 ]]; then
    return
  fi
  local domain acme_email
  domain=$(grep -E '^DOMAIN=' "$APP_DIR/.env" | sed 's/^DOMAIN=//' | sed 's/^"\(.*\)"$/\1/')
  acme_email=$(grep -E '^ACME_EMAIL=' "$APP_DIR/.env" | sed 's/^ACME_EMAIL=//' | sed 's/^"\(.*\)"$/\1/')
  if [[ -z "$domain" || -z "$acme_email" ]]; then
    warn "DOMAIN of ACME_EMAIL ontbreekt in .env — Caddy config skip."
    return
  fi

  log "Caddyfile schrijven voor $domain…"
  cat > /etc/caddy/Caddyfile <<EOF
${domain} {
    tls ${acme_email}
    encode gzip zstd

    reverse_proxy 127.0.0.1:3000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    @webhooks path /api/webhooks/* /api/unsubscribe*
    handle @webhooks {
        request_body {
            max_size 25MB
        }
        reverse_proxy 127.0.0.1:3000
    }

    handle_errors {
        respond "Outreach dashboard is starting — try again in a few seconds." 502
    }
}
EOF
  ok "Caddyfile op /etc/caddy/Caddyfile."
}

# ────────────────────────────────────────────────────────────
# Start / restart services
# ────────────────────────────────────────────────────────────
start_services() {
  log "Services starten + enable on-boot…"
  systemctl enable --now outreach-web.service
  systemctl enable --now outreach-worker.service
  # scheduler runt eenmalig — gewoon `start`, niet enable.
  systemctl start outreach-scheduler.service || true
  if [[ $NO_CADDY -eq 0 ]]; then
    systemctl reload caddy 2>/dev/null || systemctl restart caddy
  fi
  ok "Alles draait."
}

restart_services() {
  log "Services herstarten (na update)…"
  systemctl restart outreach-web.service
  systemctl restart outreach-worker.service
  systemctl start outreach-scheduler.service || true
  if [[ $NO_CADDY -eq 0 ]]; then
    systemctl reload caddy 2>/dev/null || systemctl restart caddy
  fi
}

# ────────────────────────────────────────────────────────────
# Update flow
# ────────────────────────────────────────────────────────────
do_update() {
  log "Update modus: git pull + rebuild + restart"
  sudo -u "$APP_USER" -- bash -c "cd $APP_DIR && git pull --ff-only"
  install_app
  restart_services
  print_summary_update
}

# ────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────
print_summary_install() {
  local domain
  domain=$(grep -E '^DOMAIN=' "$APP_DIR/.env" 2>/dev/null | sed 's/^DOMAIN=//' | sed 's/^"\(.*\)"$/\1/' || echo "<onbekend>")
  cat <<EOF

────────────────────────────────────────────────────────────
✓ Installatie klaar
────────────────────────────────────────────────────────────

Dashboard:  https://${domain}/leads
Logs:       sudo journalctl -u outreach-web -u outreach-worker -f
Restart:    sudo systemctl restart outreach-web outreach-worker
Update:     sudo bash $APP_DIR/scripts/install.sh --update

Eerste run (als ${APP_USER}):
  sudo -u ${APP_USER} -- bash -c 'cd ${APP_DIR} && pnpm discover --niche=kapper --city=Utrecht --radius=5000'
  sudo -u ${APP_USER} -- bash -c 'cd ${APP_DIR} && pnpm enrich --concurrency=10'
  sudo -u ${APP_USER} -- bash -c 'cd ${APP_DIR} && pnpm seed-campaign --name="Q2 Kappers" --activate'
  sudo -u ${APP_USER} -- bash -c 'cd ${APP_DIR} && pnpm assign-leads --campaign="Q2 Kappers" --no-website'

De BullMQ scheduler triggert vanaf nu elke ${TICK_INTERVAL_MIN:-5} min een tick.
EOF
}

print_summary_update() {
  cat <<EOF

────────────────────────────────────────────────────────────
✓ Update klaar
────────────────────────────────────────────────────────────

Logs: sudo journalctl -u outreach-web -u outreach-worker -f --since "1 min ago"
EOF
}

# ────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────
main() {
  require_root
  detect_os

  if [[ $UPDATE -eq 1 ]]; then
    do_update
    return
  fi

  if [[ $SKIP_OS -eq 0 ]]; then
    install_os_deps
    install_node
    install_pnpm
    install_caddy
  else
    warn "--skip-os: OS deps niet geinstalleerd."
  fi

  ensure_app_user
  ensure_repo
  run_setup_wizard
  provision_postgres
  ensure_redis
  install_app
  write_systemd_units
  write_caddyfile
  start_services
  print_summary_install
}

main "$@"
