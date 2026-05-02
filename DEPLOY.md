# VPS Deployment

Eén-host deploy met Docker Compose. Geschikt voor één agency: je krijgt
Postgres, Redis, de Next.js dashboard, een long-running BullMQ worker en
automatische HTTPS via Caddy + Let's Encrypt — allemaal achter één
`docker compose up -d`.

> Je kunt natuurlijk ook deployen op Render / Railway / Fly.io zonder
> Docker Compose; deze guide focust op een kale VPS (~€5/maand).

---

## Wat je nodig hebt

- Een VPS (1 vCPU, 2 GB RAM is genoeg) — Hetzner CX22, DigitalOcean
  $6 droplet, Vultr, etc.
- Een domein (bv. `outreach.jouw-agency.nl`) waarvan je de DNS beheert
- Een Google Cloud project met **Places API (New)**, **Geocoding API** en
  optioneel **PageSpeed Insights API** ingeschakeld + één API-key
- Eén van:
  - Een **Postmark** account (server token + verified sender domain), of
  - Een **SMTP-server** met user + app-password (eigen domein, Fastmail,
    Workspace, eigen mailserver, etc.)

Optioneel:
- **Anthropic API key** voor AI-personalisatie (~€10/maand bij 1000 sends)
- **Hunter.io key** voor betere e-mail enrichment

---

## Setup in 7 stappen

### 1. SSH naar de VPS in en installeer Docker

```bash
ssh root@<vps-ip>
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

### 2. DNS A-record

Wijs `outreach.jouw-agency.nl` (of welke hostname je wil) naar het
publieke IP van de VPS:

```
Type   Name        Value         TTL
A      outreach    <vps-ip>      300
```

Wacht een paar minuten tot de DNS propageert
(`dig outreach.jouw-agency.nl` op je laptop checkt het).

### 3. Clone de repo

```bash
git clone https://github.com/ifago1/IFago-outrank.git /opt/outreach
cd /opt/outreach
```

### 4. Run de setup wizard

```bash
# Voor de wizard heb je tsx nodig — een keer lokaal pnpm install,
# of voer het in een Node container uit:
docker run --rm -it -v "$PWD:/app" -w /app node:22-alpine sh -c \
  "corepack enable && pnpm install --frozen-lockfile && pnpm setup"
```

De wizard prompt om:
- Postgres password (auto-generated, gewoon enter drukken)
- DATABASE_URL (kant-en-klaar default voor docker-compose)
- DOMAIN + ACME_EMAIL (voor Let's Encrypt)
- Mail-provider keuze (postmark of smtp) + bijbehorende velden
- FROM_EMAIL / FROM_NAME
- Google Places API key
- Optionele Anthropic + Hunter keys
- Daglimiet + warmup ramp + bounce circuit (defaults zijn redelijk)

Geheime tokens (`UNSUBSCRIBE_SECRET`, `POSTMARK_INBOUND_WEBHOOK_SECRET`,
`DASHBOARD_AUTH_PASS`) worden automatisch gegenereerd. Het resultaat
staat in `.env` met permissions `0600`.

### 5. Start de stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Wat er gebeurt:
1. `postgres` + `redis` starten en worden healthy
2. `migrate` past alle pending migraties toe en exit 0
3. `web` (Next.js) + `worker` (BullMQ) + `scheduler` starten
4. `caddy` ziet de eerste HTTPS-request, vraagt automatisch een
   Let's Encrypt certificaat aan voor je domein, en zet HSTS aan

Eerste boot duurt ~3-5 min op een 1 vCPU machine (vooral Docker images
bouwen). Daarna `docker compose up -d` zonder rebuild = ~10 sec.

### 6. Verifieer

```bash
# Stack health
docker compose -f docker-compose.prod.yml ps

# Live logs
docker compose -f docker-compose.prod.yml logs -f web worker
```

Open `https://outreach.jouw-agency.nl/leads` in je browser. Login met
de credentials die de wizard liet zien.

### 7. Webhook configureren (Postmark only)

