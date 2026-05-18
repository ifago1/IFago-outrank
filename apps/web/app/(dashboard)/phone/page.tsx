import { eq, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { businesses, getDb } from "@outreach/db";
import { PageHeader, Pill } from "../_ui";

export const dynamic = "force-dynamic";

interface SearchParams {
  niche?: string;
  city?: string;
  status?: "any" | "no_website" | "outdated" | "decent" | "good";
}

/**
 * "Bellen"-tab: leads die telefonisch interessant zijn.
 *
 * Definitie:
 *  - Telefoonnummer beschikbaar
 *  - Geen bruikbaar e-mail-contact (geen contacts of allemaal DNC)
 *  - Niet al in een actieve campagne
 *
 * Sortering: slechte sites eerst (outdated > decent > good > onbekend),
 * binnen kwaliteit op rating-descending zodat hoog-gewaardeerde leads
 * met slechte site bovenaan komen — die hebben het meeste te winnen.
 */
export default async function PhonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const db = getDb();

  const where: SQL[] = [
    isNotNull(businesses.phone),
    // Geen non-DNC contacts
    sql`NOT EXISTS (
      SELECT 1 FROM contacts cc
      WHERE cc.business_id = businesses.id
        AND cc.do_not_contact = false
    )`,
    // Niet in een actieve campagne
    sql`NOT EXISTS (
      SELECT 1 FROM campaign_leads cl
      INNER JOIN contacts ct ON ct.id = cl.contact_id
      WHERE ct.business_id = businesses.id
        AND cl.status IN ('queued', 'sent')
    )`,
  ];
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
      phone: businesses.phone,
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
      rating: businesses.googleRating,
      reviewsCount: businesses.reviewsCount,
    })
    .from(businesses)
    .where(sql.join(where, sql` AND `))
    .orderBy(
      // Outdated/none first (highest pitch potential), then decent, then good
      sql`CASE ${businesses.websiteQuality}
        WHEN 'outdated' THEN 1
        WHEN 'decent' THEN 3
        WHEN 'good' THEN 4
        ELSE 2
      END ASC`,
      sql`${businesses.googleRating} DESC NULLS LAST`,
      sql`${businesses.reviewsCount} DESC NULLS LAST`,
    )
    .limit(150);

  return (
    <>
      <PageHeader
        title="Bellen"
        subtitle={`${rows.length} leads zonder e-mail-route maar mét telefoonnummer. Slechte sites + hoogste rating bovenaan.`}
      />

      <FilterBar params={params} />

      {rows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          Geen leads die aan de criteria voldoen — alle leads met telefoonnummer
          hebben al e-mail-contact of zitten in een campagne.
        </p>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.businessId}>
                  <td style={tdStyle}>
                    <Link
                      href={`/leads/${r.businessId}`}
                      style={{ color: "#7ab8ff", textDecoration: "none" }}
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td style={tdStyle}>{r.city ?? "—"}</td>
                  <td style={tdStyle}>{r.category ?? "—"}</td>
                  <td style={tdStyle}>
                    {r.phone ? (
                      <a
                        href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
                        style={{
                          color: "#7be0a6",
                          textDecoration: "none",
                          fontFamily: "monospace",
                        }}
                      >
                        {r.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.websiteUrl ? (
                      <a
                        href={r.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#7ab8ff", fontSize: "0.85rem" }}
                      >
                        bekijken
                      </a>
                    ) : (
                      <span style={{ opacity: 0.5 }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {qualityPill(r.websiteUrl, r.websiteQuality)}
                  </td>
                  <td style={tdStyle}>
                    {r.rating != null
                      ? `${Number(r.rating).toFixed(1)} (${r.reviewsCount ?? 0})`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function qualityPill(websiteUrl: string | null, quality: string | null) {
  if (!websiteUrl) return <Pill tone="bad">geen site</Pill>;
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
      action="/phone"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        marginBottom: "1rem",
        alignItems: "center",
      }}
    >
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
      <select
        name="status"
        defaultValue={params.status ?? "any"}
        style={inputStyle}
      >
        <option value="any">Alle kwaliteit</option>
        <option value="no_website">Geen website</option>
        <option value="outdated">Verouderd</option>
        <option value="decent">Decent</option>
        <option value="good">Goed</option>
      </select>
      <button type="submit" style={btnStyle}>
        Filter
      </button>
      {params.niche || params.city || params.status ? (
        <Link href="/phone" style={{ color: "#7ab8ff", fontSize: "0.85rem" }}>
          Wis
        </Link>
      ) : null}
    </form>
  );
}

const tableWrapStyle = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  overflow: "hidden",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const thStyle = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #2a3140",
  textAlign: "left" as const,
  fontSize: "0.8rem",
  fontWeight: 600 as const,
  background: "#0f1218",
  position: "sticky" as const,
  top: 0,
};

const tdStyle = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #20252e",
  fontSize: "0.9rem",
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
