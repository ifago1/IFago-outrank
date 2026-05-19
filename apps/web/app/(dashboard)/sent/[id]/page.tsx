import { eq } from "drizzle-orm";
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

export const dynamic = "force-dynamic";

export default async function SentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const rows = await db
    .select({
      id: emailsSent.id,
      sentAt: emailsSent.sentAt,
      stepOrder: emailsSent.stepOrder,
      subject: emailsSent.subject,
      body: emailsSent.body,
      bounced: emailsSent.bounced,
      openedAt: emailsSent.openedAt,
      repliedAt: emailsSent.repliedAt,
      messageId: emailsSent.messageId,
      aiGenerated: emailsSent.aiGenerated,
      email: contacts.email,
      firstName: contacts.firstName,
      businessId: businesses.id,
      businessName: businesses.name,
      campaignName: campaigns.name,
    })
    .from(emailsSent)
    .innerJoin(campaignLeads, eq(campaignLeads.id, emailsSent.campaignLeadId))
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(eq(emailsSent.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  const status: { label: string; tone: "neutral" | "ok" | "warn" | "bad" } =
    row.bounced
      ? { label: "bounced", tone: "bad" }
      : row.repliedAt
        ? { label: "replied", tone: "ok" }
        : row.openedAt
          ? { label: "opened", tone: "warn" }
          : { label: "sent", tone: "neutral" };

  return (
    <>
      <PageHeader
        title={row.subject}
        subtitle={`Step #${row.stepOrder} · ${row.campaignName}`}
        actions={
          <Link href="/sent" style={{ color: "#7ab8ff", fontSize: "0.85rem" }}>
            ← Terug naar Sent
          </Link>
        }
      />

      <section style={metaStyle}>
        <dl style={dlStyle}>
          <dt style={dtStyle}>Verzonden</dt>
          <dd style={ddStyle}>
            {new Date(row.sentAt).toLocaleString("nl-NL", {
              timeZone: "Europe/Amsterdam",
            })}
          </dd>

          <dt style={dtStyle}>Status</dt>
          <dd style={ddStyle}>
            <Pill tone={status.tone}>{status.label}</Pill>
            {row.openedAt ? (
              <span style={{ opacity: 0.65, fontSize: "0.8rem", marginLeft: "0.5rem" }}>
                geopend {new Date(row.openedAt).toLocaleString("nl-NL", {
                  timeZone: "Europe/Amsterdam",
                })}
              </span>
            ) : null}
            {row.repliedAt ? (
              <span style={{ opacity: 0.65, fontSize: "0.8rem", marginLeft: "0.5rem" }}>
                reply {new Date(row.repliedAt).toLocaleString("nl-NL", {
                  timeZone: "Europe/Amsterdam",
                })}
              </span>
            ) : null}
          </dd>

          <dt style={dtStyle}>Recipient</dt>
          <dd style={ddStyle}>
            {row.firstName ? `${row.firstName} — ` : ""}
            <a href={`mailto:${row.email}`} style={{ color: "#7ab8ff" }}>
              {row.email}
            </a>
          </dd>

          <dt style={dtStyle}>Business</dt>
          <dd style={ddStyle}>
            <Link
              href={`/leads/${row.businessId}`}
              style={{ color: "#7ab8ff", textDecoration: "none" }}
            >
              {row.businessName}
            </Link>
          </dd>

          <dt style={dtStyle}>Campagne</dt>
          <dd style={ddStyle}>{row.campaignName}</dd>

          <dt style={dtStyle}>Bron</dt>
          <dd style={ddStyle}>
            {row.aiGenerated ? (
              <Pill tone="ok">AI-geschreven</Pill>
            ) : (
              <Pill>sequence-template</Pill>
            )}
          </dd>

          {row.messageId ? (
            <>
              <dt style={dtStyle}>Message-ID</dt>
              <dd
                style={{
                  ...ddStyle,
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  opacity: 0.6,
                  wordBreak: "break-all",
                }}
              >
                {row.messageId}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section style={bodySectionStyle}>
        <div style={subjectStyle}>
          <span style={{ opacity: 0.55 }}>Subject:</span> {row.subject}
        </div>
        <pre style={bodyStyle}>{row.body}</pre>
      </section>
    </>
  );
}

const metaStyle = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "#0f1218",
};

const bodySectionStyle = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1.25rem 1.5rem",
  background: "#0a0c11",
};

const subjectStyle = {
  fontSize: "0.95rem",
  fontWeight: 600 as const,
  marginBottom: "1rem",
  paddingBottom: "0.75rem",
  borderBottom: "1px solid #20252e",
};

const bodyStyle = {
  margin: 0,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  fontFamily: "inherit",
  fontSize: "0.9rem",
  lineHeight: 1.55,
  color: "#d4d8e0",
};

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

const ddStyle = { margin: 0 };
