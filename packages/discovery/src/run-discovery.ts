import { eq, sql } from "drizzle-orm";
import { businesses, type Db } from "@outreach/db";
import { enrichAndPersist } from "@outreach/enrichment";
import { Geocoder } from "@outreach/geocoding";
import { PlacesClient } from "@outreach/places";
import {
  runCompositeAudit,
  type CompositeAuditOptions,
} from "@outreach/website-quality";

export interface DiscoveryInput {
  niche: string;
  city: string;
  /** Optional radius in meters; when set the city is geocoded first. */
  radiusMeters?: number;
  /** 1-3 pages of 20 results. Default 1. */
  maxPages?: number;
  pageSize?: number;
  /**
   * Score the websites of newly-discovered businesses inline. Adds ~1
   * HTTP fetch per business (8s timeout, 5x parallel) but means the
   * dashboard shows quality immediately. Default: true.
   */
  scoreWebsites?: boolean;
  /**
   * Auto-enrich newly-discovered businesses by scraping their website
   * for emails. Default true. Disable when you only want to seed leads
   * without contact-info (rare). Failures per-business are swallowed —
   * the recurring `outreach-enrich` poll will retry them later.
   */
  enrichWebsites?: boolean;
  /**
   * Optional Hunter API key. When set, enrichment also queries Hunter
   * domain-search alongside the website scrape. Falls back to
   * scrape-only when omitted.
   */
  hunterApiKey?: string;
  /**
   * Aanvullende audit-keys. Als gezet, worden Tier 2 (PageSpeed
   * Insights) en/of Tier 3 (AI design-audit) ook tijdens discovery
   * uitgevoerd. Beide zijn optioneel — ontbrekende key = die tier
   * wordt overgeslagen.
   */
  auditOptions?: Pick<CompositeAuditOptions, "psiApiKey" | "anthropicApiKey" | "aiModel">;
}

export interface DiscoveryResult {
  query: string;
  found: number;
  upserted: number;
  geocoded: { lat: number; lng: number; radius: number } | null;
  scored: number;
  /** Number of newly-discovered businesses for which enrichment ran. */
  enriched: number;
  /** Total contact rows (emails) inserted by inline enrichment. */
  enrichedContacts: number;
}

/**
 * Google API keys for discovery work. Pass distinct keys when you want
 * separate IAM/quota policies per API; pass the same key (or omit
 * geocoding) when one key works for both. The Geocoder falls back to
 * the Places key when geocoding-specific is omitted, so existing
 * single-key setups keep working unchanged.
 */
export interface GoogleKeys {
  placesApiKey: string;
  /** Optional. Falls back to `placesApiKey` when omitted. */
  geocodingApiKey?: string;
}

/**
 * Pure discovery work: hits Google Places (optionally with a geocoded
 * locationBias), upserts the results into `businesses`, and scores the
 * websites of any new ones via WebsiteScorer.
 */
