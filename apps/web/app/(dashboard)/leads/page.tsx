import { eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  businesses,
  campaigns,
  getDb,
} from "@outreach/db";
import { PageHeader } from "../_ui";
import { LeadsClient, type LeadRow, type CampaignOption } from "./leads-client";

export const dynamic = "force-dynamic";

interface SearchParams {
  niche?: string;
  city?: string;
  status?: "any" | "no_website" | "outdated" | "decent" | "good";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const db = getDb();

  const where: SQL[] = [];
  if (params.niche) where.push(eq(businesses.category, params.niche));
  if (params.city) where.push(eq(businesses.city, params.city));
  if (params.status === "no_website") where.push(isNull(businesses.websiteUrl));
  if (
    params.status === "outdated" ||
    params.status === "decent" ||
    params.status === "good"
  ) {
    where.push(eq(businesses.websiteQuality, params.status));
  }

  const rows = await db
    .select({
      businessId: businesses.id,
      name: businesses.name,
      city: businesses.city,
      category: businesses.category,
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
      rating: businesses.googleRating,
      reviewsCount: businesses.reviewsCount,
      contactCount: sql<number>`(SELECT count(*)::int FROM contacts cc WHERE cc.business_id = businesses.id)`,
      verifiedContactCount: sql<number>`(
        SELECT count(*)::int FROM contacts cc
        WHERE cc.business_id = businesses.id
          AND cc.is_verified = true
          AND cc.do_not_contact = false
      )`,
      activeLeadCount: sql<number>`(
        SELECT count(*)::int FROM campaign_leads cl
        INNER JOIN contacts ct ON ct.id = cl.contact_id
        WHERE ct.business_id = businesses.id
          AND cl.status IN ('queued', 'sent')
      )`,
    })
    .from(businesses)
    .where(where.length ? sql.join(where, sql` AND `) : sql`true`)
    .orderBy(sql`${businesses.discoveredAt} DESC`)
    .limit(100);

  const leadRows: LeadRow[] = rows.map((r) => ({
    businessId: r.businessId,
    name: r.name,
    city: r.city,
    category: r.category,
    websiteUrl: r.websiteUrl,
    websiteQuality: r.websiteQuality,
    rating: r.rating != null ? Number(r.rating) : null,
    reviewsCount: r.reviewsCount,
    contactCount: r.contactCount,
    verifiedContactCount: r.verifiedContactCount,
    activeLeadCount: r.activeLeadCount,
  }));

  const campaignList = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
    })
    .from(campaigns)
    .orderBy(sql`${campaigns.createdAt} DESC`);

  const campaignOptions: CampaignOption[] = campaignList.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
  }));

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`${leadRows.length} businesses (latest 100). Selecteer er één of meerdere en wijs ze toe aan een campagne.`}
      />
      <LeadsClient
        rows={leadRows}
        campaigns={campaignOptions}
        params={params}
      />
    </>
  );
}
