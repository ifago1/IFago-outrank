import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  type Db,
} from "@outreach/db";

export interface DigestStats {
  /** Window covered by these stats. */
  since: Date;
  until: Date;
  sent: number;
  bounces: number;
  /** Replies whose `replied_at` falls inside the window — based on
   *  campaign_leads.last_event_at. */
  replies: number;
  /** Replies that the AI triage classified as positive (or referral). */
  positive: number;
  /** Top 3 campaigns by sends in the window. */
  byCampaign: Array<{
    campaignId: string;
    campaignName: string;
    sent: number;
    replies: number;
  }>;
  /** Most recent positive replies (max 5). */
  topPositive: Array<{
    email: string;
    business: string;
    summary: string | null;
    when: Date;
  }>;
}

/**
 * Compute digest stats for a time window. Pure-ish (only DB reads, no
 * mutation), so the BullMQ worker and a CLI can both use it.
 */
export async function loadDigestStats(
  db: Db,
  since: Date,
  until: Date,
): Promise<DigestStats> {
  const sentRows = await db
    .select({
      bounced: emailsSent.bounced,
      campaignId: campaignLeads.campaignId,
    })
    .from(emailsSent)
    .innerJoin(
      campaignLeads,
      eq(campaignLeads.id, emailsSent.campaignLeadId),
    )
    .where(
      and(gte(emailsSent.sentAt, since), lt(emailsSent.sentAt, until)),
    );

  const sent = sentRows.length;
  const bounces = sentRows.filter((r) => r.bounced).length;

  // Replies: leads whose status flipped to 'replied' inside the window.
  const replyRows = await db
    .select({
      classification: campaignLeads.replyClassification,
      summary: campaignLeads.replySummary,
      when: campaignLeads.lastEventAt,
      email: contacts.email,
      businessName: businesses.name,
    })
    .from(campaignLeads)
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .where(
      and(
        eq(campaignLeads.status, "replied"),
        gte(campaignLeads.lastEventAt, since),
        lt(campaignLeads.lastEventAt, until),
      ),
    );

  const replies = replyRows.length;
  const positive = replyRows.filter(
    (r) =>
      r.classification === "positive" || r.classification === "referral",
  ).length;

  // Top campaigns by sends, with per-campaign reply count joined back in.
  const perCampaign = new Map<
    string,
    { campaignId: string; campaignName: string; sent: number; replies: number }
  >();

  if (sent > 0) {
    const rows = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        sent: sql<number>`COUNT(*)::int`,
      })
      .from(emailsSent)
      .innerJoin(
        campaignLeads,
        eq(campaignLeads.id, emailsSent.campaignLeadId),
      )
      .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
      .where(
        and(gte(emailsSent.sentAt, since), lt(emailsSent.sentAt, until)),
      )
      .groupBy(campaigns.id, campaigns.name);
    for (const r of rows) {
      perCampaign.set(r.id, {
        campaignId: r.id,
        campaignName: r.name,
        sent: r.sent ?? 0,
        replies: 0,
      });
    }
  }

  // Second pass: count replies per campaign for the same window.
  if (replies > 0) {
    const rows = await db
      .select({
        id: campaigns.id,
        replies: sql<number>`COUNT(*)::int`,
      })
      .from(campaignLeads)
      .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
      .where(
        and(
          eq(campaignLeads.status, "replied"),
          gte(campaignLeads.lastEventAt, since),
          lt(campaignLeads.lastEventAt, until),
        ),
      )
      .groupBy(campaigns.id);
    for (const r of rows) {
      const existing = perCampaign.get(r.id);
      if (existing) existing.replies = r.replies ?? 0;
    }
  }

  const byCampaign = [...perCampaign.values()]
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 3);

  const topPositive = replyRows
    .filter(
      (r) =>
        r.classification === "positive" || r.classification === "referral",
    )
    .sort((a, b) => +new Date(b.when) - +new Date(a.when))
    .slice(0, 5)
    .map((r) => ({
      email: r.email,
      business: r.businessName,
      summary: r.summary,
      when: new Date(r.when as unknown as string),
    }));

  return {
    since,
    until,
    sent,
    bounces,
    replies,
    positive,
    byCampaign,
    topPositive,
  };
}

export interface RenderedDigest {
  subject: string;
  body: string;
}

export function renderDigest(stats: DigestStats): RenderedDigest {
  const day = stats.until.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const lines: string[] = [];
  lines.push(`Outreach digest — ${day}`);
  lines.push("");
  lines.push(`📤 Verstuurd: ${stats.sent}`);
  lines.push(
    `📥 Replies: ${stats.replies} (${stats.positive} positief / referral)`,
  );
  lines.push(`💥 Bounces: ${stats.bounces}${bounceTag(stats)}`);
  lines.push("");

  if (stats.byCampaign.length > 0) {
    lines.push("Top campagnes:");
    for (const c of stats.byCampaign) {
      lines.push(`  • ${c.campaignName}: ${c.sent} sent, ${c.replies} replies`);
    }
    lines.push("");
  }

  if (stats.topPositive.length > 0) {
    lines.push("Recente positieve replies:");
    for (const p of stats.topPositive) {
      lines.push(`  • ${p.business} (${p.email})`);
      if (p.summary) lines.push(`      ${p.summary}`);
    }
    lines.push("");
  }

  lines.push("Open dashboard: /inbox?filter=positive");

  const subject =
    stats.positive > 0
      ? `Outreach digest — ${stats.positive} positieve reply(s)`
      : `Outreach digest — ${stats.sent} sent / ${stats.replies} replies`;

  return { subject, body: lines.join("\n") };
}

function bounceTag(s: DigestStats): string {
  if (s.sent === 0) return "";
  const rate = s.bounces / s.sent;
  if (rate > 0.05) return ` (⚠️ ${(rate * 100).toFixed(1)}% — actie nodig)`;
  if (rate > 0.03) return ` (${(rate * 100).toFixed(1)}%)`;
  return "";
}