export async function runDiscovery(
  db: Db,
  keys: GoogleKeys | string,
  input: DiscoveryInput,
): Promise<DiscoveryResult> {
  // Backwards-compat: callers can still pass a bare string, treated as
  // the Places key (also used for geocoding).
  const placesApiKey = typeof keys === "string" ? keys : keys.placesApiKey;
  const geocodingApiKey =
    typeof keys === "string"
      ? keys
      : (keys.geocodingApiKey ?? keys.placesApiKey);
  if (!placesApiKey) throw new Error("GOOGLE_PLACES_API_KEY is required");

  const places = new PlacesClient({ apiKey: placesApiKey });

  let locationBias:
    | { center: { latitude: number; longitude: number }; radiusMeters: number }
    | undefined;
  let geocoded: DiscoveryResult["geocoded"] = null;

  if (input.radiusMeters) {
    const geocoder = new Geocoder({ apiKey: geocodingApiKey });
    const loc = await geocoder.geocode(input.city);
    if (loc) {
      locationBias = {
        center: { latitude: loc.latitude, longitude: loc.longitude },
        radiusMeters: Math.min(50_000, input.radiusMeters),
      };
      geocoded = {
        lat: loc.latitude,
        lng: loc.longitude,
        radius: locationBias.radiusMeters,
      };
    }
    // Fallback when ZERO_RESULTS: continue with text-only search.
  }

  const query = `${input.niche} in ${input.city}`;
  const results = await places.searchBusinessesAllPages({
    query,
    pageSize: input.pageSize ?? 20,
    maxPages: Math.min(3, Math.max(1, input.maxPages ?? 1)),
    ...(locationBias ? { locationBias } : {}),
  });

  if (results.length === 0) {
    return {
      query,
      found: 0,
      upserted: 0,
      geocoded,
      scored: 0,
      enriched: 0,
      enrichedContacts: 0,
    };
  }

  const rows = results.map((r) => ({
    placeId: r.placeId,
    name: r.displayName,
    category: r.primaryTypeDisplay ?? r.primaryType ?? input.niche,
    city: r.city,
    country: r.country,
    phone: r.phone,
    websiteUrl: r.websiteUrl,
    websiteQuality: r.websiteUrl ? null : "none",
    googleRating: r.rating !== null ? r.rating.toFixed(2) : null,
    reviewsCount: r.userRatingCount,
    rawPlacesData: r.raw,
  }));

  // Upsert. We do NOT clobber an existing website_quality on conflict
  // — re-discover should refresh contact info but keep the score we
  // already paid for. New rows get null (or "none" for missing site).
  const inserted = await db
    .insert(businesses)
    .values(rows)
    .onConflictDoUpdate({
      target: businesses.placeId,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        city: sql`excluded.city`,
        country: sql`excluded.country`,
        phone: sql`excluded.phone`,
        websiteUrl: sql`excluded.website_url`,
        websiteQuality: sql`COALESCE(${businesses.websiteQuality}, excluded.website_quality)`,
        googleRating: sql`excluded.google_rating`,
        reviewsCount: sql`excluded.reviews_count`,
        rawPlacesData: sql`excluded.raw_places_data`,
      },
    })
    .returning({
      id: businesses.id,
      name: businesses.name,
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
      enrichmentAttemptedAt: businesses.enrichmentAttemptedAt,
    });

  const shouldScore = input.scoreWebsites !== false;
  const toScore = shouldScore
    ? inserted.filter(
        (b) =>
          !!b.websiteUrl &&
          (b.websiteQuality === null || b.websiteQuality === "none"),
      )
    : [];

  let scored = 0;
  if (toScore.length > 0) {
    scored = await scoreInBatches(db, toScore, 5, input.auditOptions ?? {});
  }

  // Auto-enrichment: scrape the website of any new lead that we haven't
  // tried yet. Already-enriched rows (re-discovered placeId) are
  // skipped — the recurring `outreach-enrich` poll handles refreshes.
  let enriched = 0;
  let enrichedContacts = 0;
  const shouldEnrich = input.enrichWebsites !== false;
  const toEnrich = shouldEnrich
    ? inserted.filter(
        (b) => !!b.websiteUrl && b.enrichmentAttemptedAt === null,
      )
    : [];
  if (toEnrich.length > 0) {
    try {
      const persisted = await enrichAndPersist(
        db,
        toEnrich.map((b) => ({
          id: b.id,
          name: b.name,
          websiteUrl: b.websiteUrl,
        })),
        {
          concurrency: 5,
          ...(input.hunterApiKey ? { hunterApiKey: input.hunterApiKey } : {}),
        },
      );
      enriched = persisted.length;
      enrichedContacts = persisted.reduce((sum, p) => sum + p.inserted, 0);
    } catch {
      // Discovery must not fail when enrichment hits an unexpected
      // error — the recurring poll will retry these rows later.
    }
  }

  return {
    query,
    found: results.length,
    upserted: inserted.length,
    geocoded,
    scored,
    enriched,
    enrichedContacts,
  };
}

/**
 * Audit `concurrency` sites in parallel via runCompositeAudit (Tier 1
 * altijd, Tier 2/3 als hun keys gezet zijn). Schrijft direct naar
 * businesses.audit_detail + .website_quality + .audited_at. Failures
 * worden geslikt zodat één trage PSI-call niet de hele discovery
 * blokkeert — die rows blijven null en zijn op te halen met
 * `pnpm score-websites --rescore`.
 */
async function scoreInBatches(
  db: Db,
  rows: { id: string; websiteUrl: string | null }[],
  concurrency: number,
  auditOptions: NonNullable<DiscoveryInput["auditOptions"]>,
): Promise<number> {
  let cursor = 0;
  let scored = 0;
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= rows.length) return;
      const row = rows[i];
      if (!row || !row.websiteUrl) continue;
      try {
        const result = await runCompositeAudit(row.websiteUrl, auditOptions);
        await db
          .update(businesses)
          .set({
            websiteQuality: result.bucket,
            auditDetail: result as unknown as Record<string, unknown>,
            auditedAt: new Date(),
          })
          .where(eq(businesses.id, row.id));
        scored += 1;
      } catch {
        // swallow — recoverable via CLI rescore.
      }
    }
  });
  await Promise.all(workers);
  return scored;
}
