# Project Review

Snapshot van de codebase. Dit document is in twee passes geschreven:
- **Pass 1** (eerder commit): basis-fixes + lijst van bewust uitgestelde items
- **Pass 2** (nu): alle uitgestelde items uit pass 1 zijn ook geïmplementeerd

---

## 1. Pass 1 — fixes

| # | Bevinding | Fix |
|---|---|---|
| A1 | CI runde `lint` script niet | `ci.yml` krijgt `Lint (web)` step vóór tests |
| A2 | Postmark webhook auth via `?secret=` query-param leakt in access logs | Bearer-header support + constant-time comparator (query nog wel ondersteund voor backward-compat) |
| A3 | `discover.ts` accepteerde `--radius=N` maar gebruikte het nergens | Eerst flag opgeruimd; in pass 2 echt geïmplementeerd via Geocoding API |
| A4 | AI-model hardcoded `claude-opus-4-7` | `AI_MODEL` env override (default ongewijzigd; Haiku 4.5 is ~5x goedkoper) |
| A5 | `safeHost()` gedupliceerd | Dead copy uit `audit.ts` verwijderd |

## 2. Pass 2 — uitgestelde items, nu opgelost

### 2.1 ✅ Dashboard authentication
**Was:** dashboard open voor iedereen met de URL.
**Nu:** `apps/web/middleware.ts` doet HTTP basic auth wanneer
`DASHBOARD_AUTH_USER` + `DASHBOARD_AUTH_PASS` env vars gezet zijn.
Webhook + unsubscribe-routes zijn whitelisted (die hebben hun eigen
auth). Constant-time comparator. Zonder env vars = open (handig voor
lokale dev).

### 2.2 ✅ Multi-pod tick race
**Was:** twee workers konden dezelfde leads pakken.
**Nu:** `packages/queue` heeft een Redis-mutex (`tryAcquire` /
`withMutex`) en `createTickWorker` wrapt elke tick in
`outreach:tick-lock` (TTL 600s). Tweede tick die het lock niet kan
pakken logt en skipt cleanly. Gebruikt SET NX EX + Lua-release-script
zodat we nooit andermans lock killen.

### 2.3 ✅ AI prompt cache engageert
**Was:** system prompt ~700 chars, ver onder Opus 4.7 cache-minimum (4096
tokens).
**Nu:** system prompt herschreven met uitgebreid voorbeeldenboek (10+
input/output paren), schrijfformules, en anti-pattern voorbeelden.
Volgens token-counts ruim boven 4096 tokens — caching engageert nu echt
op elke tweede call. Bonus: meer few-shot voorbeelden = consistentere
output.

### 2.4 ✅ runSendTick integration test
**Was:** orchestratie van runSendTick uncovered.
**Nu:** `packages/sequencer/src/run-tick.integration.test.ts` met 6
end-to-end scenarios tegen een echte Postgres (happy path, unsubscribe,
A/B variant selectie, completion, send-window skip, dry-run).
Skipped lokaal als `TEST_DATABASE_URL` ontbreekt; CI spint een
postgres:16-alpine service container op (zie `.github/workflows/ci.yml`).

