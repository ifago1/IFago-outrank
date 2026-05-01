#!/usr/bin/env tsx
/**
 * CLI: pnpm enrich [--limit=20] [--business-id=<uuid>] [--dry-run]
 *
 * Walks `businesses` rows that have no contacts yet, runs
 * EnrichmentService (website scrape + optional Hunter + MX-validation),
 * and writes the discovered emails to `contacts`.
 */
import { parseArgs } from "node:util";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  businesses,
  closeDb,
  contacts,
  getDb,
} from "@outreach/db";
import {
  EnrichmentService,
  HunterClient,
  WebsiteScraper,
} from "@outreach/enrichment";

interface CliOptions {
  limit: number;
  businessId: string | undefined;
  dryRun: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "20" },
      "business-id": { type: "string" },
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
    dryRun: values["dry-run"] ?? false,
  };
}

function printUsage(): void {
  console.log(`
Usage: pnpm enrich [--limit=20] [--business-id=<uuid>] [--dry-run]

Looks up businesses without an associated contact and tries to find an email
address via website scrape + Hunter (if HUNTER_API_KEY is set). Validated
addresses are written to the \`contacts\` table.

Options:
  --limit         Max businesses to process this run (default: 20)
  --business-id   Process only this business (overrides --limit)
  --dry-run       Print results, do not write to the database
  -h, --help      Show this help

Required env: DATABASE_URL. Optional: HUNTER_API_KEY.
`);
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const hunterKey = process.env["HUNTER_API_KEY"];
  const service = new EnrichmentService({
    scraper: new WebsiteScraper(),
    hunter: hunterKey ? new HunterClient({ apiKey: hunterKey }) : undefined,
  });

  // Fetch businesses with a website but no contact yet (or a specific id).
  const rows = opts.businessId
    ? await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, opts.businessId))
        .limit(1)
    : await db
        .select()
        .from(businesses)
        .where(
          and(
            isNotNull(businesses.websiteUrl),
            sql`NOT EXISTS (SELECT 1 FROM contacts WHERE contacts.business_id = ${businesses.id})`,
          ),
        )
        .limit(opts.limit);

  console.log(`Enriching ${rows.length} business(es)...`);

  let totalEmails = 0;
  for (const b of rows) {
    if (!b.websiteUrl) {
      console.log(`- ${b.name}: no website, skipping`);
      continue;
    }

    const result = await service.enrich({
      businessName: b.name,
      websiteUrl: b.websiteUrl,
    });

    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.log(`  ! ${b.name}: ${w}`);
    }

    if (result.emails.length === 0) {
      console.log(`- ${b.name}: no emails found`);
      continue;
    }

    console.log(
      `+ ${b.name}: ${result.emails.length} email(s) — ${result.emails
        .map((e) => e.email)
        .join(", ")}`,
    );
    totalEmails += result.emails.length;

    if (opts.dryRun) continue;

    const rowsToInsert = result.emails.map((e) => ({
      businessId: b.id,
      email: e.email,
      ...(e.firstName ? { firstName: e.firstName } : {}),
      ...(e.lastName ? { lastName: e.lastName } : {}),
      source: e.source,
      isVerified: true, // we MX-validated
    }));

    await db
      .insert(contacts)
      .values(rowsToInsert)
      .onConflictDoNothing({
        target: [contacts.businessId, contacts.email],
      });
  }

  console.log(`Done — ${totalEmails} email(s) found across ${rows.length} business(es).`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
