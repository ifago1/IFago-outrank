import { eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  businesses,
  campaigns,
  getDb,
} from "@outreach/db";
import { PageHeader } from "../_ui";
import { LeadsClient, type LeadRow, type CampaignOption } from "./leads-client";

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
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

  // Vrije zoekterm — case-insensitive substring over naam, stad,
  // categorie, telefoon én contact-email (via EXISTS-subquery zodat
  // we geen extra join nodig hebben die de hoofdquery dupliceert).
  const q = (params.q ?? "").trim();
  if (q) {
    const pattern = `%${q}%`;
    const orClause = or(
      ilike(businesses.name, pattern),
      ilike(businesses.city, pattern),
      ilike(businesses.category, pattern),
      ilike(businesses.phone, pattern),
      sql`EXISTS (
        SELECT 1 FROM contacts cc
        WHERE cc.business_id = businesses.id
          AND (
            cc.email ILIKE ${pattern}
            OR cc.first_name ILIKE ${pattern}
            OR cc.last_name ILIKE ${pattern}
          )
      )`,
    );
    if (orClause) where.push(orClause);
  }

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
        subtitle={
          q
            ? `${leadRows.length} resultaten voor "${q}"${leadRows.length === 100 ? " (eerste 100, verfijn je zoekopdracht voor meer)" : ""}.`
            : `${leadRows.length} businesses (laatste 100). Selecteer één of meerdere om toe te wijzen aan een campagne.`
        }
      />
      <LeadsClient
        rows={leadRows}
        campaigns={campaignOptions}
        params={params}
      />
    </>
  );
}
