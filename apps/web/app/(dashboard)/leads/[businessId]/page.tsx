import { asc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  getDb,
} from "@outreach/db";
import { PageHeader, Pill } from "../../_ui";
import { LeadDetailClient, type ContactView, type CampaignMembership } from "./lead-detail-client";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const db = getDb();

  const bRows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const business = bRows[0];
  if (!business) notFound();

  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.businessId, businessId))
    .orderBy(asc(contacts.createdAt));

  const contactViews: ContactView[] = contactRows.map((c) => ({
    id: c.id,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    source: c.source,
    isVerified: c.isVerified,
    doNotContact: c.doNotContact,
    createdAt:
      c.createdAt instanceof Date
        ? c.createdAt.toISOString()
        : (c.createdAt as unknown as string),
  }));

  // Welke campagnes zitten contacts van deze business al in?
  const memberships = contactRows.length
    ? await db
        .select({
          campaignId: campaigns.id,
          campaignName: campaigns.name,
          campaignStatus: campaigns.status,
          contactId: campaignLeads.contactId,
          contactEmail: contacts.email,
          status: campaignLeads.status,
          currentStep: campaignLeads.currentStep,
          nextSendAt: campaignLeads.nextSendAt,
          sentCount: sql<number>`(
            SELECT count(*)::int FROM emails_sent
            WHERE emails_sent.campaign_lead_id = ${campaignLeads.id}
          )`,
        })
        .from(campaignLeads)
        .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
        .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
        .where(eq(contacts.businessId, businessId))
        .orderBy(asc(campaigns.name))
    : [];

  const membershipViews: CampaignMembership[] = memberships.map((m) => ({
    campaignId: m.campaignId,
    campaignName: m.campaignName,
    campaignStatus: m.campaignStatus,
    contactId: m.contactId,
    contactEmail: m.contactEmail,
    status: m.status,
    currentStep: m.currentStep,
    nextSendAt:
      m.nextSendAt instanceof Date
        ? m.nextSendAt.toISOString()
        : (m.nextSendAt as unknown as string | null),
    sentCount: m.sentCount,
  }));

  const lastSent = contactRows.length
    ? await db
        .select({
          sentAt: emailsSent.sentAt,
          subject: emailsSent.subject,
          bounced: emailsSent.bounced,
          openedAt: emailsSent.openedAt,
          repliedAt: emailsSent.repliedAt,
          stepOrder: emailsSent.stepOrder,
          contactEmail: contacts.email,
        })
        .from(emailsSent)
        .innerJoin(
          campaignLeads,
          eq(campaignLeads.id, emailsSent.campaignLeadId),
        )
        .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
        .where(eq(contacts.businessId, businessId))
        .orderBy(sql`${emailsSent.sentAt} DESC`)
        .limit(10)
    : [];

  return (
    <>
      <PageHeader
        title={business.name}
        subtitle={[
          business.category,
          business.city,
          business.country,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link
            href="/leads"
            style={{ color: "#7ab8ff", fontSize: "0.85rem" }}
          >
            ← Terug naar leads
          </Link>
        }
      />

      <BusinessFacts
        websiteUrl={business.websiteUrl}
        websiteQuality={business.websiteQuality}
        rating={business.googleRating}
        reviewsCount={business.reviewsCount}
        phone={business.phone}
        placeId={business.placeId}
        personalObservation={business.personalObservation}
        observationSource={business.personalObservationSource}
      />

      <LeadDetailClient
        businessId={businessId}
        contacts={contactViews}
        memberships={membershipViews}
      />

      {lastSent.length > 0 ? (
        <section style={sectionStyle}>
          <h2 style={h2Style}>Verzendgeschiedenis ({lastSent.length})</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Wanneer</th>
                <th style={thStyle}>Step</th>
                <th style={thStyle}>Naar</th>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {lastSent.map((s, i) => (
                <tr key={i}>
                  <td style={tdStyle}>
                    {s.sentAt instanceof Date
                      ? s.sentAt.toLocaleString("nl-NL")
                      : String(s.sentAt)}
                  </td>
                  <td style={tdStyle}>{s.stepOrder}</td>
                  <td style={tdStyle}>{s.contactEmail}</td>
                  <td style={tdStyle}>{s.subject}</td>
                  <td style={tdStyle}>
                    {s.bounced ? (
                      <Pill tone="bad">bounced</Pill>
                    ) : s.repliedAt ? (
                      <Pill tone="ok">replied</Pill>
                    ) : s.openedAt ? (
                      <Pill tone="warn">opened</Pill>
                    ) : (
                      <Pill>sent</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

function BusinessFacts({
  websiteUrl,
  websiteQuality,
  rating,
  reviewsCount,
  phone,
  placeId,
  personalObservation,
  observationSource,
}: {
  websiteUrl: string | null;
  websiteQuality: string | null;
  rating: string | number | null;
  reviewsCount: number | null;
  phone: string | null;
  placeId: string;
  personalObservation: string | null;
  observationSource: string | null;
}) {
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Business info</h2>
      <dl style={dlStyle}>
        <dt style={dtStyle}>Website</dt>
        <dd style={ddStyle}>
          {websiteUrl ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#7ab8ff" }}
            >
              {websiteUrl}
            </a>
          ) : (
            <Pill tone="warn">geen website (top-prio lead)</Pill>
          )}
        </dd>

        <dt style={dtStyle}>Kwaliteit</dt>
        <dd style={ddStyle}>{qualityLabel(websiteUrl, websiteQuality)}</dd>

        <dt style={dtStyle}>Google rating</dt>
        <dd style={ddStyle}>
          {rating != null
            ? `${Number(rating).toFixed(1)} (${reviewsCount ?? 0} reviews)`
            : "—"}
        </dd>

        <dt style={dtStyle}>Telefoon</dt>
        <dd style={ddStyle}>{phone ?? "—"}</dd>

        <dt style={dtStyle}>Google Place ID</dt>
        <dd style={{ ...ddStyle, fontFamily: "monospace", fontSize: "0.8rem", opacity: 0.7 }}>
          {placeId}
        </dd>

        {personalObservation ? (
          <>
            <dt style={dtStyle}>Personal observation</dt>
            <dd style={ddStyle}>
              <em>&ldquo;{personalObservation}&rdquo;</em>
              {observationSource ? (
                <span style={{ opacity: 0.55, fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                  ({observationSource})
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function qualityLabel(websiteUrl: string | null, quality: string | null) {
  if (!websiteUrl) return <Pill tone="bad">geen site</Pill>;
  if (!quality || quality === "none")
    return <span style={{ opacity: 0.6 }}>nog niet gescand</span>;
  if (quality === "good") return <Pill tone="ok">goed</Pill>;
  if (quality === "decent") return <Pill tone="warn">decent</Pill>;
  if (quality === "outdated") return <Pill tone="bad">verouderd</Pill>;
  return <Pill>{quality}</Pill>;
}

const sectionStyle = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "#0f1218",
};

const h2Style = { fontSize: "1.05rem", margin: "0 0 0.75rem 0" };

const dlStyle = {
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "0.5rem 1rem",
  margin: 0,
  fontSize: "0.9rem",
};

const dtStyle = {
  opacity: 0.65,
  fontWeight: 500 as const,
};

const ddStyle = {
  margin: 0,
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const thStyle = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #2a3140",
  textAlign: "left" as const,
  fontSize: "0.8rem",
  fontWeight: 600 as const,
  background: "#0a0c11",
};

const tdStyle = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #20252e",
  fontSize: "0.85rem",
};
