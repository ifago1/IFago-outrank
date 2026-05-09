import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  type Db,
} from "@outreach/db";

export interface AutoAssignSummary {
  /** Total assignments written (one row per (contact, campaign) pair). */
  assigned: number;
  /** Per-campaign breakdown for logging / dashboards. */
  perCampaign: Array<{ campaignId: string; campaignName: string; count: number }>;
}

/**
 * For every campaign with `auto_assign_enabled = true`, scan the given
 * contact IDs and assign the ones whose business matches the campaign's
 * niche / city / website-quality rules. NULL rule fields act as wildcards.
 *
 * Idempotent: reuses the unique index on (campaign_id, contact_id), so
 * already-assigned contacts are skipped silently.
 *
 * Hard caps are honoured per-campaign via `auto_assign_max_leads` — once
 * the cap is reached, no more leads are added regardless of incoming
 * matches. NULL = unbounded.
 *
 * Returns a summary so callers can log how many ended up where.
 */
export async function autoAssignContacts(
  db: Db,
  contactIds: readonly string[],
): Promise<AutoAssignSummary> {
  if (contactIds.length === 0) {
    return { assigned: 0, perCampaign: [] };
  }

  const rules = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      niche: campaigns.autoAssignNiche,
      city: campaigns.autoAssignCity,
      websiteQuality: campaigns.autoAssignWebsiteQuality,
      maxLeads: campaigns.autoAssignMaxLeads,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.autoAssignEnabled, true),
        eq(campaigns.status, "active"),
      ),
    );

  if (rules.length === 0) return { assigned: 0, perCampaign: [] };

  const eligibleContacts = await db
    .select({
      contactId: contacts.id,
      doNotContact: contacts.doNotContact,
      isVerified: contacts.isVerified,
      businessId: businesses.id,
      category: businesses.category,
      city: businesses.city,
      websiteQuality: businesses.websiteQuality,
    })
    .from(contacts)
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .where(
      and(
        inArray(contacts.id, [...contactIds]),
        eq(contacts.doNotContact, false),
        eq(contacts.isVerified, true),
      ),
    );

  if (eligibleContacts.length === 0) {
    return { assigned: 0, perCampaign: [] };
  }

  const summary: AutoAssignSummary = { assigned: 0, perCampaign: [] };
  const now = new Date();

  for (const rule of rules) {
    let remaining = await capacityRemaining(db, rule.id, rule.maxLeads);
    if (remaining <= 0) continue;

    const matches = eligibleContacts.filter(
      (c) => matchesRule(c, rule) && remaining-- > 0,
    );
    if (matches.length === 0) continue;

    const inserted = await db
      .insert(campaignLeads)
      .values(
        matches.map((m) => ({
          campaignId: rule.id,
          contactId: m.contactId,
          status: "queued",
          currentStep: 0,
          nextSendAt: now,
          lastEventAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [campaignLeads.campaignId, campaignLeads.contactId],
      })
      .returning({ id: campaignLeads.id });

    if (inserted.length > 0) {
      summary.assigned += inserted.length;
      summary.perCampaign.push({
        campaignId: rule.id,
        campaignName: rule.name,
        count: inserted.length,
      });
    }
  }

  return summary;
}

interface ContactRow {
  category: string | null;
  city: string | null;
  websiteQuality: string | null;
}

interface RuleRow {
  niche: string | null;
  city: string | null;
  websiteQuality: string | null;
}

export function matchesRule(c: ContactRow, r: RuleRow): boolean {
  if (r.niche && !equalsCi(c.category, r.niche)) return false;
  if (r.city && !equalsCi(c.city, r.city)) return false;
  if (r.websiteQuality && c.websiteQuality !== r.websiteQuality) return false;
  return true;
}

function equalsCi(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return a.toLowerCase() === b.toLowerCase();
}

async function capacityRemaining(
  db: Db,
  campaignId: string,
  maxLeads: number | null,
): Promise<number> {
  if (maxLeads == null) return Number.POSITIVE_INFINITY;
  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(campaignLeads)
    .where(
      and(
        eq(campaignLeads.campaignId, campaignId),
        // count any non-terminal lead — bounced/replied still consumed a slot.
        isNotNull(campaignLeads.id),
      ),
    );
  const used = rows[0]?.count ?? 0;
  return Math.max(0, maxLeads - used);
}
