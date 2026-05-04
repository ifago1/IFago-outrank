import { sql } from "drizzle-orm";
import { businesses, type Db } from "@outreach/db";
import { Geocoder } from "@outreach/geocoding";
import { PlacesClient } from "@outreach/places";

export interface DiscoveryInput {
  niche: string;
  city: string;
  /** Optional radius in meters; when set the city is geocoded first. */
  radiusMeters?: number;
  /** 1-3 pages of 20 results. Default 1. */
  maxPages?: number;
  pageSize?: number;
}

export interface DiscoveryResult {
  query: string;
  found: number;
  upserted: number;
  geocoded: { lat: number; lng: number; radius: number } | null;
}

/**
 * Pure discovery work: hits Google Places (optionally with a geocoded
 * locationBias) and upserts the results into `businesses`. Used by both
 * the CLI script and the dashboard server action so behavior stays
 * identical.
 */
export async function runDiscovery(
  db: Db,
  googleApiKey: string,
  input: DiscoveryInput,
): Promise<DiscoveryResult> {
  if (!googleApiKey) throw new Error("GOOGLE_PLACES_API_KEY is required");

  const places = new PlacesClient({ apiKey: googleApiKey });

  let locationBias:
    | { center: { latitude: number; longitude: number }; radiusMeters: number }
    | undefined;
  let geocoded: DiscoveryResult["geocoded"] = null;

  if (input.radiusMeters) {
    const geocoder = new Geocoder({ apiKey: googleApiKey });
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
    return { query, found: 0, upserted: 0, geocoded };
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
        websiteQuality: sql`excluded.website_quality`,
        googleRating: sql`excluded.google_rating`,
        reviewsCount: sql`excluded.reviews_count`,
        rawPlacesData: sql`excluded.raw_places_data`,
      },
    })
    .returning({ id: businesses.id });

  return {
    query,
    found: results.length,
    upserted: inserted.length,
    geocoded,
  };
}
