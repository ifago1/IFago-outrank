#!/usr/bin/env tsx
/**
 * CLI: pnpm auto-assign [--limit=500] [--dry-run]
 *
 * Scant alle non-DNC contacts die nog niet in een campagne zitten en
 * wijst ze toe aan de eerste auto-assign-campagne die ze matcht
 * (op niche / locatie / website-kwaliteit). Idempotent.
 *
 * Default ook aangeroepen vanuit de tick-worker zodra
 * RUN_AUTO_ASSIGN_PER_TICK=true is gezet — gebruik deze CLI vooral
 * voor handmatige one-off runs of na een grote enrichment-batch.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@outreach/db";
import { runAutoAssign } from "@outreach/sequencer";
import { loadConfigOrExit } from "@outreach/config";

interface CliOptions {
  limit: number;
  dryRun: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "500" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm auto-assign [--limit=500] [--dry-run]

Scant non-DNC contacts zonder campagne en wijst ze toe aan de eerste
matchende auto-assign-campagne op basis van niche, locatie en
website-kwaliteit-filters die per campagne gezet zijn in de UI.

Opties:
  --limit       Max kandidaten per call (default 500)
  --dry-run     Tel matches, schrijf niets weg
  -h, --help    Help

Vereiste env: DATABASE_URL.
`);
    process.exit(0);
  }
  return {
    limit: Number(values.limit),
    dryRun: values["dry-run"] ?? false,
  };
}

async function main(): Promise<void> {
  loadConfigOrExit("auto-assign");
  const opts = parseCliArgs();
  const db = getDb();

  const result = await runAutoAssign(db, {
    limit: opts.limit,
    dryRun: opts.dryRun,
  });

  if (opts.dryRun) {
    console.log(
      `[dry-run] Zou toewijzen: ${result.perCampaign.reduce((a, b) => a + b.count, 0)} contacts, unmatched=${result.unmatched}`,
    );
  } else {
    console.log(
      `Auto-assign klaar: assigned=${result.assigned}, unmatched=${result.unmatched}, skipped=${result.skippedAlreadyInCampaign}`,
    );
  }
  for (const pc of result.perCampaign) {
    console.log(`  + ${pc.count} in campaign ${pc.campaignId}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
