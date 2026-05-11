#!/usr/bin/env tsx
/**
 * CLI: pnpm assign-leads --campaign="<name>" [--niche=kapper] [--no-website] [--limit=50]
 *
 * Picks contacts matching the filters and adds them as queued leads to the
 * named campaign. Idempotent (unique on campaign_id + contact_id).
 */
import { parseArgs } from "node:util";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  closeDb,
  contacts,
  getDb,
} from "@outreach/db";

interface CliOptions {
  campaign: string;
  niche: string | undefined;
  noWebsite: boolean;
  limit: number;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      campaign: { type: "string" },
      niche: { type: "string" },
      "no-website": { type: "boolean", default: false },
      limit: { type: "string", default: "50" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help || !values.campaign) {
    console.log(`
Usage: pnpm assign-leads --campaign="<name>" [--niche=<niche>] [--no-website] [--limit=50]

Adds contacts (filtered by niche/website status) as queued leads to a campaign.

Options:
  --campaign     Target campaign name (required)
  --niche        Only assign businesses with this category
  --no-website   Only assign businesses without a website (highest-prio leads)
  --limit        Max contacts to assign in this run (default: 50)
  -h, --help     Show this help

Required env: DATABASE_URL.
`);
    process.exit(values.help ? 0 : 1);
  }
  return {
    campaign: values.campaign,
    niche: values.niche,
    noWebsite: values["no-website"] ?? false,
    limit: Number(values.limit),
  };
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const cRows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.name, opts.campaign))
    .limit(1);
  const campaign = cRows[0];
  if (!campaign) {
    console.error(`No campaign named "${opts.campaign}"`);
    process.exit(1);
  }

  const conditions = [
    eq(contacts.doNotContact, false),
    eq(contacts.isVerified, true),
  ];
  if (opts.niche) conditions.push(eq(businesses.category, opts.niche));
  if (opts.noWebsite) conditions.push(isNull(businesses.websiteUrl));

  const eligible = await db
    .select({
      contactId: contacts.id,
      email: contacts.email,
      businessName: businesses.name,
    })
    .from(contacts)
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .where(
      and(
        ...conditions,
        // Strict: een contact mag in maximaal één campagne zitten —
        // ongeacht status. Anders: handmatig uit oude campagne halen
        // vóór toevoegen aan een nieuwe.
        sql`NOT EXISTS (
          SELECT 1 FROM campaign_leads
          WHERE campaign_leads.contact_id = ${contacts.id}
        )`,
      ),
    )
    .limit(opts.limit);

  if (eligible.length === 0) {
    console.log("No new eligible contacts to assign.");
    return;
  }

  const now = new Date();
  await db
    .insert(campaignLeads)
    .values(
      eligible.map((c) => ({
        campaignId: campaign.id,
        contactId: c.contactId,
        status: "queued",
        currentStep: 0,
        nextSendAt: now,
        lastEventAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [campaignLeads.campaignId, campaignLeads.contactId],
    });

  console.log(
    `Assigned ${eligible.length} contact(s) to "${opts.campaign}":`,
  );
  for (const e of eligible) {
    console.log(`  - ${e.email} (${e.businessName})`);
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
