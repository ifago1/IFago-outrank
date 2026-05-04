#!/usr/bin/env tsx
/**
 * CLI: pnpm seed-campaign --name="Kappers NL Q2" [--niche=kapper] [--activate]
 *
 * Creates a campaign + the default 3-step sequence (sectie 10 of the plan).
 * Idempotent on `name`.
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import {
  campaigns,
  closeDb,
  getDb,
  sequenceSteps,
} from "@outreach/db";
import { DEFAULT_SEQUENCE } from "@outreach/templates";

interface CliOptions {
  name: string;
  niche: string | undefined;
  activate: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      niche: { type: "string" },
      activate: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help || !values.name) {
    console.log(`
Usage: pnpm seed-campaign --name="<name>" [--niche=<niche>] [--activate]

Creates a campaign with the default 3-step outreach sequence. Re-running with
the same --name does nothing (idempotent).

Options:
  --name      Campaign name (required, unique)
  --niche     Niche tag, e.g. "kapper"
  --activate  Set status to "active" instead of "draft"
  -h, --help  Show this help

Required env: DATABASE_URL.
`);
    process.exit(values.help ? 0 : 1);
  }
  return {
    name: values.name,
    niche: values.niche,
    activate: values.activate ?? false,
  };
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const existing = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.name, opts.name))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Campaign "${opts.name}" already exists (id=${existing[0]!.id}).`);
    return;
  }

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: opts.name,
      ...(opts.niche ? { niche: opts.niche } : {}),
      status: opts.activate ? "active" : "draft",
    })
    .returning();

  if (!campaign) throw new Error("Insert returned no row");

  await db.insert(sequenceSteps).values(
    DEFAULT_SEQUENCE.map((step) => ({
      campaignId: campaign.id,
      stepOrder: step.stepOrder,
      delayDays: step.delayDays,
      subjectTemplate: step.subjectTemplate,
      bodyTemplate: step.bodyTemplate,
    })),
  );

  console.log(
    `Created campaign "${opts.name}" (id=${campaign.id}, status=${campaign.status}) with ${DEFAULT_SEQUENCE.length} steps.`,
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
