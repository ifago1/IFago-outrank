# VPS Deployment

Twee paden: **bare-metal** (native systemd, geen Docker — aanbevolen voor
één-host setups) of **Docker Compose** (handig als je al Docker draait
of meerdere apps op dezelfde host hebt).

## Wat je nodig hebt voor beide paden

- Een Ubuntu 22.04 / Debian 12 VPS (1 vCPU, 2 GB RAM is genoeg) —
  Hetzner CX22, DigitalOcean $6 droplet, Vultr, etc.
- Een (sub)domein (bv. `outreach.jouw-agency.nl`) waarvan jij DNS
  beheert
- Een Google Cloud project met **Places API (New)**, **Geocoding API**
  en optioneel **PageSpeed Insights API** ingeschakeld + één API-key
- Eén van:
  - Een **Postmark** account (server token + verified sender domain), of
  - Een **SMTP-server** met user + app-password (Fastmail, Workspace,
    eigen mailserver, etc.)

Optioneel:
- **Anthropic API key** voor AI-personalisatie (~€10/maand bij 1000
  sends)
- **Hunter.io key** voor betere e-mail enrichment

---

# Pad A — Bare-metal (aanbevolen)

Eén shell-script dat alles installeert: Postgres 16, Redis 7, Node 22,
Caddy met auto-HTTPS, systemd units voor de app. Idempotent en
update-friendly.

### 1. SSH en clone

```bash
ssh root@<vps-ip>

apt-get update && apt-get install -y git
git clone https://github.com/ifago1/IFago-outrank.git /opt/outreach
cd /opt/outreach
```

### 2. DNS A-record

Wijs `outreach.jouw-agency.nl` (of welke hostname je wil) naar het
publieke IP van de VPS:

```
Type   Name        Value         TTL
A      outreach    <vps-ip>      300
```

Wacht tot de DNS gepropageerd is (`dig outreach.jouw-agency.nl` op je
laptop laat het vps-ip zien).

### 3. Run de installer

```bash
sudo bash scripts/install.sh
```

Wat hij doet:
1. Installeert OS-deps (Postgres 16, Redis 7, Caddy, Node 22, build-tools)
2. Activeert pnpm via corepack
3. Maakt OS-user `outreach` aan
4. Roept de **interactive setup wizard** aan (`pnpm setup`) — die prompt
   voor mail-provider config, FROM_EMAIL, Google API key etc., en
   genereert alle secrets automatisch (DB-wachtwoord, unsub-secret,
   webhook-secret, dashboard wachtwoord)
5. Maakt Postgres user/DB met het wachtwoord uit `.env`
6. Installeert deps + runt migraties + bouwt de Next.js standalone bundel
7. Schrijft 4 systemd units (`outreach-{web,worker,scheduler,migrate}`)
8. Schrijft `/etc/caddy/Caddyfile` met auto-HTTPS via Let's Encrypt
9. Start alles + enable on-boot

Eerste run duurt ~3-5 min (vooral apt + pnpm install). Aan het eind zie
je een summary met dashboard URL en credentials.

### 4. Verifieer

```bash
# Service health
systemctl status outreach-web outreach-worker

# Live logs (alle services tegelijk)
journalctl -u outreach-web -u outreach-worker -u outreach-scheduler -f

# Caddy / TLS
journalctl -u caddy -n 50
```

Open `https://outreach.jouw-agency.nl/leads` in je browser — login met
de credentials die de installer aan het eind toonde.

### 5. Webhook configureren (alleen voor Postmark)

In de Postmark dashboard:
- **Servers → jouw server → Inbound** → set Webhook URL naar
  `https://outreach.jouw-agency.nl/api/webhooks/postmark`
- Auth via header: `Authorization: Bearer <waarde van POSTMARK_INBOUND_WEBHOOK_SECRET uit .env>`
- **Bounce / SpamComplaint webhook** → zelfde URL (de handler herkent
  beide branches)

### Eerste run: leads ophalen + mails sturen

```bash
sudo -u outreach -- bash -c 'cd /opt/outreach && pnpm discover --niche=kapper --city=Utrecht --radius=5000'
sudo -u outreach -- bash -c 'cd /opt/outreach && pnpm score-websites'
sudo -u outreach -- bash -c 'cd /opt/outreach && pnpm seed-campaign --name="Kappers Utrecht Q2" --niche=kapper --activate'
sudo -u outreach -- bash -c 'cd /opt/outreach && pnpm assign-leads --campaign="Kappers Utrecht Q2" --no-website --limit=20'
```

`pnpm discover` doet sinds v0.2 ook automatisch de website-scrape voor
nieuwe leads — je hoeft niet meer apart `pnpm enrich` te draaien. Voor
**bestaande** leads die nog geen contact-info hebben loopt elke 6 uur
de `outreach-enrich` poll en handelt die door de backlog. Wil je 'm
direct triggeren? Dan nog steeds:

```bash
sudo -u outreach -- bash -c 'cd /opt/outreach && pnpm enrich --concurrency=10 --limit=200'
```

De BullMQ scheduler triggert daarna elke 5 min een tick — niets meer
doen.

### Updates

```bash
cd /opt/outreach
sudo bash scripts/install.sh --update
```

Wat dit doet: `git pull`, `pnpm install`, `pnpm db:migrate`,
`next build`, `systemctl restart outreach-web outreach-worker`.

### Verwijderen

```bash
sudo bash /opt/outreach/scripts/uninstall.sh
```

