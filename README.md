# IFago-outrank — Outreach Tool

(Semi-)geautomatiseerde cold-outreach tool voor een webdesign agency. Vindt
lokale bedrijven via Google Places, filtert op leads zonder (goede) website,
verrijkt contactgegevens en stuurt gepersonaliseerde mail-sequences met
automatische opvolging en reply-detectie.

> **Status:** Modules 1, 3, 4, 5, 6 + dashboard implemented. Een end-to-end
> outreach-cycle is nu mogelijk via CLI + dashboard. Module 2 (website
> quality scoring) en de optionele AI-personalisatie zijn nog open.

---

## Monorepo layout

```
.
├── apps/
│   └── web/                    Next.js 15 dashboard + API routes
│       └── app/
│           ├── (dashboard)/    Leads, Campaigns, Inbox, Stats, Settings
│           └── api/
│               ├── webhooks/postmark/   Reply + bounce handler
│               └── unsubscribe/         RFC 8058 one-click unsubscribe
├── packages/
│   ├── db/                     Drizzle schema + migraties + Postgres client
│   ├── places/                 Google Places API (New) client
│   ├── website-quality/        HTTP/SSL/mobile/legacy heuristics + scorer
│   ├── enrichment/             Website scraper + Hunter + MX validator
│   ├── templates/              Mustache-style template engine + unsub tokens
│   ├── mailer/                 Postmark SDK wrapper + MockMailer
│   ├── ai-personalization/     Anthropic SDK — Claude-generated "personal observation"
│   ├── queue/                  BullMQ wrapper (Redis) for distributed sends
│   └── sequencer/              Pre-send guards + tick worker + reply matcher + variant selector
├── scripts/
│   ├── discover.ts             Module 1 — Google Places ingest
│   ├── score-websites.ts       Module 2 — audit homepages, set quality bucket
│   ├── enrich.ts               Module 3 — find emails for businesses
│   ├── seed-campaign.ts        Module 4 — create campaign + default sequence
│   ├── assign-leads.ts         Module 4 — add contacts as leads
│   ├── send-tick.ts            Module 5 — run one pass of the sequencer
│   ├── worker.ts               BullMQ worker process (production: pm2/systemd)
│   └── schedule-ticks.ts       Idempotent: register the recurring tick job
├── docker-compose.yml          Lokaal Postgres + Redis
└── .env.example
```

## VPS deploy in 5 minuten

Voor productie op een eigen Ubuntu/Debian VPS — zie
**[DEPLOY.md](./DEPLOY.md)** voor de volledige walkthrough. Twee paden:

**Bare-metal** (aanbevolen — geen Docker nodig):

```bash
git clone https://github.com/ifago1/IFago-outrank.git /opt/outreach
cd /opt/outreach
sudo bash scripts/install.sh
```

Installeert Postgres 16, Redis 7, Node 22, Caddy met auto-HTTPS,
systemd units voor web + worker + scheduler. Idempotent en
update-friendly (`sudo bash scripts/install.sh --update`).

**Docker Compose** (alternatief — als je liever container-isolation hebt):

```bash
git clone https://github.com/ifago1/IFago-outrank.git /opt/outreach
cd /opt/outreach
pnpm setup                                          # interactive .env
docker compose -f docker-compose.prod.yml up -d --build
```

## Vereisten (lokale dev)

- Node.js 20+ (getest op 22; pin via `.nvmrc`)
- pnpm 9+
- Docker
- Een Google Cloud project met de **Places API (New)** ingeschakeld

## Setup

```bash
pnpm install
cp .env.example .env             # vul in elk geval DB + Places API key in
docker compose up -d             # Postgres + Redis
pnpm db:migrate                  # past 0000_init + 0001_unique_indexes toe
pnpm dev                         # dashboard op http://localhost:3000
```

## End-to-end voorbeeldcyclus

