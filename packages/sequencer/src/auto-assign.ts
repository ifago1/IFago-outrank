import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  type Db,
} from "@outreach/db";

/**
 * Auto-assign module: matcht losse leads op campagnes o.b.v.
 * per-campagne ingestelde filters (niche/locatie/website-kwaliteit +
 * htmlScore-range + max-leads cap). Doel: nieuwe leads landen direct
 * in de juiste campagne na discovery + enrichment.
 *
 * Match-regels (alle niet-lege filters moeten passen):
 * - autoAssignNiche:    case-insensitive substring tegen
 *                       businesses.category (NL en EN-keywords mengen
 *                       gaat niet — kies wat Places teruggeeft).
 * - autoAssignCity:     case-insensitive exact tegen businesses.city.
 * - autoAssignWebsiteQuality: bucket-match tegen businesses.website_quality
 *                       (good/decent/outdated). "none" matcht ook
 *                       leads zonder website_quality (= geen site).
 * - autoAssignMinScore / autoAssignMaxScore: inclusieve range op
 *                       businesses.audit_detail.htmlScore (0-100). Bij
 *                       missing htmlScore wordt de lead afgewezen
 *                       wanneer een score-filter is gezet.
 *
 * autoAssignMaxLeads is een cap op het totaal in deze campagne — de
 * sweep stopt voor deze campagne zodra die hit. Bij gelijkspel (meer
 * dan één campagne matcht een lead) wint de specificere campagne
 * (meer niet-lege filters).
 */

export interface CandidateLead {
  contactId: string;
  businessId: string;
  businessCategory: string | null;
  businessCity: string | null;
  businessWebsiteQuality: string | null;
  /** Uit businesses.audit_detail.htmlScore. Null als nog niet geaudit. */
  htmlScore: number | null;
}

export interface CampaignRule {
  id: string;
  niche: string | null;
  autoAssignNiche: string | null;
  autoAssignCity: string | null;
  autoAssignWebsiteQuality: string | null;
  autoAssignMinScore: number | null;
  autoAssignMaxScore: number | null;
  autoAssignMaxLeads: number | null;
}

/**
 * Pure matcher: kies de best-passende campagne voor één lead, of null
 * als geen enkele auto-assign-campagne deze lead matcht. Caller is
 * verantwoordelijk voor het filteren op autoAssignEnabled.
 */
export function findMatchingCampaign(
  lead: CandidateLead,
  campaignsList: CampaignRule[],
): CampaignRule | null {
  const candidates = campaignsList.filter((c) => matchesLead(lead, c));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => countFilters(b) - countFilters(a));
  return candidates[0] ?? null;
}

function matchesLead(lead: CandidateLead, c: CampaignRule): boolean {
  if (c.autoAssignNiche) {
    const cat = (lead.businessCategory ?? "").toLowerCase();
    const needle = c.autoAssignNiche.trim().toLowerCase();
    if (!needle || !cat.includes(needle)) return false;
  }
  if (c.autoAssignCity) {
    if (!lead.businessCity) return false;
    if (
      lead.businessCity.trim().toLowerCase() !==
      c.autoAssignCity.trim().toLowerCase()
    ) {
      return false;
    }
  }
  if (c.autoAssignWebsiteQuality) {
    const effective = lead.businessWebsiteQuality ?? "none";
    if (effective !== c.autoAssignWebsiteQuality) return false;
  }
  if (c.autoAssignMinScore !== null || c.autoAssignMaxScore !== null) {
    if (lead.htmlScore === null) return false;
    if (
      c.autoAssignMinScore !== null &&
      lead.htmlScore < c.autoAssignMinScore
    ) {
      return false;
    }
    if (
      c.autoAssignMaxScore !== null &&
      lead.htmlScore > c.autoAssignMaxScore
    ) {
      return false;
    }
  }
  return true;
}

function countFilters(c: CampaignRule): number {
  let n = 0;
  if (c.autoAssignNiche) n += 1;
  if (c.autoAssignCity) n += 1;
  if (c.autoAssignWebsiteQuality) n += 1;
  if (c.autoAssignMinScore !== null || c.autoAssignMaxScore !== null) n += 1;
  return n;
}

export interface AutoAssignResult {
  assigned: number;
  unmatched: number;
  skippedAlreadyInCampaign: number;
  skippedMaxLeads: number;
  perCampaign: { campaignId: string; count: number }[];
}

export interface RunAutoAssignOptions {
  limit?: number;
  dryRun?: boolean;
}

/**
 * Scan niet-DNC contacts zonder campagne en wijs ze toe aan de
 * matchende auto-assign-campagne. Idempotent via onConflictDoNothing
 * op de unique-index (campaign_id, contact_id).
 */
