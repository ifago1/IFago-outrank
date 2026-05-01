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
│   ├── enrichment/             Website scraper + Hunter + MX validator
│   ├── templates/              Mustache-style template engine + unsub tokens
│   ├── mailer/                 Postmark SDK wrapper + MockMailer
│   └── sequencer/              Pre-send guards + tick worker + reply matcher
├── scripts/
│   ├── discover.ts             Module 1 — Google Places ingest
│   ├── enrich.ts               Module 3 — find emails for businesses
│   ├── seed-campaign.ts        Module 4 — create campaign + default sequence
│   ├── assign-leads.ts         Module 4 — add contacts as leads
│   └── send-tick.ts            Module 5 — run one pass of the sequencer
├── docker-compose.yml          Lokaal Postgres + Redis
└── .env.example
```

## Vereisten

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
# 1. Lead Discovery — Google Places
pnpm discover --niche="kapper" --city="Utrecht"

# 2. Enrichment — vind emailadressen via website + Hunter (optioneel)
pnpm enrich --limit=20

# 3. Campagne aanmaken (default 3-step sequence uit het projectplan)
pnpm seed-campaign --name="Kappers Utrecht Q2" --niche=kapper --activate

# 4. Leads toewijzen aan de campagne
pnpm assign-leads --campaign="Kappers Utrecht Q2" --no-website --limit=20

# 5. Sequencer draaien (één tick — zet als cron, bv. elke 15 min)
pnpm send-tick --dry-run         # eerst valideren
pnpm send-tick                   # echt sturen
```

## CLIs in detail

| Script | Wat het doet |
|---|---|
| `pnpm discover` | Google Places Text Search → upsert in `businesses` op `place_id` |
| `pnpm enrich` | Voor businesses zonder contact: scrape website (`/contact`, `/over-ons`, etc.) + optioneel Hunter Domain Search → MX-valideren → upsert in `contacts` |
| `pnpm seed-campaign` | Maakt een campagne + 3-step sequence aan (idempotent op naam) |
| `pnpm assign-leads` | Filtert contacten en maakt `campaign_leads` aan |
| `pnpm send-tick` | 1× sequencer-tick: pak due leads, evalueer 5 guards, render template, verstuur via Postmark, log in `emails_sent` |

Elke CLI ondersteunt `--help` en (waar zinvol) `--dry-run`.

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
- ⬜ **Module 2** — Website-quality scoring (Lighthouse, viewport-check)
- ⬜ AI-personalisatie van `personal_observation` via Claude API
- ⬜ A/B-testen op subject/body
- ⬜ BullMQ voor distributed sends (huidige tick is single-process)

## Juridisch (lees vóór live versturen)

- AVG / GDPR — verwerkingsgrond "gerechtvaardigd belang" voor B2B cold mail
- Telecommunicatiewet art. 11.7 (NL) — duidelijke afzender, werkende
  afmeldlink in elke mail, geen mails na afmelding
- Elke mail bevat een `List-Unsubscribe` + `List-Unsubscribe-Post` header
  (RFC 8058) en een zichtbare unsub-link in de body
- Globale `unsubscribes` tabel wordt vóór elke verzending gecheckt (guard #1)
- Hard-bounces (`HardBounce` / `SpamComplaint`) komen automatisch in
  `unsubscribes` zodat we ze nooit meer mailen
