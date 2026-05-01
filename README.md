# IFago-outrank — Outreach Tool

(Semi-)geautomatiseerde cold-outreach tool voor een webdesign agency. Vindt
lokale bedrijven via Google Places, filtert op leads zonder (goede) website,
verrijkt contactgegevens en stuurt gepersonaliseerde mail-sequences.

> **Status:** Fase 1 (MVP) in opbouw — Lead Discovery werkt end-to-end via
> CLI. Enrichment, mailer en dashboard volgen in latere fases.

---

## Monorepo layout

```
.
├── apps/
│   └── web/                    Next.js 15 dashboard (placeholder)
├── packages/
│   ├── db/                     Drizzle schema + migraties + Postgres client
│   └── places/                 Google Places API (New) client
├── scripts/
│   └── discover.ts             CLI: leads ophalen en wegschrijven
├── docker-compose.yml          Lokaal Postgres + Redis
└── .env.example
```

## Vereisten

- Node.js 20+ (getest op 22)
- pnpm 9+
- Docker (voor lokale Postgres/Redis)
- Een Google Cloud project met de **Places API (New)** ingeschakeld en een API-key

## Setup

```bash
# 1. Dependencies
pnpm install

# 2. Env
cp .env.example .env
# vul in elk geval GOOGLE_PLACES_API_KEY en DATABASE_URL in

# 3. Lokale databases (Postgres + Redis)
docker compose up -d

# 4. Schema migreren
pnpm db:migrate
```

## Voorbeelden — Lead Discovery

```bash
# Dry run — alleen printen, niets schrijven (geen DB nodig)
pnpm discover --niche="kapper" --city="Utrecht" --dry-run

# Echt wegschrijven naar de businesses tabel
pnpm discover --niche="kapper" --city="Utrecht" --radius=5000

# Andere voorbeelden
pnpm discover --niche="restaurant" --city="Amsterdam" --page-size=20
pnpm discover --niche="fysiotherapeut" --city="Eindhoven"
```

De CLI dedupliceert op Google's `place_id` (UPSERT), dus rerunnen is veilig en
kost geen extra DB-rijen.

### Wat er in `businesses` belandt

Per place wordt opgeslagen: naam, categorie, stad, land, telefoon,
website-URL, Google rating, aantal reviews, en de volledige raw response in
`raw_places_data` (jsonb) voor latere analyses.

Een lege `website_url` => `website_quality = 'none'`. Dat zijn meteen de
hoogste-prio leads voor een webdesign agency.

## Tests

```bash
# Tests voor de Places-client (gemockte fetch)
pnpm --filter @outreach/places test

# Alles
pnpm test
```

## Typecheck

```bash
pnpm -r typecheck
```

## Database

- Schema: `packages/db/src/schema.ts`
- Initiële migratie: `packages/db/drizzle/0000_init.sql`
- Drizzle Studio: `pnpm db:studio`

Aanpassingen aan het schema:

```bash
pnpm db:generate    # genereert nieuwe migratie uit schema.ts
pnpm db:migrate     # past pending migraties toe
```

## Dashboard (placeholder)

```bash
pnpm dev    # http://localhost:3000
```

Het dashboard krijgt z'n eigen pagina's in fase 3 (zie projectplan sectie 6,
module 8).

---

## Roadmap

Volgens het projectplan (zie historie / oorspronkelijk plan):

- **Fase 1 — MVP**: Lead discovery (✅), enrichment, basale send via CLI.
- **Fase 2 — Automatisering**: BullMQ sequencer, reply-detectie via webhook,
  unsubscribe-handling, daglimieten en verzendvensters.
- **Fase 3 — Dashboard & Schaal**: Next.js dashboard, website-quality
  scoring, AI-personalisatie, A/B-testen.

## Juridisch (lees vóór live versturen)

- AVG / GDPR — verwerkingsgrond "gerechtvaardigd belang" voor B2B cold mail.
- Telecommunicatiewet art. 11.7 (NL) — duidelijke afzender, werkende
  afmeldlink in elke mail, geen mails na afmelding.
- Elke mail bevat een `List-Unsubscribe` header (RFC 8058) en een link naar
  de privacyverklaring (`AGENCY_PRIVACY_URL`).
- Globale `unsubscribes` tabel wordt vóór elke verzending gecheckt.
