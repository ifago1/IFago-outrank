import { eq, sql } from "drizzle-orm";
import { businesses, type Db } from "@outreach/db";
import { Geocoder } from "@outreach/geocoding";
import { PlacesClient } from "@outreach/places";
import { WebsiteScorer } from "@outreach/website-quality";

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
}

export interface DiscoveryResult {
  query: string;
  found: number;
  upserted: number;
  geocoded: { lat: number; lng: number; radius: number } | null;
  scored: number;
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
    return { query, found: 0, upserted: 0, geocoded, scored: 0 };
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
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
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
    const scorer = new WebsiteScorer();
    scored = await scoreInBatches(db, scorer, toScore, 5);
  }

  return {
    query,
    found: results.length,
    upserted: inserted.length,
    geocoded,
    scored,
  };
}

/**
 * Score `concurrency` sites in parallel, write each result as it
 * finishes. Failures are logged + the row keeps its current quality so
 * a follow-up `pnpm score-websites --rescore` can retry.
 */
async function scoreInBatches(
  db: Db,
  scorer: WebsiteScorer,
  rows: { id: string; websiteUrl: string | null }[],
  concurrency: number,
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
        const result = await scorer.audit(row.websiteUrl);
        await db
          .update(businesses)
          .set({ websiteQuality: result.bucket })
          .where(eq(businesses.id, row.id));
        scored += 1;
      } catch {
        // swallow — the row stays unscored, recoverable via CLI rescore.
      }
    }
  });
  await Promise.all(workers);
  return scored;
}
