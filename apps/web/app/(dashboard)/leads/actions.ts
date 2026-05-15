"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  getDb,
  getSetting,
} from "@outreach/db";
import {
  EnrichmentService,
  HunterClient,
  WebsiteScraper,
} from "@outreach/enrichment";
import { runCompositeAudit } from "@outreach/website-quality";
import type {
  AiAuditActionResult,
  AssignLeadsResult,
  BulkEnrichResult,
  ContactActionResult,
} from "./types";

/**
 * Bulk-enrich vanuit de UI: voor elke geselecteerde business
 * (website-scrape + Hunter + MX-validate) en sla de gevonden contacts
 * op. Niet-geselecteerde leads + leads die al een contact hebben
 * worden overgeslagen (idempotent). Cap op 50 per call zodat de
 * server-action niet timeout't bij grote selecties — voor meer dan
 * dat kan de gebruiker meerdere keren klikken of de CLI runnen.
 */
export async function bulkEnrichLeads(
  businessIds: string[],
): Promise<BulkEnrichResult> {
  const ids = [...new Set(businessIds.filter(Boolean))].slice(0, 50);
  if (ids.length === 0) {
    return {
      ok: false,
      message: "Geen leads geselecteerd.",
      processed: 0,
      withEmails: 0,
      newContacts: 0,
      skippedNoWebsite: 0,
      failed: 0,
    };
  }

  const db = getDb();

  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      websiteUrl: businesses.websiteUrl,
    })
    .from(businesses)
    .where(inArray(businesses.id, ids));

  const eligible = rows.filter((r) => r.websiteUrl != null);
  const skippedNoWebsite = rows.length - eligible.length;

  if (eligible.length === 0) {
    return {
      ok: false,
      message: `Geen van de ${rows.length} geselecteerde leads heeft een website-URL — niets te scrapen.`,
      processed: 0,
      withEmails: 0,
      newContacts: 0,
      skippedNoWebsite,
      failed: 0,
    };
  }

  const hunterKey =
    (await getSetting(db, "HUNTER_API_KEY")) ?? process.env["HUNTER_API_KEY"];
  const service = new EnrichmentService({
    scraper: new WebsiteScraper(),
    hunter: hunterKey ? new HunterClient({ apiKey: hunterKey }) : undefined,
  });

  const batch = await service.enrichBatch(
    eligible.map((b) => ({
      businessName: b.name,
      websiteUrl: b.websiteUrl!,
    })),
    { concurrency: 5 },
  );

  let withEmails = 0;
  let newContacts = 0;
  let failed = 0;

  for (let i = 0; i < batch.length; i += 1) {
    const b = eligible[i]!;
    const r = batch[i]!;
    if (r.error || r.result === null) {
      failed += 1;
      continue;
    }
    if (r.result.emails.length === 0) continue;
    withEmails += 1;

    const toInsert = r.result.emails.map((e) => ({
      businessId: b.id,
      email: e.email,
      ...(e.firstName ? { firstName: e.firstName } : {}),
      ...(e.lastName ? { lastName: e.lastName } : {}),
      source: e.source,
      isVerified: true,
    }));

    const inserted = await db
      .insert(contacts)
      .values(toInsert)
      .onConflictDoNothing({
        target: [contacts.businessId, contacts.email],
      })
      .returning({ id: contacts.id });
    newContacts += inserted.length;
  }

  revalidatePath("/leads");

  const parts: string[] = [];
  parts.push(`${newContacts} nieuwe contact(s)`);
  parts.push(`${withEmails}/${eligible.length} leads met emails`);
  if (skippedNoWebsite > 0) parts.push(`${skippedNoWebsite} zonder website overgeslagen`);
  if (failed > 0) parts.push(`${failed} faalden`);
  if (!hunterKey) parts.push("Hunter niet actief (geen key)");

  return {
    ok: true,
    message: parts.join(", ") + ".",
    processed: eligible.length,
    withEmails,
    newContacts,
    skippedNoWebsite,
    failed,
  };
}

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Voeg handmatig een contact toe aan een business. Gebruikt voor
 * websiteloze leads waar de gebruiker via Google/Facebook/KvK een
 * email-adres heeft gevonden. source = 'manual' zodat we later kunnen
 * filteren op handmatig-vs-scraped, en isVerified default false (de
 * gebruiker kan 'm aanvinken na een MX-check).
 */
export async function addManualContact(
  businessId: string,
  form: FormData,
): Promise<ContactActionResult> {
  if (!businessId) return { ok: false, message: "Geen business-id." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const firstName = String(form.get("firstName") ?? "").trim() || null;
  const lastName = String(form.get("lastName") ?? "").trim() || null;
  const isVerified = form.get("isVerified") === "on";

  if (!email) return { ok: false, message: "Email is vereist." };
  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: "Ongeldig email-adres." };
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(eq(contacts.businessId, businessId), eq(contacts.email, email)),
    )
    .limit(1);
  if (existing) {
    return {
      ok: false,
      message: "Dit e-mailadres staat al bij deze business.",
    };
  }

  await db.insert(contacts).values({
    businessId,
    email,
    firstName,
    lastName,
    source: "manual",
    isVerified,
    doNotContact: false,
  });

  revalidatePath(`/leads/${businessId}`);
  revalidatePath("/leads");

  return {
    ok: true,
    message: `Contact ${email} toegevoegd${isVerified ? " (verified)" : " (niet-verified — markeer na MX-check)"}.`,
  };
}

/**
 * Re-run de website-audit voor één business — Tier 1 (HTML), Tier 2
 * (PSI als key gezet) én Tier 3 (AI design-audit als ANTHROPIC_API_KEY
 * gezet). Slaat het resultaat op in audit_detail + werkt
 * website_quality bij.
 *
 * Specifiek bedoeld als manual button op de detailpagina — discovery
 * draait nooit Tier 3 inline omdat het ~$0.005 per call kost en je
 * bij honderden discoveries niet een ongeplande Anthropic-rekening
 * wilt.
 */
export async function rerunAuditForBusiness(
  businessId: string,
  opts: { useAi?: boolean } = {},
): Promise<AiAuditActionResult> {
  if (!businessId) return { ok: false, message: "Geen business-id." };
  const db = getDb();

  const [b] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      websiteUrl: businesses.websiteUrl,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!b) return { ok: false, message: "Business niet gevonden." };
  if (!b.websiteUrl) {
    return { ok: false, message: "Geen website-URL — niets om te scoren." };
  }

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
    return {
      ok: false,
      message:
        "ANTHROPIC_API_KEY ontbreekt — vul in via Settings tab voor AI design-audit.",
    };
  }

  try {
    const result = await runCompositeAudit(b.websiteUrl, {
      ...(psiApiKey ? { psiApiKey } : {}),
      ...(anthropicApiKey ? { anthropicApiKey, aiModel } : {}),
      businessName: b.name,
    });
    await db
      .update(businesses)
      .set({
        websiteQuality: result.bucket,
        auditDetail: result as unknown as Record<string, unknown>,
        auditedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    revalidatePath(`/leads/${businessId}`);
    revalidatePath("/leads");

    const tiers = ["HTML"];
    if (result.psi?.ok) tiers.push("PSI");
    if (result.ai?.ok) tiers.push("AI");

    return {
      ok: true,
      message: `Audit klaar — ${tiers.join(" + ")}, bucket: ${result.bucket}.`,
      ...(result.ai?.score != null ? { score: result.ai.score } : {}),
      ...(result.ai?.summary ? { summary: result.ai.summary } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Audit faalde: ${msg}` };
  }
}
