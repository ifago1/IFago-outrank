#!/usr/bin/env tsx
/**
 * CLI: pnpm discover --niche="kapper" --city="Utrecht" [--radius=5000] [--max-pages=3]
 *
 * Calls Google Places API (New) and upserts results into `businesses`,
 * keyed on Google's stable place_id. With --radius set we first geocode
 * the city to lat/lng and then bias the search to that circle.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { businesses, getDb, closeDb } from "@outreach/db";
import { PlacesClient } from "@outreach/places";
import { Geocoder } from "@outreach/geocoding";
import { loadConfigOrExit } from "@outreach/config";

interface CliOptions {
  niche: string;
  city: string;
  pageSize: number;
  radiusMeters: number | undefined;
  maxPages: number;
  dryRun: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      niche: { type: "string" },
      city: { type: "string" },
      "page-size": { type: "string", default: "20" },
      radius: { type: "string" },
      "max-pages": { type: "string", default: "1" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help || !values.niche || !values.city) {
    printUsage();
    process.exit(values.help ? 0 : 1);
  }

  const radius = values.radius ? Number(values.radius) : undefined;
  return {
    niche: values.niche,
    city: values.city,
    pageSize: Number(values["page-size"]),
    radiusMeters: radius,
    maxPages: Math.min(3, Math.max(1, Number(values["max-pages"]))),
    dryRun: values["dry-run"] ?? false,
  };
}

function printUsage(): void {
  console.log(`
Usage: pnpm discover --niche="<niche>" --city="<city>" [--radius=5000] [--max-pages=3] [--dry-run]

Options:
  --niche       Branch / category to search for (required), e.g. "kapper"
  --city        City name to bias results to (required), e.g. "Utrecht"
  --radius      Geographic radius in meters around the city center.
                When set, the city is geocoded and Places filters by that
                circle. Without --radius the search is text-only.
  --page-size   Results per request (1-20, default: 20)
  --max-pages   Walk Places' nextPageToken pagination (max 3 = 60 results,
                default: 1). Each page is a separate billable call.
  --dry-run     Print results, do not write to the database
  -h, --help    Show this help

Required env: GOOGLE_PLACES_API_KEY, DATABASE_URL (unless --dry-run).
`);
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const cfg = opts.dryRun
    ? { GOOGLE_PLACES_API_KEY: requiredEnv("GOOGLE_PLACES_API_KEY") }
    : loadConfigOrExit("discover");

  const client = new PlacesClient({ apiKey: cfg.GOOGLE_PLACES_API_KEY });

  // Geocode the city if a radius was requested — otherwise text-only bias.
  let locationBias:
    | { center: { latitude: number; longitude: number }; radiusMeters: number }
    | undefined;
  if (opts.radiusMeters) {
    const geocoder = new Geocoder({ apiKey: cfg.GOOGLE_PLACES_API_KEY });
    const loc = await geocoder.geocode(opts.city);
    if (!loc) {
      console.error(
        `Could not geocode "${opts.city}" — falling back to text-only search`,
      );
    } else {
      locationBias = {
        center: { latitude: loc.latitude, longitude: loc.longitude },
        radiusMeters: Math.min(50_000, opts.radiusMeters),
      };
      console.log(
        `Geocoded "${opts.city}" -> ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)} (radius=${locationBias.radiusMeters}m)`,
      );
    }
  }

  const query = `${opts.niche} in ${opts.city}`;
  console.log(
    `Searching: "${query}" (max-pages=${opts.maxPages}${locationBias ? ", radius-biased" : ""})`,
  );

  const results = await client.searchBusinessesAllPages({
    query,
    pageSize: opts.pageSize,
    maxPages: opts.maxPages,
    ...(locationBias ? { locationBias } : {}),
  });

  console.log(`Found ${results.length} place(s).`);

  if (opts.dryRun) {
    for (const r of results) {
      console.log(
        `- ${r.displayName} | ${r.city ?? "?"} | site=${r.websiteUrl ?? "—"} | rating=${r.rating ?? "?"}`,
      );
    }
    return;
  }

  if (results.length === 0) return;

  const db = getDb();
  const rows = results.map((r) => ({
    placeId: r.placeId,
    name: r.displayName,
    category: r.primaryTypeDisplay ?? r.primaryType ?? opts.niche,
    city: r.city,
    country: r.country,
    phone: r.phone,
    websiteUrl: r.websiteUrl,
    websiteQuality: r.websiteUrl ? null : "none",
    googleRating: r.rating !== null ? r.rating.toFixed(2) : null,
    reviewsCount: r.userRatingCount,
    rawPlacesData: r.raw,
  }));

  // Upsert on place_id so re-running the script is safe and cheap.
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
    .returning({ id: businesses.id, placeId: businesses.placeId });

  console.log(`Upserted ${inserted.length} business row(s).`);
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
