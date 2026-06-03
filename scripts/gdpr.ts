#!/usr/bin/env tsx
/**
 * CLI: pnpm gdpr --email=<email> [--export | --purge --confirm] [--out=path.json]
 *
 * GDPR-compliance helper:
 *   --export : dump every record we hold for this email as JSON (right
 *              of access, GDPR Art. 15). Default action when only --email
 *              is provided.
 *   --purge  : delete the contact + cascading campaign_leads + emails_sent
 *              and add the email to `unsubscribes` (right to erasure,
 *              GDPR Art. 17). Requires --confirm to be passed too —
 *              guards against accidental deletion.
 *
 * Required env: DATABASE_URL.
 */
import { parseArgs } from "node:util";
import { promises as fs } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  closeDb,
  contacts,
  emailsSent,
  getDb,
  unsubscribes,
} from "@outreach/db";
import { loadConfigOrExit } from "@outreach/config";

interface CliOptions {
  email: string;
  mode: "summary" | "export" | "purge";
  outPath: string | undefined;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      export: { type: "boolean", default: false },
      purge: { type: "boolean", default: false },
      confirm: { type: "boolean", default: false },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help || !values.email) {
    console.log(`
Usage:
  pnpm gdpr --email=<email>                    # show what we have (summary only)
  pnpm gdpr --email=<email> --export           # dump JSON to stdout
  pnpm gdpr --email=<email> --export --out=x.json
  pnpm gdpr --email=<email> --purge --confirm  # delete + add to unsubscribes

GDPR Article 15 (right of access) -> --export
GDPR Article 17 (right to erasure) -> --purge --confirm

Required env: DATABASE_URL.
`);
    process.exit(values.help ? 0 : 1);
  }

  if (values.purge && !values.confirm) {
    console.error(
      "--purge is destructive; pass --confirm to actually delete the data.",
    );
    process.exit(1);
  }

  const mode: CliOptions["mode"] = values.purge
    ? "purge"
    : values.export
      ? "export"
      : "summary";
  return {
    email: values.email.trim().toLowerCase(),
    mode,
    outPath: values.out,
  };
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  loadConfigOrExit("seed-campaign"); // any DB-only profile validates DATABASE_URL
  const db = getDb();

  // 1. Load every contact with this email (an email can exist at multiple
  //    businesses; GDPR scope is the natural-person email, not the business).
  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, opts.email));

  if (contactRows.length === 0) {
    console.log(`No contacts found for ${opts.email}.`);
    // Still return whether they're already unsubscribed — useful for audits.
    const u = await db
      .select()
      .from(unsubscribes)
      .where(eq(unsubscribes.email, opts.email));
    if (u[0]) {
      console.log(
        `(already on the unsubscribes list, reason="${u[0].reason ?? "?"}", since ${u[0].unsubscribedAt})`,
      );
    }
    return;
  }

  const contactIds = contactRows.map((c) => c.id);
  const businessIds = [...new Set(contactRows.map((c) => c.businessId))];

  const leadRows = contactIds.length
    ? await db
        .select()
        .from(campaignLeads)
        .where(inArray(campaignLeads.contactId, contactIds))
    : [];

  const leadIds = leadRows.map((l) => l.id);
  const sendRows = leadIds.length
    ? await db
        .select()
        .from(emailsSent)
        .where(inArray(emailsSent.campaignLeadId, leadIds))
    : [];

  const businessRows = businessIds.length
    ? await db
        .select()
        .from(businesses)
        .where(inArray(businesses.id, businessIds))
    : [];

  const unsubRows = await db
    .select()
    .from(unsubscribes)
    .where(eq(unsubscribes.email, opts.email));

  const dump = {
    email: opts.email,
    contacts: contactRows,
    campaign_leads: leadRows,
    emails_sent: sendRows,
    businesses: businessRows,
    unsubscribes: unsubRows,
    summary: {
      contacts: contactRows.length,
      campaign_leads: leadRows.length,
      emails_sent: sendRows.length,
      businesses_referenced: businessRows.length,
      already_unsubscribed: unsubRows.length > 0,
    },
  };

  if (opts.mode === "summary") {
    console.log(`Found data for ${opts.email}:`);
    for (const [k, v] of Object.entries(dump.summary)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log(
      "\nUse --export to dump full records, --purge --confirm to delete.",
    );
    return;
  }

  if (opts.mode === "export") {
    const json = JSON.stringify(dump, null, 2);
    if (opts.outPath) {
      await fs.writeFile(opts.outPath, json, "utf8");
      console.log(`Wrote ${opts.outPath} (${dump.summary.emails_sent} sends).`);
    } else {
      console.log(json);
    }
    return;
  }

  // mode === "purge"
  await db.transaction(async (tx) => {
    // FK chain is contacts → campaign_leads → emails_sent with ON DELETE
    // CASCADE, so deleting contacts removes everything. We do it explicitly
    // anyway (cheap, makes the audit trail clearer in the logs).
    if (leadIds.length) {
      await tx
        .delete(emailsSent)
        .where(inArray(emailsSent.campaignLeadId, leadIds));
      await tx
        .delete(campaignLeads)
        .where(inArray(campaignLeads.id, leadIds));
    }
    await tx.delete(contacts).where(eq(contacts.email, opts.email));

    // Mark as unsubscribed forever so any rediscover/enrich never re-mails.
    await tx
      .insert(unsubscribes)
      .values({ email: opts.email, reason: "gdpr_request" })
      .onConflictDoUpdate({
        target: unsubscribes.email,
        set: { reason: sql`'gdpr_request'`, unsubscribedAt: sql`now()` },
      });
  });

  console.log(`Purged ${opts.email}:`);
  console.log(`  contacts: ${contactRows.length}`);
  console.log(`  campaign_leads: ${leadRows.length}`);
  console.log(`  emails_sent: ${sendRows.length}`);
  console.log(`  added to unsubscribes (reason=gdpr_request)`);
  console.log(
    `\nNote: businesses table is untouched — it's not personal data, just public Google Places info.`,
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