```bash
# 1. Lead Discovery — Google Places (incluis auto-enrichment van nieuwe leads)
pnpm discover --niche="kapper" --city="Utrecht"

# 2. Website-quality scoring — audit homepages, score `outdated|decent|good`
pnpm score-websites --limit=20

# 3. Enrichment voor bestaande leads — backfill een batch handmatig
#    (loopt sinds v0.2 ook automatisch elke 6 uur via de BullMQ enrich-poll)
pnpm enrich --limit=20

# 4. Campagne aanmaken (default 3-step sequence uit het projectplan)
pnpm seed-campaign --name="Kappers Utrecht Q2" --niche=kapper --activate

# 5. Leads toewijzen aan de campagne
pnpm assign-leads --campaign="Kappers Utrecht Q2" --no-website --limit=20

# 6. Sequencer draaien (één tick — zet als cron, bv. elke 15 min)
pnpm send-tick --dry-run         # eerst valideren
pnpm send-tick                   # echt sturen
```

## CLIs in detail

| Script | Wat het doet |
|---|---|
| `pnpm discover` | Google Places Text Search → upsert in `businesses` op `place_id` + auto-enrichment van nieuwe leads (website-scrape, optioneel Hunter) |
| `pnpm score-websites` | Audit homepages (HTTPS, viewport, table-layout, jQuery 1.x, Flash, X-UA-Compatible, doctype, copyright-year) → bucket `outdated|decent|good` in `businesses.website_quality` |
| `pnpm enrich` | Backfill voor businesses zonder contact óf waarvan de laatste poging > 90 dagen oud is: scrape website (`/contact`, `/over-ons`, etc.) + optioneel Hunter → MX-valideren → upsert in `contacts`. Stempelt `enrichment_attempted_at` zodat herhaalde runs leads zonder mail niet opnieuw scrapen. Loopt ook automatisch via de `outreach-enrich` BullMQ poll (default elke 6u). |
| `pnpm poll-inbox` | Eén-malig de IMAP-mailbox scannen op replies + bounces, matchen aan campaign-leads en `replied_at` / `bounced` zetten. Hard bounces gaan ook automatisch in `unsubscribes` + `do_not_contact`. Loopt ook automatisch via de `outreach-inbox` BullMQ poll (default elke 10 min). Vereist `IMAP_*` env-vars (of fallback op `SMTP_*` voor providers waar credentials gedeeld zijn — bv. mailprotect.be, Combell, Fastmail). |
| `pnpm seed-campaign` | Maakt een campagne + 3-step sequence aan (idempotent op naam) |
| `pnpm assign-leads` | Filtert contacten en maakt `campaign_leads` aan |
| `pnpm send-tick` | 1× sequencer-tick: pak due leads, evalueer 5 guards, render template, verstuur via Postmark, log in `emails_sent` |

Elke CLI ondersteunt `--help` en (waar zinvol) `--dry-run`.

## Automation features (auto-pilot mode)

Naast de basics draaien er een aantal optionele "auto-pilot" features:

| Feature | Trigger | Wat het doet |
|---|---|---|
| **Auto-enrichment** | nieuwe lead in `runDiscovery` + 6u backfill-poll | Website-scrape voor contactgegevens, optioneel Hunter |
| **Auto-assign leads → campagnes** | nieuwe contact via enrichment | Matcht op `auto_assign_*` kolommen op campagnes (niche / city / website_quality) en plaatst lead in eerste matchende actieve campagne |
| **IMAP reply/bounce detectie** | elke 10 min | Scant FROM_EMAIL mailbox, matched op `In-Reply-To`/`References`, zet `replied_at`/`bounced` |
| **AI reply-triage** | wanneer `ANTHROPIC_API_KEY` gezet is | Classifeert elke reply als positive / question / negative / out_of_office / referral / unknown — dashboard `/inbox` toont kleurpills + samenvatting |
| **Thompson-sampling A/B** | wanneer `VARIANT_SELECTION=thompson` | Kiest variant op basis van historische reply-rate i.p.v. statische weights, met cold-start exploration |
| **Smart warmup** | wanneer `SMART_WARMUP=true` (en `WARMUP_DAYS`/`FLOOR` gezet) | Dailylimit groeit linear, maar wordt × 0.5 bij bounce > 5%, × 0.75 bij bounce > 3%, × 1.25 bij reply > 5% |
| **Daily digest mail** | cron (default 08:00 Europe/Amsterdam) | Stuurt KPIs van afgelopen 24u naar `DIGEST_EMAIL` (of `FROM_EMAIL`) |

