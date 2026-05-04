#!/usr/bin/env tsx
/**
 * CLI: pnpm score-websites [--limit=20] [--rescore] [--ai] [--business-id=<uuid>] [--dry-run]
 *
 * Walks businesses with a website but no quality score yet, runs the
 * composite audit (Tier 1 HTML + Tier 2 PSI als PSI_API_KEY gezet is +
 * optioneel Tier 3 AI met --ai), en schrijft het volledige resultaat
 * weg in businesses.audit_detail + .website_quality + .audited_at.
 *
 * Use --rescore to re-evaluate sites that already have a score.
 * Use --ai to also include the (paid) Anthropic design audit.
 */
import { parseArgs } from "node:util";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { businesses, closeDb, getDb, getSetting } from "@outreach/db";
import { runCompositeAudit } from "@outreach/website-quality";

interface CliOptions {
  limit: number;
  rescore: boolean;
  useAi: boolean;
  businessId: string | undefined;
  dryRun: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "20" },
      rescore: { type: "boolean", default: false },
      ai: { type: "boolean", default: false },
      "business-id": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm score-websites [--limit=20] [--rescore] [--ai] [--business-id=<uuid>] [--dry-run]

Audits each lead's website met de composite-audit pipeline:
  Tier 1: HTML-heuristieken (gratis)
  Tier 2: Google PageSpeed Insights (gratis, als PSI_API_KEY gezet)
  Tier 3: Claude HTML design-audit (~$0.005/site, alleen met --ai)

Schrijft het resultaat in businesses.audit_detail + .website_quality.

Options:
  --limit         Max businesses to process this run (default: 20)
  --rescore       Re-audit sites die al een score hebben
  --ai            Voeg Tier 3 (Claude) toe aan elke audit (kost geld!)
  --business-id   Audit alleen deze business
  --dry-run       Print resultaten, schrijf niets naar de DB
  -h, --help      Show this help

Env: DATABASE_URL (required). PSI_API_KEY of ANTHROPIC_API_KEY worden
opgehaald uit settings of .env. Ontbrekende keys = die tier wordt
overgeslagen.
`);
    process.exit(0);
  }
  return {
    limit: Number(values.limit),
    rescore: values.rescore ?? false,
    useAi: values.ai ?? false,
    businessId: values["business-id"],
    dryRun: values["dry-run"] ?? false,
  };
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const psiApiKey =
    (await getSetting(db, "PSI_API_KEY")) ?? process.env["PSI_API_KEY"];
  const anthropicApiKey = opts.useAi
    ? ((await getSetting(db, "ANTHROPIC_API_KEY")) ??
      process.env["ANTHROPIC_API_KEY"])
    : undefined;
  const aiModel =
    (await getSetting(db, "AI_MODEL")) ??
    process.env["AI_MODEL"] ??
    "claude-haiku-4-5";

  if (opts.useAi && !anthropicApiKey) {
    console.error(
      "--ai meegegeven maar ANTHROPIC_API_KEY ontbreekt. Vul in via Settings of .env.",
    );
    process.exit(1);
  }

  const baseConditions = [isNotNull(businesses.websiteUrl)];
  if (!opts.rescore) {
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

  console.log(
    `Auditing ${rows.length} website(s)  [Tier 1${psiApiKey ? " + 2" : ""}${anthropicApiKey ? " + 3" : ""}]`,
  );
  if (!psiApiKey) {
    console.log("  (Tier 2 PSI overgeslagen — geen PSI_API_KEY gezet)");
  }

  const counts = { good: 0, decent: 0, outdated: 0, unreachable: 0 };

  for (const b of rows) {
    if (!b.websiteUrl) {
      console.log(`- ${b.name}: no website, skipping`);
      continue;
    }

    const result = await runCompositeAudit(b.websiteUrl, {
      ...(psiApiKey ? { psiApiKey } : {}),
      ...(anthropicApiKey ? { anthropicApiKey, aiModel } : {}),
      businessName: b.name,
    });

    if (!result.reachable) counts.unreachable += 1;
    else if (result.bucket === "good") counts.good += 1;
    else if (result.bucket === "decent") counts.decent += 1;
    else counts.outdated += 1;

    const psiLine = result.psi?.ok
      ? `psi=${result.psi.performanceMobile}`
      : result.psi?.error
        ? "psi=err"
        : "";
    const aiLine = result.ai?.ok
      ? `ai=${result.ai.score}/10`
      : result.ai?.error
        ? "ai=err"
        : "";
    const summary = [
      `html=${result.htmlScore}`,
      psiLine,
      aiLine,
    ]
      .filter(Boolean)
      .join("  ");

    console.log(`${badgeFor(result.bucket)} ${b.name}  ${summary}`);

    if (opts.dryRun) continue;

    await db
      .update(businesses)
      .set({
        websiteQuality: result.bucket,
        auditDetail: result as unknown as Record<string, unknown>,
        auditedAt: new Date(),
      })
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
