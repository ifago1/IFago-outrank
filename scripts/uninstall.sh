#!/usr/bin/env bash
#
# Schone verwijdering van een bare-metal install. Laat OS-deps
# (Postgres/Redis/Caddy/Node) staan — die heb je misschien voor andere
# apps. Verwijder die met apt purge als je 100% wilt opruimen.
#
# Wat dit doet:
#   - Stopt + disable's de outreach systemd services en verwijdert ze
#   - Verwijdert de Caddyfile (als hij door ons is geschreven)
#   - DROP'st de Postgres database + role
#   - Verwijdert /opt/outreach (vraagt eerst om bevestiging)
#   - Verwijdert de OS user 'outreach'
#
# Usage: sudo bash scripts/uninstall.sh [--yes]

set -euo pipefail

YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run als root (sudo)."; exit 1; }

confirm() {
  if [[ $YES -eq 1 ]]; then return 0; fi
  read -r -p "$1 [y/N] " ans
  [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]
}

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }

if ! confirm "Verwijder Outreach (services + db + /opt/outreach)?"; then
  echo "Geannuleerd."; exit 0
fi

log "Services stoppen + disablen…"
for svc in outreach-web outreach-worker outreach-scheduler outreach-migrate; do
  systemctl disable --now "${svc}.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/${svc}.service"
done
systemctl daemon-reload

if [[ -f /etc/caddy/Caddyfile ]] && grep -q "outreach" /etc/caddy/Caddyfile 2>/dev/null; then
  log "Caddyfile leeg-strippen…"
  : > /etc/caddy/Caddyfile
  systemctl reload caddy 2>/dev/null || true
fi

log "Postgres database + role droppen…"
sudo -u postgres dropdb --if-exists outreach || true
sudo -u postgres dropuser --if-exists outreach || true

if [[ -d /opt/outreach ]]; then
  log "/opt/outreach verwijderen…"
  rm -rf /opt/outreach
fi

if id -u outreach >/dev/null 2>&1; then
  log "OS-user 'outreach' verwijderen…"
  userdel outreach 2>/dev/null || true
fi

ok "Klaar. Postgres/Redis/Caddy/Node staan nog op het systeem (apt purge handmatig als je dat wil)."
