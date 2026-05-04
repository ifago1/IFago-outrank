#!/usr/bin/env tsx
/**
 * CLI: pnpm discover --niche="kapper" --city="Utrecht" [--radius=5000] [--max-pages=3]
 *
 * Thin wrapper over @outreach/discovery's runDiscovery() so the CLI and
 * the dashboard's "Run now" button use identical code paths. For
 * scheduled / saved searches, configure them in the dashboard's
 * /discover tab and the BullMQ scheduler runs them periodically.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb, getSetting } from "@outreach/db";
import { runDiscovery } from "@outreach/discovery";

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
  --niche       Branch / category to search for (required)
  --city        City name to bias results to (required)
  --radius      Geographic radius in meters; geocodes the city + filters
  --page-size   Results per request (1-20, default: 20)
  --max-pages   Walk pagination (max 3 = 60 results, default: 1)
  --dry-run     (currently does the same as a normal run since the lib
                 always upserts)
  -h, --help    Show this help

For scheduled searches: configure them in the dashboard /discover tab.

Required: GOOGLE_PLACES_API_KEY in env or in the Settings tab.
Required: DATABASE_URL in env.
`);
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const placesApiKey =
    (await getSetting(db, "GOOGLE_PLACES_API_KEY")) ??
    process.env["GOOGLE_PLACES_API_KEY"];
  if (!placesApiKey) {
    console.error(
      "GOOGLE_PLACES_API_KEY is required (set it in .env or in the dashboard Settings tab).",
    );
    process.exit(1);
  }
  const geocodingApiKey =
    (await getSetting(db, "GOOGLE_GEOCODING_API_KEY")) ??
    process.env["GOOGLE_GEOCODING_API_KEY"] ??
    placesApiKey;
  const psiApiKey =
    (await getSetting(db, "PSI_API_KEY")) ??
    process.env["PSI_API_KEY"] ??
    undefined;

  const result = await runDiscovery(db, { placesApiKey, geocodingApiKey }, {
    niche: opts.niche,
    city: opts.city,
    ...(opts.radiusMeters ? { radiusMeters: opts.radiusMeters } : {}),
    maxPages: opts.maxPages,
    pageSize: opts.pageSize,
    ...(psiApiKey ? { auditOptions: { psiApiKey } } : {}),
  });

  console.log(`Searched: "${result.query}"`);
  if (result.geocoded) {
    console.log(
      `  Geocoded -> ${result.geocoded.lat.toFixed(4)}, ${result.geocoded.lng.toFixed(4)} (radius=${result.geocoded.radius}m)`,
    );
  }
  console.log(`  Found ${result.found} place(s)`);
  console.log(`  Upserted ${result.upserted} business row(s)`);
  console.log(`  Scored ${result.scored} website(s)`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
