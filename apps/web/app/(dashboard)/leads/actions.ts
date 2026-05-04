"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import {
  campaignLeads,
  campaigns,
  contacts,
  getDb,
} from "@outreach/db";
import type { AssignLeadsResult, ContactActionResult } from "./types";

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

  // Pak alle non-DNC contacts. is_verified blijft een info-vlag maar
  // gate't de UI niet — anders kun je voor enrichment niets toewijzen.
  // De daadwerkelijke MX-check gebeurt elders (enrich + send-time).
  const eligibleContacts = await db
    .select({ id: contacts.id, businessId: contacts.businessId })
    .from(contacts)
    .where(
      and(
        inArray(contacts.businessId, ids),
        eq(contacts.doNotContact, false),
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
        "Geen contacts (email) bij deze leads. Run eerst pnpm enrich om e-mails te verzamelen.",
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

/**
 * Toggle do_not_contact op een contact. Eenvoudige manier om de
 * scraper-junk (placeholder e-mails, verkeerde vestigingen) uit te
 * sluiten zonder hem te verwijderen — campaign_leads die er al naar
 * verwijzen blijven intact, maar de send-pipeline filtert DNC eruit.
 */
export async function setContactDnc(
  contactId: string,
  doNotContact: boolean,
): Promise<ContactActionResult> {
  if (!contactId) return { ok: false, message: "Geen contact-id." };
  const db = getDb();
  const [updated] = await db
    .update(contacts)
    .set({ doNotContact })
    .where(eq(contacts.id, contactId))
    .returning({ id: contacts.id, businessId: contacts.businessId });
  if (!updated) return { ok: false, message: "Contact niet gevonden." };

  revalidatePath(`/leads/${updated.businessId}`);
  revalidatePath("/leads");

  return {
    ok: true,
    message: doNotContact
      ? "Op DNC gezet — niet meer benaderen."
      : "DNC verwijderd — kan weer benaderd worden.",
  };
}

/**
 * Verwijder een contact volledig. Cascade ruimt campaign_leads op die
 * eraan refereren — geen orphan rows. Gebruik dit voor evident kapotte
 * adressen (escape-bugs, placeholders) waar DNC-zetten niet schoon
 * genoeg voelt.
 */
export async function deleteContact(
  contactId: string,
): Promise<ContactActionResult> {
  if (!contactId) return { ok: false, message: "Geen contact-id." };
  const db = getDb();
  const [deleted] = await db
    .delete(contacts)
    .where(eq(contacts.id, contactId))
    .returning({ businessId: contacts.businessId });
  if (!deleted) return { ok: false, message: "Contact niet gevonden." };

  revalidatePath(`/leads/${deleted.businessId}`);
  revalidatePath("/leads");

  return { ok: true, message: "Contact verwijderd." };
}