Configureer via `.env` of de Settings-tab — geen restart nodig, settings worden per tick opnieuw gelezen.

## Pre-send guards (volgorde uit het plan)

`packages/sequencer` evalueert per lead, in deze exacte volgorde:

1. Email staat niet in `unsubscribes`
2. Contact heeft `do_not_contact = false`
3. Bedrijf heeft geen actieve lead in een andere campagne (override mogelijk)
4. Het is binnen het verzendvenster (`SEND_WINDOW_*` + `SEND_WEEKDAYS`)
5. Daglimiet (`DAILY_SEND_LIMIT`) niet bereikt

Hard-stop reasons (1, 2, 3) takelen de lead permanent uit. Soft-defer reasons
(4, 5) laten `next_send_at` ongemoeid zodat de volgende tick het opnieuw
probeert.

## Webhooks

- **`POST /api/webhooks/postmark?secret=...`** — Postmark inbound + bounce
  webhook. Matcht replies via `In-Reply-To`/`References` headers tegen
  `emails_sent.message_id` en zet de lead op `replied`. Bij hard-bounce wordt
  de adres aan `unsubscribes` toegevoegd. Auth via `?secret=` matchend met
  `POSTMARK_INBOUND_WEBHOOK_SECRET`.
- **`GET/POST /api/unsubscribe?t=...`** — Verifieert het HMAC-token
  (`UNSUBSCRIBE_SECRET`), voegt het email toe aan `unsubscribes` en zet
  `contacts.do_not_contact = true`. POST is voor RFC 8058 one-click; GET
  toont een nette HTML-pagina aan een mens.

## Dashboard

Pages beschikbaar op http://localhost:3000:

- **/leads** — Tabel met alle businesses, filters op niche/stad/website, plus per-business contact- en lead-counts.
- **/campaigns** + **/campaigns/[id]** — Overzicht en sequence-detail (incl. variabelen-introspectie).
- **/inbox** — Replies + bounces, gesorteerd op laatst-event.
- **/stats** — Totalen, reply rate %, bounce rate %, per-campagne breakdown.
- **/settings** — Env-var checklist (read-only): wat is er al geconfigureerd, wat ontbreekt.

## Mail-provider keuze: Postmark of SMTP

Twee implementaties van het `Mailer` interface:

```env
# Default: Postmark (HTTP API — auto SPF/DKIM/DMARC + bounce-webhook)
MAILER_PROVIDER=postmark
POSTMARK_SERVER_TOKEN=...

# Of: jouw eigen SMTP-server
MAILER_PROVIDER=smtp
SMTP_HOST=smtp.fastmail.com
SMTP_PORT=587               # 587 = STARTTLS, 465 = implicit TLS
SMTP_USER=jouw@agency.nl
SMTP_PASS=app-password
SMTP_SECURE=false           # true voor 465, false voor 587
SMTP_MAX_CONNECTIONS=5      # parallel connecties (optioneel)
SMTP_RATE_LIMIT=10          # max berichten per SMTP_RATE_DELTA_MS (optioneel)
SMTP_RATE_DELTA_MS=1000
```

`@outreach/config` weigert te starten als de gekozen provider niet
volledig gedoceerd is. SMTP gebruikt nodemailer onder de motorkap met
connection pooling, optionele rate limiting, en exact dezelfde headers
(threading via `In-Reply-To`/`References`, RFC 8058 `List-Unsubscribe`)
als de Postmark-implementatie.

> **Async bounces bij SMTP**: synchronous SMTP-fouten (550 unknown user
> tijdens de SMTP-transactie) komen direct terug en worden door het
> sequencer-error-pad opgepikt. NDR-bounces die later als reply
> binnenkomen vereisen IMAP-polling — niet ingebouwd, niet kritiek voor
> MX-gevalideerde lijsten. Wil je full bounce-coverage zonder eigen
> infra: gebruik Postmark.

## Production: BullMQ worker

Voor productie draai je niet `send-tick` als cron — je gebruikt BullMQ:

