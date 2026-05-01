import { eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  contacts,
  getDb,
} from "@outreach/db";
import { PageHeader, Pill, Table } from "../_ui";

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
      contactCount: sql<number>`(SELECT count(*)::int FROM contacts c WHERE c.business_id = ${businesses.id})`,
      activeLeadCount: sql<number>`(
        SELECT count(*)::int FROM ${campaignLeads}
        INNER JOIN ${contacts} ON ${contacts.id} = ${campaignLeads.contactId}
        WHERE ${contacts.businessId} = ${businesses.id}
          AND (${campaignLeads.status} = 'queued' OR ${campaignLeads.status} = 'sent')
      )`,
    })
    .from(businesses)
    .where(where.length ? sql.join(where, sql` AND `) : sql`true`)
    .orderBy(sql`${businesses.discoveredAt} DESC`)
    .limit(100);

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`${rows.length} businesses (latest 100)`}
      />
      <FilterBar params={params} />
      <Table
        columns={["Business", "City", "Category", "Website", "Quality", "Rating", "Contacts", "In campaign"]}
        rows={rows.map((r) => [
          r.name,
          r.city ?? "—",
          r.category ?? "—",
          r.websiteUrl ? (
            <a
              key="w"
              href={r.websiteUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#7ab8ff" }}
            >
              link
            </a>
          ) : (
            <Pill key="w" tone="warn">geen website</Pill>
          ),
          qualityPill(r.websiteUrl, r.websiteQuality),
          r.rating != null
            ? `${Number(r.rating).toFixed(1)} (${r.reviewsCount ?? 0})`
            : "—",
          r.contactCount,
          r.activeLeadCount > 0 ? <Pill key="a" tone="ok">{r.activeLeadCount}</Pill> : "—",
        ])}
        empty="Nog geen leads gevonden. Run `pnpm discover --niche=... --city=...`."
      />
    </>
  );
}

function qualityPill(websiteUrl: string | null, quality: string | null) {
  if (!websiteUrl) return <Pill tone="bad">geen site (top-prio)</Pill>;
  if (!quality || quality === "none")
    return <span style={{ opacity: 0.6 }}>—</span>;
  if (quality === "good") return <Pill tone="ok">goed</Pill>;
  if (quality === "decent") return <Pill tone="warn">decent</Pill>;
  if (quality === "outdated") return <Pill tone="bad">verouderd</Pill>;
  return <Pill>{quality}</Pill>;
}

function FilterBar({ params }: { params: SearchParams }) {
  return (
    <form
      method="get"
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}
    >
      <input
        name="niche"
        defaultValue={params.niche ?? ""}
        placeholder="Niche (bv. kapper)"
        style={inputStyle}
      />
      <input
        name="city"
        defaultValue={params.city ?? ""}
        placeholder="Stad"
        style={inputStyle}
      />
      <select name="status" defaultValue={params.status ?? "any"} style={inputStyle}>
        <option value="any">Alle leads</option>
        <option value="no_website">Zonder website (top-prio)</option>
        <option value="outdated">Verouderde site</option>
        <option value="decent">Decent</option>
        <option value="good">Goed (skip)</option>
      </select>
      <button type="submit" style={btnStyle}>Filter</button>
    </form>
  );
}

const inputStyle = {
  padding: "0.5rem 0.75rem",
  background: "#0f1218",
  border: "1px solid #20252e",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.9rem",
};

const btnStyle = {
  ...inputStyle,
  cursor: "pointer",
  background: "#1d4ed8",
  borderColor: "#1d4ed8",
};