Stopt + disable't alle services, drop'st de Postgres DB+role, verwijdert
`/opt/outreach` en de OS-user. Postgres/Redis/Caddy/Node blijven staan
(handmatig met `apt purge` als je 100% wilt opruimen).

### Installer flags

```bash
sudo bash scripts/install.sh                    # eerste install
sudo bash scripts/install.sh --update           # update + restart
sudo bash scripts/install.sh --skip-os          # OS-deps al aanwezig
sudo bash scripts/install.sh --no-caddy         # eigen reverse proxy
```

`--no-caddy` is handig als je al Nginx of Traefik draait. De web-app
luistert dan op `127.0.0.1:3000` — proxy daar je eigen vhost naartoe
en zet HTTPS zelf op.

---

# Pad B — Docker Compose

Ook één commando, maar in containers. Geschikt als je liever container-
isolation hebt of meerdere apps deelt op dezelfde host.

### Stappen

```bash
ssh root@<vps-ip>
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

git clone https://github.com/ifago1/IFago-outrank.git /opt/outreach
cd /opt/outreach

# Setup wizard runnen in een Node container (we hebben pnpm nog niet host-side)
docker run --rm -it -v "$PWD:/app" -w /app node:22-alpine sh -c \
  "corepack enable && pnpm install --frozen-lockfile && pnpm setup"

docker compose -f docker-compose.prod.yml up -d --build
```

DNS A-record + webhook-config zijn identiek aan pad A.

---

## Backups (beide paden)

```bash
# /etc/cron.daily/outreach-backup (bare-metal)
sudo -u postgres pg_dump outreach | gzip > /var/backups/outreach-$(date +%F).sql.gz
find /var/backups -name "outreach-*.sql.gz" -mtime +30 -delete
```

```bash
# Docker variant
docker compose -f /opt/outreach/docker-compose.prod.yml exec -T postgres \
    pg_dump -U outreach outreach \
    | gzip > /var/backups/outreach-$(date +%F).sql.gz
```

Restore (bare-metal):
`gunzip < x.sql.gz | sudo -u postgres psql outreach`

Restore (Docker):
`gunzip < x.sql.gz | docker compose ... exec -T postgres psql -U outreach outreach`

---

## Operationele commands

| Doel | Bare-metal | Docker |
|---|---|---|
| Live logs | `journalctl -u outreach-web -u outreach-worker -f` | `docker compose -f docker-compose.prod.yml logs -f web worker` |
| Restart na env-wijziging | `sudo systemctl restart outreach-web outreach-worker` | `docker compose -f docker-compose.prod.yml restart web worker` |
| AVG-export (Art. 15) | `sudo -u outreach -- bash -c 'cd /opt/outreach && pnpm gdpr --email=lead@x.nl --export --out=/tmp/dump.json'` | `docker compose ... exec worker pnpm gdpr --email=lead@x.nl --export --out=/tmp/dump.json` |
| AVG-purge (Art. 17) | `sudo -u outreach -- bash -c 'cd /opt/outreach && pnpm gdpr --email=lead@x.nl --purge --confirm'` | `docker compose ... exec worker pnpm gdpr --email=lead@x.nl --purge --confirm` |
| DB-shell | `sudo -u postgres psql outreach` | `docker compose ... exec postgres psql -U outreach outreach` |

---

## Resource sizing

Bij ~50 sends/dag:

| Service | RAM idle | RAM piek |
|---|---|---|
| postgres | 30 MB | 100 MB |
| redis | 5 MB | 30 MB |
| web | 60 MB | 150 MB |
| worker | 80 MB | 200 MB |
| caddy | 15 MB | 30 MB |
| **Totaal** | **~200 MB** | **~500 MB** |

Een 2 GB VPS heeft ruim voldoende headroom voor 1000+ sends/dag.

---

## Troubleshooting

**Caddy krijgt geen certificaat**
Check dat `dig outreach.jouw-agency.nl` op je laptop het juiste IP
teruggeeft. Caddy probeert elke ~10 min opnieuw — `journalctl -u caddy`
(bare-metal) of `docker compose logs caddy` toont waarom.

**Worker exit met "POSTMARK_SERVER_TOKEN required"**
Je hebt `MAILER_PROVIDER=postmark` (default) maar geen token gezet.
Edit `/opt/outreach/.env` en `sudo systemctl restart outreach-worker`,
of re-run `pnpm setup`.

**Postgres "password authentication failed"**
Wachtwoord in `.env` matcht niet met wat in Postgres staat. Re-run de
installer (`sudo bash scripts/install.sh`) — die syncen de twee. Of
handmatig:
```bash
sudo -u postgres psql -c "ALTER ROLE outreach WITH PASSWORD '<nieuw>';"
```
en update `.env`.

**Migration faalt**
`journalctl -u outreach-migrate -n 50`. Bij twijfel een complete reset:
```bash
sudo -u postgres psql -d outreach -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
sudo systemctl start outreach-migrate
```
(let op: alle data weg).

**Geen mails worden gestuurd**
Check `/stats` op het dashboard. Mogelijke oorzaken:
- Buiten send-window (`SEND_WINDOW_*`)
- Daglimiet bereikt (`DAILY_SEND_LIMIT`)
- Bounce-circuit open (`/stats` toont rate)
- Geen leads in `queued` status — campagne is misschien nog `draft`,
  of er zijn nog geen leads toegewezen