```bash
# Eenmalig op deploy: registreer de recurring tick (idempotent, default elke 5 min)
pnpm schedule-ticks

# Long-running worker process — supervise met systemd / pm2 / Render / Railway
pnpm worker
```

De worker leest jobs uit Redis, runt de sequencer (zelfde guards/template/AI-stack als de CLI), en logt per-tick stats. `concurrency` staat default op 1 om de daglimiet te respecteren — verhoog via een env var alleen als je écht parallel wilt sturen vanuit meerdere pods.

## A/B varianten

Voeg een variant toe aan een sequence step (handmatig of via SQL):

```sql
INSERT INTO sequence_step_variants (step_id, label, weight, subject_template, body_template)
VALUES
  ('<step-uuid>', 'A — kort', 1, 'Vraag over {{business_name}}', '...'),
  ('<step-uuid>', 'B — direct', 1, 'Snel iets bij {{business_name}}', '...');
```

De sequencer pakt automatisch een variant op (weighted random op `weight`). Zonder varianten valt het terug op de step's eigen `subject_template`/`body_template`. Per-variant performance staat op `/stats` onderaan.

## AI personalisatie

Met `ANTHROPIC_API_KEY` set roept de sequencer Claude (default `claude-opus-4-7`) aan om de `{{personal_observation}}` regel per business te schrijven. Het resultaat wordt gecached in `businesses.personal_observation` zodat we voor één business max één API-call doen, ongeacht hoeveel sequence steps er zijn. Zonder key valt alles terug op de heuristiek.

Wil je goedkoper? Wijzig de model-string in `packages/ai-personalization/src/anthropic-personalizer.ts` van `claude-opus-4-7` naar `claude-haiku-4-5` — voor een-zin output is Haiku ruim voldoende.

## Tests

```bash
pnpm -r test          # 60 vitest cases over 5 packages
pnpm -r typecheck
pnpm --filter @outreach/web build
pnpm --filter @outreach/web lint
```

CI draait dit alles op elke PR via `.github/workflows/ci.yml`.

## Database

- Schema: `packages/db/src/schema.ts`
- Migraties: `packages/db/drizzle/`
- Studio: `pnpm db:studio`

```bash
pnpm db:generate    # diff schema -> nieuwe migratie
pnpm db:migrate     # past pending migraties toe
```

Unique indexen op `(business_id, email)` en `(campaign_id, contact_id)`
maken de upsert-paths in `enrich` en `assign-leads` idempotent.

## Roadmap

- ✅ **Module 1** — Lead discovery (Google Places)
- ✅ **Module 3** — Contact enrichment (scraper + Hunter + MX)
- ✅ **Module 4** — Campaign engine + template engine
- ✅ **Module 5** — Send/scheduling met 5 pre-send guards
- ✅ **Module 6** — Reply detection (Postmark webhook)
- ✅ **Module 7** — Unsubscribe-handling (RFC 8058)
- ✅ **Module 8** — Dashboard
- ✅ **Module 2** — Website-quality scoring (heuristieken; Lighthouse blijft als optionele upgrade)
- ✅ **AI-personalisatie** — Claude (`claude-opus-4-7`, default) genereert per-business observaties op basis van Google reviews; gecached op `businesses.personal_observation`. Heuristiek als fallback.
- ✅ **A/B-testen** — `sequence_step_variants` tabel; sequencer kiest weighted-random per send; per-variant breakdown op `/stats`.
- ✅ **BullMQ** — `packages/queue` + `pnpm worker` voor distributed sends. `pnpm schedule-ticks` registreert de recurring tick.

## Juridisch (lees vóór live versturen)

- AVG / GDPR — verwerkingsgrond "gerechtvaardigd belang" voor B2B cold mail
- Telecommunicatiewet art. 11.7 (NL) — duidelijke afzender, werkende
  afmeldlink in elke mail, geen mails na afmelding
- Elke mail bevat een `List-Unsubscribe` + `List-Unsubscribe-Post` header
  (RFC 8058) en een zichtbare unsub-link in de body
- Globale `unsubscribes` tabel wordt vóór elke verzending gecheckt (guard #1)
- Hard-bounces (`HardBounce` / `SpamComplaint`) komen automatisch in
  `unsubscribes` zodat we ze nooit meer mailen
