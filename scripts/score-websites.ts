#!/usr/bin/env tsx
/**
 * CLI: pnpm score-websites [--limit=20] [--rescore] [--business-id=<uuid>] [--dry-run]
 *
 * Walks businesses with a website but no quality score yet, audits each one
 * with the WebsiteScorer heuristics, and updates `businesses.website_quality`.
 *
 * Use --rescore to re-evaluate sites that already have a score.
 */
import { parseArgs } from "node:util";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { businesses, closeDb, getDb } from "@outreach/db";
import { WebsiteScorer } from "@outreach/website-quality";

interface CliOptions {
  limit: number;
  rescore: boolean;
  businessId: string | undefined;
  dryRun: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "20" },
      rescore: { type: "boolean", default: false },
      "business-id": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm score-websites [--limit=20] [--rescore] [--business-id=<uuid>] [--dry-run]

Audits the homepages of businesses that have a website and writes a
quality bucket (good | decent | outdated) to businesses.website_quality.

Options:
  --limit         Max businesses to process this run (default: 20)
  --rescore       Re-audit sites that already have a quality bucket
  --business-id   Audit only this single business
  --dry-run       Print results, do not write to the database
  -h, --help      Show this help

Required env: DATABASE_URL.
`);
    process.exit(0);
  }
  return {
    limit: Number(values.limit),
    rescore: values.rescore ?? false,
    businessId: values["business-id"],
    dryRun: values["dry-run"] ?? false,
  };
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();
  const scorer = new WebsiteScorer();

  const baseConditions = [isNotNull(businesses.websiteUrl)];
  if (!opts.rescore) {
    // unscored = null OR previously marked 'none' (placeholder from discover)
    baseConditions.push(
      or(
        isNull(businesses.websiteQuality),
        eq(businesses.websiteQuality, "none"),
      )!,
    );
  }

  const rows = opts.businessId
    ? await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, opts.businessId))
        .limit(1)
    : await db
        .select()
        .from(businesses)
        .where(and(...baseConditions))
        .limit(opts.limit);

  console.log(`Scoring ${rows.length} website(s)...`);

  let counts = { good: 0, decent: 0, outdated: 0, unreachable: 0 };

  for (const b of rows) {
    if (!b.websiteUrl) {
      console.log(`- ${b.name}: no website, skipping`);
      continue;
    }

    const result = await scorer.audit(b.websiteUrl);
    if (!result.reachable) counts.unreachable += 1;
    else if (result.bucket === "good") counts.good += 1;
    else if (result.bucket === "decent") counts.decent += 1;
    else counts.outdated += 1;

    const signalSummary =
      result.signals.length === 0
        ? "no issues"
        : result.signals.map((s) => s.key).join(", ");

    console.log(
      `${badgeFor(result.bucket)} ${b.name}  score=${result.score}  ${signalSummary}`,
    );

    if (opts.dryRun) continue;

    await db
      .update(businesses)
      .set({ websiteQuality: result.bucket })
      .where(eq(businesses.id, b.id));
  }

  console.log(
    `Done — good=${counts.good} decent=${counts.decent} outdated=${counts.outdated} unreachable=${counts.unreachable}`,
  );
}

function badgeFor(bucket: string): string {
  if (bucket === "good") return "[GOOD]    ";
  if (bucket === "decent") return "[DECENT]  ";
  return "[OUTDATED]";
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
