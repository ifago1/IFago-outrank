#!/usr/bin/env tsx
/**
 * CLI: pnpm discover --niche="kapper" --city="Utrecht" --radius=5000
 *
 * Calls Google Places API (New), upserts results into the `businesses` table
 * keyed on Google's stable place_id.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { businesses, getDb, closeDb } from "@outreach/db";
import { PlacesClient } from "@outreach/places";

interface CliOptions {
  niche: string;
  city: string;
  radiusMeters: number;
  pageSize: number;
  dryRun: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      niche: { type: "string" },
      city: { type: "string" },
      radius: { type: "string", default: "5000" },
      "page-size": { type: "string", default: "20" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help || !values.niche || !values.city) {
    printUsage();
    process.exit(values.help ? 0 : 1);
  }

  return {
    niche: values.niche,
    city: values.city,
    radiusMeters: Number(values.radius),
    pageSize: Number(values["page-size"]),
    dryRun: values["dry-run"] ?? false,
  };
}

function printUsage(): void {
  console.log(`
Usage: pnpm discover --niche="<niche>" --city="<city>" [--radius=5000] [--page-size=20] [--dry-run]

Options:
  --niche       Branch / category to search for (required), e.g. "kapper"
  --city        City name to bias results to (required), e.g. "Utrecht"
  --radius      Bias radius in meters (default: 5000, max: 50000)
  --page-size   Max results per call (1-20, default: 20)
  --dry-run     Print results, do not write to the database
  -h, --help    Show this help

Required env: GOOGLE_PLACES_API_KEY, DATABASE_URL (unless --dry-run).
`);
}

async function main(): Promise<void> {
  const opts = parseCliArgs();

  const apiKey = process.env["GOOGLE_PLACES_API_KEY"];
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY is required");
    process.exit(1);
  }

  const client = new PlacesClient({ apiKey });

  const query = `${opts.niche} in ${opts.city}`;
  console.log(`Searching: "${query}" (radius=${opts.radiusMeters}m)`);

  const results = await client.searchBusinesses({
    query,
    pageSize: opts.pageSize,
    // We don't geocode the city ourselves yet -- the textQuery already
    // includes "in <city>". Once we add a Geocoding step, we can supply a
    // proper locationBias circle. See README.
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

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
