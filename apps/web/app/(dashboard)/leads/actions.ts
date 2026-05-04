"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import {
  campaignLeads,
  campaigns,
  contacts,
  getDb,
} from "@outreach/db";
import type { AssignLeadsResult } from "./types";

/**
 * Assign one or more businesses to a campaign. Resolves businesses →
 * verified, non-DNC contacts and bulk-inserts campaign_leads rows.
 * Idempotent: unique index on (campaign_id, contact_id) means duplicates
 * are silently dropped.
 */
export async function assignLeadsToCampaign(
  businessIds: string[],
  campaignId: string,
): Promise<AssignLeadsResult> {
  const ids = [...new Set(businessIds.filter(Boolean))];
  if (ids.length === 0) {
    return { ok: false, message: "Geen businesses geselecteerd." };
  }
  if (!campaignId) {
    return { ok: false, message: "Kies een campagne." };
  }

  const db = getDb();

  const cRows = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const campaign = cRows[0];
  if (!campaign) {
    return { ok: false, message: "Campagne niet gevonden." };
  }

  const eligibleContacts = await db
    .select({ id: contacts.id, businessId: contacts.businessId })
    .from(contacts)
    .where(
      and(
        inArray(contacts.businessId, ids),
        eq(contacts.doNotContact, false),
        eq(contacts.isVerified, true),
      ),
    );

  const businessesWithContact = new Set(
    eligibleContacts.map((c) => c.businessId),
  );
  const skippedNoContact = ids.filter((id) => !businessesWithContact.has(id))
    .length;

  if (eligibleContacts.length === 0) {
    return {
      ok: false,
      message:
        "Geen verifieerbare contacts (email gevonden + niet DNC) bij deze leads. Run eerst pnpm enrich.",
      assigned: 0,
      skipped: 0,
      skippedNoContact,
    };
  }

  const existing = await db
    .select({ contactId: campaignLeads.contactId })
    .from(campaignLeads)
    .where(
      and(
        eq(campaignLeads.campaignId, campaign.id),
        inArray(
          campaignLeads.contactId,
          eligibleContacts.map((c) => c.id),
        ),
      ),
    );
  const existingSet = new Set(existing.map((e) => e.contactId));

  const toInsert = eligibleContacts.filter((c) => !existingSet.has(c.id));
  if (toInsert.length === 0) {
    return {
      ok: true,
      message: `Alle ${eligibleContacts.length} contact(s) zaten al in "${campaign.name}". Niets toegevoegd.`,
      assigned: 0,
      skipped: eligibleContacts.length,
      skippedNoContact,
    };
  }

  const now = new Date();
  await db
    .insert(campaignLeads)
    .values(
      toInsert.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: "queued",
        currentStep: 0,
        nextSendAt: now,
        lastEventAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [campaignLeads.campaignId, campaignLeads.contactId],
    });

  revalidatePath("/leads");
  revalidatePath("/campaigns");

  const parts = [`${toInsert.length} contact(s) toegevoegd aan "${campaign.name}"`];
  if (existingSet.size > 0) parts.push(`${existingSet.size} zaten er al in`);
  if (skippedNoContact > 0)
    parts.push(`${skippedNoContact} business(es) zonder verified contact overgeslagen`);

  return {
    ok: true,
    message: parts.join(", ") + ".",
    assigned: toInsert.length,
    skipped: existingSet.size,
    skippedNoContact,
  };
}