### 2.5 ✅ Places pagination
**Was:** max 20 results per call.
**Nu:** nieuwe `searchBusinessesAllPages({ maxPages })` walks
`nextPageToken` (max 3 pages = 60 results, Google's hard cap). De
oorspronkelijke `searchBusinesses()` blijft één-page voor backward-compat.
`discover` wired om `--max-pages=N` te accepteren.

### 2.6 ✅ Env-validation at startup
**Was:** typo in env var faalde pas bij eerste use.
**Nu:** nieuwe `packages/config` met Zod-schemas per script
(discover/enrich/send-tick/worker/etc.). `loadConfigOrExit("worker")`
valideert de hele slice in één keer, print elke ontbrekende/malformed
var en exit 1. Wired in `worker.ts`, `send-tick.ts`, `schedule-ticks.ts`,
`discover.ts`. 5 unit tests dekken slice-selectie, multi-error reporting,
en custom validators.

### 2.7 ✅ Unsubscribe token expiry
**Was:** tokens hebben geen expiry.
**Nu:** wire format gewijzigd naar `<email>.<iat>.<sig>` met
issued-at als base36 unix-seconds. Default max-age 90 dagen,
configureerbaar via `verifyUnsubscribeToken(token, secret, { maxAgeSeconds })`.
Backwards-compatible: legacy 2-part tokens verifiëren nog steeds maar
verlopen niet (met `issuedAt: null` als signaal). 3 nieuwe tests.

### 2.8 ✅ `personal_observation_source` column
**Was:** dead column.
**Nu:** wired in `/stats` als 3-stat blok ("AI-generated", "Heuristic
fallback", "Nog niet gegenereerd"). Geeft operators direct inzicht
in cache-hit ratio en LLM-coverage.

### 2.9 ✅ Geocoding voor `--radius`
**Was:** city → lat/lng resolution was niet geïmplementeerd.
**Nu:** nieuwe `packages/geocoding` met Google Geocoding API client
(zelfde API key als Places). `discover --radius=N` geocoded nu de
stad en geeft een echte `locationBias.circle` mee aan Places. Falt
back op text-only search bij ZERO_RESULTS. 5 unit tests (zelfde mock-
fetch pattern als Places).

### 2.10 ✅ Lighthouse-grade scoring (via PageSpeed Insights API)
**Was:** alleen heuristieken; Lighthouse blok-fixed op headless browser.
**Nu:** nieuwe `PsiClient` in `packages/website-quality/src/psi.ts` —
roept Google's hosted Lighthouse aan via PageSpeed Insights API. Geen
chromium dependency. Returns alle 4 categorie scores (performance,
accessibility, best-practices, seo) als 0-100. 6 unit tests met
gemockte fetch. Optioneel — alleen actief als de gebruiker wil
combineren met heuristieken (heuristisch is nu nog steeds de default
in `WebsiteScorer.audit()` voor snelheid).

---

## 3. Test coverage overview

| Package | Unit | Integration | Highlights |
|---|---|---|---|
| places | 9 | — | Headers, field mask, pagination, normalization |
| website-quality | 36 | — | 12 heuristic signals + bucketing + **PSI client** |
| enrichment | 24 | — | Validator, scraper, Hunter, **mapWithConcurrency** |
| templates | 17 | — | render() + HMAC token round-trip + expiry + legacy compat |
| mailer | 3 | — | Postmark payload, threading, error |
| sequencer | 20 | **6** | preSendCheck, variant selector, **end-to-end runSendTick** |
| ai-personalization | 4 | — | buildUserPrompt formatting |
| queue | 1 | — | Stable queue name |
| config | 5 | — | Slice validation, multi-error reporting |
| geocoding | 5 | — | Happy path, ZERO_RESULTS, REQUEST_DENIED |
| **Total** | **124** | **6** | (was 113 unit only in pass 2) |

Integration tests skip locally without `TEST_DATABASE_URL`; CI runs
them against a Postgres service container.

**Untested paths** (low priority):
- Webhook handlers (Postmark inbound + unsubscribe HTTP layer)
- Dashboard server-component data-fetching (mostly direct Drizzle queries
  whose pieces are tested elsewhere)

---

## 4. Performance — pass 3 fixes

| Was | Nu |
|---|---|
| Inline subqueries op `/stats` worden traag bij >10k leads | Composite indexen toegevoegd in **migratie 0003**: `campaign_leads(status, next_send_at)` partial, `emails_sent(message_id)` partial, `emails_sent(campaign_lead_id, step_order)`, `campaign_leads(last_event_at desc)` partial voor `/inbox` |
| AI personalisatie: prompt cache engageerde niet (zie 2.3) | System prompt boven 4096-token threshold; eerste call schrijft cache (1.25×), daarna ~10× discount |
| `EnrichmentService` was sequentieel (scraper → Hunter → MX per business) | Nieuwe `enrichBatch()` met configurable concurrency (default 5). `pnpm enrich --concurrency=10` gebruikt het. Per-business `Promise.allSettled`-stijl: één failure sinkt de batch niet |

---

## 5. Eindstand

Implementatie-volledig. Wat er nog bewust open ligt is alleen
**materiealiseerde stats-views**, en die zijn pas relevant bij >100k
emails sent — voor MVP is de huidige inline-aggregatie + composite
indexen ruim voldoende.

De codebase telt nu:
- **13 packages** + 1 Next.js app
- **130 tests** (124 unit + 6 integration)
- **9 CLI scripts** + 2 webhook routes + 5 dashboard pages
- **3 schema migraties**
- HTTP basic auth, Redis-mutex, env-validation, prompt-cache-engaged AI,
  parallel enrichment, geocoding, A/B testing, BullMQ workers — alles geïntegreerd

Klaar voor productie-deploy.