In de Postmark dashboard:
- **Servers → jouw server → Inbound** → set Webhook URL naar
  `https://outreach.jouw-agency.nl/api/webhooks/postmark`
- **Authorization** header: `Bearer <waarde van POSTMARK_INBOUND_WEBHOOK_SECRET>`
- **Bounce/Open/SpamComplaint webhook** → zelfde URL (de handler herkent
  beide branches)

---

## Eerste run: leads ophalen + mails sturen

Vanuit de VPS, in `/opt/outreach`:

```bash
# 1. Leads ontdekken
docker compose -f docker-compose.prod.yml exec worker pnpm discover \
    --niche="kapper" --city="Utrecht" --radius=5000

# 2. Website-quality scoren (heuristisch)
docker compose -f docker-compose.prod.yml exec worker pnpm score-websites

# 3. E-mailadressen verrijken (parallel)
docker compose -f docker-compose.prod.yml exec worker pnpm enrich --concurrency=10

# 4. Eerste campagne aanmaken (default 3-step sequence)
docker compose -f docker-compose.prod.yml exec worker pnpm seed-campaign \
    --name="Kappers Utrecht Q2" --niche=kapper --activate

# 5. Leads aan campagne toewijzen
docker compose -f docker-compose.prod.yml exec worker pnpm assign-leads \
    --campaign="Kappers Utrecht Q2" --no-website --limit=20

# Vanaf nu: de scheduler draait elke 5 min een tick. Niets meer doen.
```

---

## Updates

```bash
cd /opt/outreach
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migraties draaien automatisch via het `migrate` service voordat web/worker
restarten.

---

## Backups

Postgres data zit in een Docker volume. Dagelijkse dump:

```bash
# /etc/cron.daily/outreach-backup
docker compose -f /opt/outreach/docker-compose.prod.yml exec -T postgres \
    pg_dump -U outreach outreach \
    | gzip > /var/backups/outreach-$(date +%F).sql.gz
find /var/backups -name "outreach-*.sql.gz" -mtime +30 -delete
```

Voor restore: `gunzip < x.sql.gz | docker compose ... exec -T postgres psql -U outreach outreach`.

---

## Operationele commands

```bash
# AVG-verzoek tot verwijdering (Art. 17)
docker compose -f docker-compose.prod.yml exec worker \
    pnpm gdpr --email=lead@x.nl --purge --confirm

# Inzage (Art. 15) — JSON dump
docker compose -f docker-compose.prod.yml exec worker \
    pnpm gdpr --email=lead@x.nl --export --out=/tmp/dump.json

# DB-shell
docker compose -f docker-compose.prod.yml exec postgres \
    psql -U outreach outreach

# Worker handmatig herstarten (na .env wijzigingen)
docker compose -f docker-compose.prod.yml restart worker scheduler
```

---

## Resource sizing

Bij ~50 sends/dag op een vergelijkbare schaal:

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

**Caddy krijgt geen certificaat**: check dat `dig DOMAIN` op je laptop het
juiste IP teruggeeft. Caddy probeert elke ~10 min opnieuw —
`docker compose -f docker-compose.prod.yml logs caddy` toont waarom.

**Worker exit met "POSTMARK_SERVER_TOKEN required"**: je hebt
`MAILER_PROVIDER=postmark` (default) maar geen token gezet. Re-run
`pnpm setup` of edit `.env` en `docker compose ... restart worker`.

**Migration fail**: kijk in `docker compose ... logs migrate`. Meestal
een eerder gefaalde migratie die handmatig fixen vereist
(`docker compose ... exec postgres psql ... -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"` voor een complete reset — let op, alle data weg).

**Geen mails worden gestuurd**: check `/stats` op het dashboard. Mogelijke
oorzaken: buiten send-window (`SEND_WINDOW_*`), daglimiet bereikt
(`DAILY_SEND_LIMIT`), bounce-circuit open (`/stats` toont rate), of geen
leads in `queued` status (campagne is misschien `draft`, of er zijn nog
geen leads toegewezen).