export async function runAutoAssign(
  db: Db,
  opts: RunAutoAssignOptions = {},
): Promise<AutoAssignResult> {
  const limit = opts.limit ?? 500;

  const ruleRows = await db
    .select({
      id: campaigns.id,
      niche: campaigns.niche,
      autoAssignNiche: campaigns.autoAssignNiche,
      autoAssignCity: campaigns.autoAssignCity,
      autoAssignWebsiteQuality: campaigns.autoAssignWebsiteQuality,
      autoAssignMinScore: campaigns.autoAssignMinScore,
      autoAssignMaxScore: campaigns.autoAssignMaxScore,
      autoAssignMaxLeads: campaigns.autoAssignMaxLeads,
      currentLeadCount: sql<number>`(
        SELECT count(*)::int FROM campaign_leads
        WHERE campaign_leads.campaign_id = ${campaigns.id}
      )`,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.autoAssignEnabled, true),
        eq(campaigns.status, "active"),
      ),
    );

  if (ruleRows.length === 0) {
    return {
      assigned: 0,
      unmatched: 0,
      skippedAlreadyInCampaign: 0,
      skippedMaxLeads: 0,
      perCampaign: [],
    };
  }

  // Houd per-campagne budget bij — de cap is over de hele tijd, niet
  // per-tick, dus we tellen al-bestaande leads mee.
  const rules: CampaignRule[] = ruleRows;
  const budgetLeft = new Map<string, number | null>();
  for (const r of ruleRows) {
    if (r.autoAssignMaxLeads === null) {
      budgetLeft.set(r.id, null); // unlimited
    } else {
      budgetLeft.set(r.id, Math.max(0, r.autoAssignMaxLeads - r.currentLeadCount));
    }
  }

  const contactsWithCampaign = db
    .select({ id: campaignLeads.contactId })
    .from(campaignLeads);

  const candidates = await db
    .select({
      contactId: contacts.id,
      businessId: businesses.id,
      businessCategory: businesses.category,
      businessCity: businesses.city,
      businessWebsiteQuality: businesses.websiteQuality,
      auditDetail: businesses.auditDetail,
    })
    .from(contacts)
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .where(
      and(
        eq(contacts.doNotContact, false),
        notInArray(contacts.id, contactsWithCampaign),
      ),
    )
    .limit(limit);

  let unmatched = 0;
  let skippedMaxLeads = 0;
  const inserts: { campaignId: string; contactId: string }[] = [];

  for (const cand of candidates) {
    const lead: CandidateLead = {
      contactId: cand.contactId,
      businessId: cand.businessId,
      businessCategory: cand.businessCategory,
      businessCity: cand.businessCity,
      businessWebsiteQuality: cand.businessWebsiteQuality,
      htmlScore: extractHtmlScore(cand.auditDetail),
    };
    const match = findMatchingCampaign(lead, rules);
    if (!match) {
      unmatched += 1;
      continue;
    }
    const left = budgetLeft.get(match.id);
    if (left !== null && left !== undefined && left <= 0) {
      skippedMaxLeads += 1;
      continue;
    }
    inserts.push({ campaignId: match.id, contactId: cand.contactId });
    if (left !== null && left !== undefined) {
      budgetLeft.set(match.id, left - 1);
    }
  }

  const perCampaignMap = new Map<string, number>();
  if (inserts.length === 0 || opts.dryRun) {
    for (const ins of inserts) {
      perCampaignMap.set(
        ins.campaignId,
        (perCampaignMap.get(ins.campaignId) ?? 0) + 1,
      );
    }
    return {
      assigned: 0,
      unmatched,
      skippedAlreadyInCampaign: 0,
      skippedMaxLeads,
      perCampaign: [...perCampaignMap.entries()].map(([campaignId, count]) => ({
        campaignId,
        count,
      })),
    };
  }

  const now = new Date();
  const result = await db
    .insert(campaignLeads)
    .values(
      inserts.map((i) => ({
        campaignId: i.campaignId,
        contactId: i.contactId,
        status: "queued",
        currentStep: 0,
        nextSendAt: now,
        lastEventAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [campaignLeads.campaignId, campaignLeads.contactId],
    })
    .returning({
      id: campaignLeads.id,
      campaignId: campaignLeads.campaignId,
    });

  for (const r of result) {
    perCampaignMap.set(r.campaignId, (perCampaignMap.get(r.campaignId) ?? 0) + 1);
  }

  return {
    assigned: result.length,
    unmatched,
    skippedAlreadyInCampaign: inserts.length - result.length,
    skippedMaxLeads,
    perCampaign: [...perCampaignMap.entries()].map(([campaignId, count]) => ({
      campaignId,
      count,
    })),
  };
}

/**
 * Helper voor de UI: hoeveel leads zou deze campagne NU oppakken als
 * auto-assign liep? Schrijft niets.
 */
export async function previewAutoAssign(
  db: Db,
  campaignId: string,
): Promise<{ matching: number; alreadyAssigned: number }> {
  const cRows = await db
    .select({
      id: campaigns.id,
      niche: campaigns.niche,
      autoAssignNiche: campaigns.autoAssignNiche,
      autoAssignCity: campaigns.autoAssignCity,
      autoAssignWebsiteQuality: campaigns.autoAssignWebsiteQuality,
      autoAssignMinScore: campaigns.autoAssignMinScore,
      autoAssignMaxScore: campaigns.autoAssignMaxScore,
      autoAssignMaxLeads: campaigns.autoAssignMaxLeads,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const rule = cRows[0];
  if (!rule) return { matching: 0, alreadyAssigned: 0 };

  const already = await db
    .select({ contactId: campaignLeads.contactId })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, campaignId));
  const alreadySet = new Set(already.map((a) => a.contactId));

  const all = await db
    .select({
      contactId: contacts.id,
      businessId: businesses.id,
      businessCategory: businesses.category,
      businessCity: businesses.city,
      businessWebsiteQuality: businesses.websiteQuality,
      auditDetail: businesses.auditDetail,
    })
    .from(contacts)
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .where(eq(contacts.doNotContact, false));

  let matching = 0;
  let alreadyAssigned = 0;
  for (const c of all) {
    const lead: CandidateLead = {
      contactId: c.contactId,
      businessId: c.businessId,
      businessCategory: c.businessCategory,
      businessCity: c.businessCity,
      businessWebsiteQuality: c.businessWebsiteQuality,
      htmlScore: extractHtmlScore(c.auditDetail),
    };
    if (!matchesLead(lead, rule)) continue;
    if (alreadySet.has(c.contactId)) alreadyAssigned += 1;
    else matching += 1;
  }
  return { matching, alreadyAssigned };
}

function extractHtmlScore(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const v = r["htmlScore"];
  if (typeof v === "number") return v;
  return null;
}
