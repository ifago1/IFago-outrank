#!/usr/bin/env tsx
/**
 * CLI: pnpm enrich [--limit=20] [--business-id=<uuid>] [--dry-run]
 *
 * Walks `businesses` rows that have no contacts yet (or have not been
 * enriched in 90 days), runs EnrichmentService (website scrape +
 * optional Hunter + MX-validation), and writes the discovered emails
 * to `contacts`. The same logic runs automatically:
 *   - directly after `runDiscovery` for newly-found leads
 *   - on a recurring BullMQ schedule for backfill of older leads
 * so this CLI is mainly for one-off / debugging runs.
 */
import { parseArgs } from "node:util";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { businesses, closeDb, getDb } from "@outreach/db";
import { enrichAndPersist } from "@outreach/enrichment";

interface CliOptions {
  limit: number;
  businessId: string | undefined;
  concurrency: number;
  dryRun: boolean;
  staleDays: number;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "20" },
      "business-id": { type: "string" },
      concurrency: { type: "string", default: "5" },
      "stale-days": { type: "string", default: "90" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }
  return {
    limit: Number(values.limit),
    businessId: values["business-id"],
    concurrency: Math.max(1, Math.min(20, Number(values.concurrency))),
    staleDays: Math.max(1, Number(values["stale-days"])),
    dryRun: values["dry-run"] ?? false,
  };
}

function printUsage(): void {
  console.log(`
Usage: pnpm enrich [--limit=20] [--business-id=<uuid>] [--concurrency=5] [--stale-days=90] [--dry-run]

Picks businesses with a website that have not been enriched yet (or not
in --stale-days) and tries to find an email via website scrape + Hunter
(if HUNTER_API_KEY is set). Validated addresses are written to the
\`contacts\` table; \`enrichment_attempted_at\` is stamped on every
processed business so the next backfill skips them.

Options:
  --limit         Max businesses to process this run (default: 20)
  --business-id   Process only this business (overrides --limit/--stale-days)
  --concurrency   How many businesses to enrich in parallel (1-20, default: 5)
  --stale-days    Re-enrich businesses last attempted longer ago than this (default: 90)
  --dry-run       Print results, do not write to the database
  -h, --help      Show this help

Required env: DATABASE_URL. Optional: HUNTER_API_KEY.
`);
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const rows = opts.businessId
    ? await db
        .select({
          id: businesses.id,
          name: businesses.name,
          websiteUrl: businesses.websiteUrl,
        })
        .from(businesses)
        .where(eq(businesses.id, opts.businessId))
        .limit(1)
    : await db
        .select({
          id: businesses.id,
          name: businesses.name,
          websiteUrl: businesses.websiteUrl,
        })
        .from(businesses)
        .where(
          and(
            isNotNull(businesses.websiteUrl),
            or(
              sql`${businesses.enrichmentAttemptedAt} IS NULL`,
              lt(
                businesses.enrichmentAttemptedAt,
                sql`NOW() - (${opts.staleDays} || ' days')::interval`,
              ),
            ),
          ),
        )
        .limit(opts.limit);

  const eligible = rows.filter((b) => b.websiteUrl != null);
  for (const b of rows) {
    if (!b.websiteUrl) console.log(`- ${b.name}: no website, skipping`);
  }

  console.log(
    `Enriching ${eligible.length} business(es) with concurrency=${opts.concurrency}...`,
  );

  const persisted = await enrichAndPersist(db, eligible, {
    concurrency: opts.concurrency,
    dryRun: opts.dryRun,
    ...(process.env["HUNTER_API_KEY"]
      ? { hunterApiKey: process.env["HUNTER_API_KEY"] }
      : {}),
  });

  let totalEmails = 0;
  for (const p of persisted) {
    if (p.error) {
      console.log(`! ${p.business.name}: enrichment failed — ${p.error}`);
      continue;
    }
    const result = p.result!;
    if (result.warnings.length > 0) {
      for (const w of result.warnings)
        console.log(`  ! ${p.business.name}: ${w}`);
    }
    if (result.emails.length === 0) {
      console.log(`- ${p.business.name}: no emails found`);
      continue;
    }
    console.log(
      `+ ${p.business.name}: ${result.emails.length} email(s) — ${result.emails
        .map((e) => e.email)
        .join(", ")}${opts.dryRun ? " [dry-run]" : ` (wrote ${p.inserted})`}`,
    );
    totalEmails += result.emails.length;
  }

  console.log(
    `Done — ${totalEmails} email(s) found across ${eligible.length} business(es).`,
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
