import { and, eq, notInArray } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  type Db,
} from "@outreach/db";

/**
 * Auto-assign module: matcht losse leads op campagnes op basis van
 * niche / locatie / website-kwaliteit-filters die per campagne zijn
 * gezet. Doel: wanneer discovery + enrichment nieuwe leads opleveren,
 * gaan ze direct in de juiste campagne zonder handmatige klikken.
 *
 * Match-regels (alle niet-lege filters moeten passen):
 * - matchNiches:       case-insensitive substring tegen campaigns.niche
 *                      en businesses.category. Lege array = alle.
 * - matchCities:       case-insensitive exact tegen businesses.city.
 * - matchWebsiteQualities: bucket-set tegen businesses.website_quality
 *                      (good/decent/outdated/none).
 *
 * Bij meerdere matches: hoogste match_priority wint. Bij gelijkspel:
 * specificere campagne (meer niet-lege filters) wint.
 */

export interface CandidateLead {
  /** ID van het matchende contact. */
  contactId: string;
  businessId: string;
  businessCategory: string | null;
  businessCity: string | null;
  businessWebsiteQuality: string | null;
}

export interface CampaignRule {
  id: string;
  niche: string | null;
  matchNiches: string[] | null;
  matchCities: string[] | null;
  matchWebsiteQualities: string[] | null;
  matchPriority: number;
}

/**
 * Pure matcher: kies de best-passende campagne voor één lead, of null
 * als geen enkele auto-assign-campagne deze lead matcht.
 */
export function findMatchingCampaign(
  lead: CandidateLead,
  campaignsList: CampaignRule[],
): CampaignRule | null {
  const candidates = campaignsList.filter((c) => matchesLead(lead, c));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (b.matchPriority !== a.matchPriority) {
      return b.matchPriority - a.matchPriority;
    }
    return countFilters(b) - countFilters(a);
  });
  return candidates[0] ?? null;
}

function matchesLead(lead: CandidateLead, c: CampaignRule): boolean {
  if (c.matchNiches && c.matchNiches.length > 0) {
    // Substring tegen businesses.category. Places-API levert vaak Engels
    // ("Hair salon"); de gebruiker kan meerdere keywords toevoegen
    // (bv. "kapper,kapsalon,hair") om dat te dekken.
    const cat = (lead.businessCategory ?? "").toLowerCase();
    const ok = c.matchNiches.some((n) => {
      const needle = n.trim().toLowerCase();
      if (!needle) return false;
      return cat.includes(needle);
    });
    if (!ok) return false;
  }
  if (c.matchCities && c.matchCities.length > 0) {
    if (!lead.businessCity) return false;
    const city = lead.businessCity.trim().toLowerCase();
    const ok = c.matchCities.some(
      (m) => m.trim().toLowerCase() === city,
    );
    if (!ok) return false;
  }
  if (c.matchWebsiteQualities && c.matchWebsiteQualities.length > 0) {
    const lq = lead.businessWebsiteQuality;
    // "none" target matcht ook leads zonder website_quality (= geen site).
    const effective = lq ?? "none";
    if (!c.matchWebsiteQualities.includes(effective)) return false;
  }
  return true;
}

function countFilters(c: CampaignRule): number {
  let n = 0;
  if (c.matchNiches && c.matchNiches.length > 0) n += 1;
  if (c.matchCities && c.matchCities.length > 0) n += 1;
  if (c.matchWebsiteQualities && c.matchWebsiteQualities.length > 0) n += 1;
  return n;
}

export interface AutoAssignResult {
  /** Aantal nieuwe campaign_lead rows ingevoegd. */
  assigned: number;
  /** Hoeveel kandidaten geen enkele campagne matchten. */
  unmatched: number;
  /** Hoeveel contacts al in een campagne zaten — overgeslagen. */
  skippedAlreadyInCampaign: number;
  perCampaign: { campaignId: string; count: number }[];
}

export interface RunAutoAssignOptions {
  /** Cap op het aantal kandidaten dat per call wordt verwerkt. */
  limit?: number;
  /** Dry-run: log + tel, maar insert niet. */
  dryRun?: boolean;
}

/**
 * Scan eligible contacts (non-DNC, hun business heeft een
 * website_quality-bucket of is "no website") die nog niet in een
 * campagne zitten — en wijs ze toe aan de eerste matchende
 * auto-assign-campagne. Idempotent: de unique-index op (campaign_id,
 * contact_id) voorkomt dubbele rows.
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
      matchNiches: campaigns.matchNiches,
      matchCities: campaigns.matchCities,
      matchWebsiteQualities: campaigns.matchWebsiteQualities,
      matchPriority: campaigns.matchPriority,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.autoAssignEnabled, true),
        eq(campaigns.status, "active"),
      ),
    );
  const rules: CampaignRule[] = ruleRows;
  if (rules.length === 0) {
    return { assigned: 0, unmatched: 0, skippedAlreadyInCampaign: 0, perCampaign: [] };
  }

  // Pak contacts die nog NERGENS in een campagne zitten. We
  // checken op contact_id-niveau zodat een business met meerdere
  // contacts gedeeltelijk-assigned kan blijven.
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

  let assigned = 0;
  let unmatched = 0;
  const perCampaignMap = new Map<string, number>();

  // Bouw insert-lijst per matchende campagne. Idempotent via
  // onConflictDoNothing zodat een race met handmatige assign geen rij
  // dubbelt.
  const inserts: { campaignId: string; contactId: string }[] = [];
  for (const cand of candidates) {
    const match = findMatchingCampaign(cand, rules);
    if (!match) {
      unmatched += 1;
      continue;
    }
    inserts.push({ campaignId: match.id, contactId: cand.contactId });
  }

  if (inserts.length === 0 || opts.dryRun) {
    for (const ins of inserts) {
      perCampaignMap.set(
        ins.campaignId,
        (perCampaignMap.get(ins.campaignId) ?? 0) + 1,
      );
    }
    return {
      assigned: opts.dryRun ? 0 : 0,
      unmatched,
      skippedAlreadyInCampaign: 0,
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

  assigned = result.length;
  for (const r of result) {
    perCampaignMap.set(r.campaignId, (perCampaignMap.get(r.campaignId) ?? 0) + 1);
  }

  return {
    assigned,
    unmatched,
    skippedAlreadyInCampaign: inserts.length - assigned,
    perCampaign: [...perCampaignMap.entries()].map(([campaignId, count]) => ({
      campaignId,
      count,
    })),
  };
}

/**
 * Helper voor de UI: hoeveel leads zouden NU in een gegeven campagne
 * landen als auto-assign aanstaat? Pure preview — schrijft niets.
 */
export async function previewAutoAssign(
  db: Db,
  campaignId: string,
): Promise<{ matching: number; alreadyAssigned: number }> {
  const cRows = await db
    .select({
      id: campaigns.id,
      niche: campaigns.niche,
      matchNiches: campaigns.matchNiches,
      matchCities: campaigns.matchCities,
      matchWebsiteQualities: campaigns.matchWebsiteQualities,
      matchPriority: campaigns.matchPriority,
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
    })
    .from(contacts)
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .where(eq(contacts.doNotContact, false));

  let matching = 0;
  let alreadyAssigned = 0;
  for (const c of all) {
    if (!matchesLead(c, rule)) continue;
    if (alreadySet.has(c.contactId)) alreadyAssigned += 1;
    else matching += 1;
  }
  return { matching, alreadyAssigned };
}
