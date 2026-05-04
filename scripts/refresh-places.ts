#!/usr/bin/env tsx
/**
 * CLI: pnpm refresh-places [--limit=50] [--missing-only] [--dry-run]
 *
 * Loopt door bestaande businesses, haalt elke place opnieuw op via
 * Places API GetPlace en update raw_places_data + de paar afgeleide
 * velden (phone, websiteUrl, rating). Gebruikt om bestaande leads bij
 * te werken nadat we het Places field-mask hebben uitgebreid (bv.
 * googleMapsUri toegevoegd voor de research-panel link).
 *
 * Cost: ~$0.005 per business (Places API basic-data call). 60 leads ≈ $0.30.
 */
import { parseArgs } from "node:util";
import { eq, isNull, sql } from "drizzle-orm";
import { businesses, closeDb, getDb, getSetting } from "@outreach/db";
import { PlacesClient } from "@outreach/places";

interface CliOptions {
  limit: number;
  missingOnly: boolean;
  dryRun: boolean;
  businessId: string | undefined;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "50" },
      "missing-only": { type: "boolean", default: false },
      "business-id": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm refresh-places [--limit=50] [--missing-only] [--business-id=<uuid>] [--dry-run]

Refreshes existing businesses' raw_places_data via Places GetPlace.

Options:
  --limit          Max businesses per run (default: 50)
  --missing-only   Skip rows die al googleMapsUri hebben (incremental run)
  --business-id    Refresh alleen deze ene business
  --dry-run        Print plan, schrijf niets naar de DB
  -h, --help       Show this help

Vereist GOOGLE_PLACES_API_KEY in settings of .env.
`);
    process.exit(0);
  }
  return {
    limit: Number(values.limit),
    missingOnly: values["missing-only"] ?? false,
    businessId: values["business-id"],
    dryRun: values["dry-run"] ?? false,
  };
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const placesApiKey =
    (await getSetting(db, "GOOGLE_PLACES_API_KEY")) ??
    process.env["GOOGLE_PLACES_API_KEY"];
  if (!placesApiKey) {
    console.error(
      "GOOGLE_PLACES_API_KEY ontbreekt — vul in via Settings of .env.",
    );
    process.exit(1);
  }

  const places = new PlacesClient({ apiKey: placesApiKey });

  // Selectie: alle of alleen incomplete rows.
  const rows = opts.businessId
    ? await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, opts.businessId))
        .limit(1)
    : opts.missingOnly
      ? await db
          .select()
          .from(businesses)
          .where(
            sql`${businesses.rawPlacesData} IS NULL OR ${businesses.rawPlacesData} ->> 'googleMapsUri' IS NULL`,
          )
          .limit(opts.limit)
      : await db.select().from(businesses).limit(opts.limit);

  console.log(`Refreshing ${rows.length} business(es)...`);

  let updated = 0;
  let notFound = 0;
  let failed = 0;

  for (const b of rows) {
    if (!b.placeId) {
      console.log(`- ${b.name}: geen place_id, overslaan`);
      continue;
    }
    try {
      const result = await places.getPlace(b.placeId);
      if (!result) {
        console.log(`! ${b.name}: niet gevonden bij Google (404)`);
        notFound += 1;
        continue;
      }

      const hasMaps = (result.raw as Record<string, unknown>)["googleMapsUri"];
      console.log(
        `+ ${b.name}: refreshed${hasMaps ? " (incl. googleMapsUri)" : ""}`,
      );

      if (opts.dryRun) continue;

      await db
        .update(businesses)
        .set({
          // Refresh alleen de velden die uit Places komen — niet
          // websiteQuality (heeft een eigen audit-pipeline) of
          // personalObservation (AI-gegenereerd).
          name: result.displayName,
          category:
            result.primaryTypeDisplay ?? result.primaryType ?? b.category,
          city: result.city ?? b.city,
          country: result.country ?? b.country,
          phone: result.phone ?? b.phone,
          websiteUrl: result.websiteUrl ?? b.websiteUrl,
          googleRating:
            result.rating !== null ? result.rating.toFixed(2) : b.googleRating,
          reviewsCount: result.userRatingCount ?? b.reviewsCount,
          rawPlacesData: result.raw,
        })
        .where(eq(businesses.id, b.id));
      updated += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${b.name}: ${msg.slice(0, 200)}`);
      failed += 1;
    }
  }

  console.log(
    `\nDone — updated=${updated} not-found=${notFound} failed=${failed}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
