import { eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { businesses, getDb } from "@outreach/db";
import { PageHeader } from "../_ui";
import { PhoneRow } from "./phone-row";
import type { PhoneLeadRow, PhoneStatus } from "./types";

export const dynamic = "force-dynamic";

type Bucket = "open" | "followup" | "warm" | "done" | "all";

interface SearchParams {
  niche?: string;
  city?: string;
  bucket?: Bucket;
}

/**
 * Bellen-tab buckets:
 *   - open      → nog niet gebeld of expliciet gewist
 *   - followup  → voicemail / callback
 *   - warm      → interested
 *   - done      → not_interested / wrong_number (alleen voor audit;
 *                 wrong_number heeft phone gewist dus die zie je
 *                 alleen in audit-view)
 *   - all       → alles, ongeacht status
 */
export default async function PhonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const bucket: Bucket = params.bucket ?? "open";
  const db = getDb();

  const where: SQL[] = [];

  if (bucket !== "done") {
    where.push(isNotNull(businesses.phone));
  }

  if (bucket === "open") {
    where.push(isNull(businesses.phoneStatus));
    // Niet al via mail in een actieve campagne
    where.push(sql`NOT EXISTS (
      SELECT 1 FROM campaign_leads cl
      INNER JOIN contacts ct ON ct.id = cl.contact_id
      WHERE ct.business_id = businesses.id
        AND cl.status IN ('queued', 'sent')
    )`);
    // Geen werkende e-mail-route
    where.push(sql`NOT EXISTS (
      SELECT 1 FROM contacts cc
      WHERE cc.business_id = businesses.id
        AND cc.do_not_contact = false
    )`);
  } else if (bucket === "followup") {
    where.push(sql`${businesses.phoneStatus} IN ('voicemail', 'callback', 'called')`);
  } else if (bucket === "warm") {
    where.push(eq(businesses.phoneStatus, "interested"));
  } else if (bucket === "done") {
    where.push(sql`${businesses.phoneStatus} IN ('not_interested', 'wrong_number')`);
  }

  if (params.niche) where.push(eq(businesses.category, params.niche));
  if (params.city) where.push(eq(businesses.city, params.city));

  const rows = await db
    .select({
      businessId: businesses.id,
      name: businesses.name,
      city: businesses.city,
      category: businesses.category,
      phone: businesses.phone,
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
      rating: businesses.googleRating,
      reviewsCount: businesses.reviewsCount,
      phoneStatus: businesses.phoneStatus,
      phoneCalledAt: businesses.phoneCalledAt,
      phoneNotes: businesses.phoneNotes,
    })
    .from(businesses)
    .where(where.length ? sql.join(where, sql` AND `) : sql`true`)
    .orderBy(
      bucket === "open"
        ? sql`CASE ${businesses.websiteQuality}
            WHEN 'outdated' THEN 1
            WHEN 'decent' THEN 3
            WHEN 'good' THEN 4
            ELSE 2
          END ASC`
        : sql`${businesses.phoneCalledAt} DESC NULLS LAST`,
      sql`${businesses.googleRating} DESC NULLS LAST`,
      sql`${businesses.reviewsCount} DESC NULLS LAST`,
    )
    .limit(200);

  const leadRows: PhoneLeadRow[] = rows.map((r) => ({
    businessId: r.businessId,
    name: r.name,
    city: r.city,
    category: r.category,
    phone: r.phone,
    websiteUrl: r.websiteUrl,
    websiteQuality: r.websiteQuality,
    rating: r.rating != null ? Number(r.rating) : null,
    reviewsCount: r.reviewsCount,
    phoneStatus: (r.phoneStatus ?? null) as PhoneStatus | null,
    phoneCalledAt:
      r.phoneCalledAt instanceof Date
        ? r.phoneCalledAt.toISOString()
        : (r.phoneCalledAt as unknown as string | null),
    phoneNotes: r.phoneNotes,
  }));

  // Counts per bucket voor de tab-bar
  const counts = await getBucketCounts(db);

  return (
    <>
      <PageHeader
        title="Bellen"
        subtitle={subtitleFor(bucket, leadRows.length)}
      />

      <BucketTabs current={bucket} counts={counts} />
      <FilterBar params={params} bucket={bucket} />

      {leadRows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>{emptyMessageFor(bucket)}</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Business</th>
                <th style={thStyle}>Stad</th>
                <th style={thStyle}>Categorie</th>
                <th style={thStyle}>Telefoon</th>
                <th style={thStyle}>Website</th>
                <th style={thStyle}>Kwaliteit</th>
                <th style={thStyle}>Rating</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actie</th>
              </tr>
            </thead>
            <tbody>
              {leadRows.map((r) => (
                <PhoneRow key={r.businessId} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function getBucketCounts(
  db: ReturnType<typeof getDb>,
): Promise<Record<Bucket, number>> {
  const rows = await db
    .select({
      open: sql<number>`(SELECT count(*)::int FROM businesses b
        WHERE b.phone IS NOT NULL
          AND b.phone_status IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM campaign_leads cl
            INNER JOIN contacts ct ON ct.id = cl.contact_id
            WHERE ct.business_id = b.id AND cl.status IN ('queued','sent')
          )
          AND NOT EXISTS (
            SELECT 1 FROM contacts cc
            WHERE cc.business_id = b.id AND cc.do_not_contact = false
          ))`,
      followup: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_status IN ('voicemail','callback','called'))`,
      warm: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_status = 'interested')`,
      done: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_status IN ('not_interested','wrong_number'))`,
    })
    .from(sql`(SELECT 1) _t`);
  const r = rows[0]!;
  return {
    open: r.open,
    followup: r.followup,
    warm: r.warm,
    done: r.done,
    all: r.open + r.followup + r.warm + r.done,
  };
}

function subtitleFor(bucket: Bucket, n: number): string {
  if (bucket === "open") {
    return `${n} leads om nu te bellen. Slechte sites + hoogste rating bovenaan. Markeer met de status-knop rechts.`;
  }
  if (bucket === "followup") return `${n} leads in follow-up (voicemail / callback / generiek gebeld).`;
  if (bucket === "warm") return `${n} warme leads — interesse getoond. Tijd om af te sluiten.`;
  if (bucket === "done") return `${n} afgehandelde leads. Read-only audit.`;
  return `${n} leads totaal`;
}

function emptyMessageFor(bucket: Bucket): string {
  if (bucket === "open") return "Geen open leads — alles is gebeld of zit in een mail-campagne.";
  if (bucket === "followup") return "Geen leads in follow-up.";
  if (bucket === "warm") return "Geen warme leads (nog) — markeer een gesprek als 'interesse'.";
  if (bucket === "done") return "Nog niemand afgehandeld.";
  return "Geen leads gevonden.";
}

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "followup", label: "Follow-up" },
  { key: "warm", label: "Interesse" },
  { key: "done", label: "Afgehandeld" },
  { key: "all", label: "Alles" },
];

function BucketTabs({
  current,
  counts,
}: {
  current: Bucket;
  counts: Record<Bucket, number>;
}) {
  return (
    <div style={tabsStyle}>
      {BUCKETS.map((b) => {
        const active = b.key === current;
        return (
          <Link
            key={b.key}
            href={`/phone?bucket=${b.key}`}
            style={{
              ...tabStyle,
              ...(active ? tabActiveStyle : {}),
            }}
          >
            {b.label}
            <span style={tabCountStyle}>{counts[b.key]}</span>
          </Link>
        );
      })}
    </div>
  );
}

function FilterBar({
  params,
  bucket,
}: {
  params: SearchParams;
  bucket: Bucket;
}) {
  return (
    <form
      method="get"
      action="/phone"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        marginBottom: "1rem",
        alignItems: "center",
      }}
    >
      <input type="hidden" name="bucket" value={bucket} />
      <input
        type="text"
        name="niche"
        placeholder="Categorie"
        defaultValue={params.niche ?? ""}
        style={inputStyle}
      />
      <input
        type="text"
        name="city"
        placeholder="Stad"
        defaultValue={params.city ?? ""}
        style={inputStyle}
      />
      <button type="submit" style={btnStyle}>
        Filter
      </button>
      {params.niche || params.city ? (
        <Link
          href={`/phone?bucket=${bucket}`}
          style={{ color: "#7ab8ff", fontSize: "0.85rem" }}
        >
          Wis filter
        </Link>
      ) : null}
    </form>
  );
}

const tableWrapStyle = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  overflow: "auto" as const,
};

const tableStyle = { width: "100%", borderCollapse: "collapse" as const };

const thStyle = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #2a3140",
  textAlign: "left" as const,
  fontSize: "0.8rem",
  fontWeight: 600 as const,
  background: "#0f1218",
};

const tabsStyle = {
  display: "flex",
  gap: "0.35rem",
  marginBottom: "1rem",
  borderBottom: "1px solid #20252e",
  paddingBottom: "0.5rem",
  flexWrap: "wrap" as const,
};

const tabStyle = {
  padding: "0.45rem 0.85rem",
  borderRadius: "6px",
  color: "#c9cdd6",
  textDecoration: "none",
  fontSize: "0.85rem",
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  border: "1px solid transparent",
};

const tabActiveStyle = {
  background: "#1d4ed8",
  color: "white",
};

const tabCountStyle = {
  background: "rgba(255,255,255,0.15)",
  padding: "0.05rem 0.4rem",
  borderRadius: "999px",
  fontSize: "0.7rem",
  fontWeight: 600 as const,
};

const inputStyle = {
  padding: "0.45rem 0.65rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.85rem",
};

const btnStyle = {
  padding: "0.45rem 0.85rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.85rem",
  fontWeight: 500,
  cursor: "pointer",
};

