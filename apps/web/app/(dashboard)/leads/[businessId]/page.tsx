import { asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  getDb,
  leadEvents,
} from "@outreach/db";
import { PageHeader, Pill } from "../../_ui";
import { LeadDetailClient, type ContactView, type CampaignMembership } from "./lead-detail-client";
import { AuditPanel, type AuditDetailView } from "./audit-panel";
import { ResearchPanel, type PlacesSocialUrls } from "./research-panel";
import { Timeline, type TimelineEventView } from "./timeline";

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

  const eventRows = await db
    .select()
    .from(leadEvents)
    .where(eq(leadEvents.businessId, businessId))
    .orderBy(desc(leadEvents.occurredAt))
    .limit(50);

  const timelineEvents: TimelineEventView[] = eventRows.map((e) => ({
    id: e.id,
    type: e.type,
    source: e.source,
    occurredAt:
      e.occurredAt instanceof Date
        ? e.occurredAt.toISOString()
        : (e.occurredAt as unknown as string),
    payload: (e.payload as Record<string, unknown> | null) ?? null,
  }));

  // Sent-mails altijd ophalen — ook businesses zonder contacts of
  // zonder verzonden mails krijgen de sectie te zien, met een lege-
  // staat-melding. Dat maakt direct zichtbaar dat er (nog) niks is
  // verzonden i.p.v. de sectie stilletjes te verbergen.
  const lastSent = await db
    .select({
      id: emailsSent.id,
      sentAt: emailsSent.sentAt,
      subject: emailsSent.subject,
      bounced: emailsSent.bounced,
      openedAt: emailsSent.openedAt,
      repliedAt: emailsSent.repliedAt,
      stepOrder: emailsSent.stepOrder,
      aiGenerated: emailsSent.aiGenerated,
      contactEmail: contacts.email,
      campaignName: campaigns.name,
    })
    .from(emailsSent)
    .innerJoin(
      campaignLeads,
      eq(campaignLeads.id, emailsSent.campaignLeadId),
    )
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(eq(contacts.businessId, businessId))
    .orderBy(desc(emailsSent.sentAt))
    .limit(50);

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

      <AuditPanel
        businessId={businessId}
        websiteUrl={business.websiteUrl}
        auditDetail={
          (business.auditDetail as AuditDetailView | null) ?? null
        }
        auditedAt={
          business.auditedAt instanceof Date
            ? business.auditedAt.toISOString()
            : (business.auditedAt as unknown as string | null)
        }
      />

      <LeadDetailClient
        businessId={businessId}
        contacts={contactViews}
        memberships={membershipViews}
      />

      <ResearchPanel
        businessId={businessId}
        businessName={business.name}
        city={business.city}
        phone={business.phone}
        social={extractSocialUrls(business.rawPlacesData)}
      />

      <Timeline events={timelineEvents} />

      <section style={sectionStyle}>
        <h2 style={h2Style}>Verzendgeschiedenis ({lastSent.length})</h2>
        {lastSent.length === 0 ? (
          <p style={{ opacity: 0.55, fontSize: "0.85rem", margin: 0 }}>
            Nog geen mails verstuurd naar deze lead.
            {contactRows.length === 0
              ? " (Geen contacten op deze business gevonden — voeg er één toe via Discover of importeer 'm.)"
              : ""}
          </p>
        ) : (
          <>
            <p style={{ opacity: 0.55, fontSize: "0.8rem", margin: "0 0 0.75rem 0" }}>
              Klik op het onderwerp om de volledige inhoud te bekijken.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Wanneer</th>
                  <th style={thStyle}>Step</th>
                  <th style={thStyle}>Campagne</th>
                  <th style={thStyle}>Naar</th>
                  <th style={thStyle}>Onderwerp</th>
                  <th style={thStyle}>Bron</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {lastSent.map((s) => (
                  <tr key={s.id}>
                    <td style={tdStyle}>
                      {s.sentAt instanceof Date
                        ? s.sentAt.toLocaleString("nl-NL", {
                            timeZone: "Europe/Amsterdam",
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : String(s.sentAt)}
                    </td>
                    <td style={tdStyle}>#{s.stepOrder}</td>
                    <td style={tdStyle}>{s.campaignName}</td>
                    <td style={tdStyle}>{s.contactEmail}</td>
                    <td style={tdStyle}>
                      <Link
                        href={`/sent/${s.id}`}
                        style={{ color: "#7ab8ff", textDecoration: "none" }}
                      >
                        {s.subject}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      {s.aiGenerated ? (
                        <Pill tone="ok">AI</Pill>
                      ) : (
                        <Pill>template</Pill>
                      )}
                    </td>
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
          </>
        )}
      </section>
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

/**
 * Lokale ondernemers zetten regelmatig een Facebook/Instagram-URL als
 * "website" in hun Google Business profile. Detect dat zodat we die
 * URL als directe research-shortcut kunnen tonen op de detailpagina.
 *
 * Daarnaast bouwen we een google-maps-link op basis van place_id zodat
 * de gebruiker direct het GBP-profiel kan openen om bv. de "send
 * message"-knop te gebruiken of foto's te bekijken voor een
 * personal-observation.
 */
function extractSocialUrls(
  rawPlacesData: unknown,
): PlacesSocialUrls {
  const out: PlacesSocialUrls = {};
  const raw = rawPlacesData as
    | {
        websiteUri?: string;
        googleMapsUri?: string;
        id?: string;
      }
    | null
    | undefined;

  const url = raw?.websiteUri;
  if (url) {
    if (/facebook\.com\//i.test(url)) out.facebook = url;
    else if (/instagram\.com\//i.test(url)) out.instagram = url;
    else if (
      /linkedin\.com\/|tiktok\.com\/|twitter\.com\/|x\.com\//i.test(url)
    ) {
      out.generic = url;
    }
  }

  if (raw?.googleMapsUri) {
    out.googleMapsUri = raw.googleMapsUri;
  }
  return out;
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
