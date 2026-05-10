import { desc, eq, type SQL } from "drizzle-orm";
import Link from "next/link";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  getDb,
} from "@outreach/db";
import { PageHeader, Pill } from "../_ui";

export const dynamic = "force-dynamic";

type FilterMode = "all" | "step1" | "step2" | "step3" | "bounced";

interface SearchParams {
  filter?: FilterMode;
  /** When set, expand this specific message id by default. */
  expand?: string;
}

const FILTERS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "Alles" },
  { key: "step1", label: "Step 1" },
  { key: "step2", label: "Step 2" },
  { key: "step3", label: "Step 3" },
  { key: "bounced", label: "Bounced" },
];

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filter: FilterMode = params.filter ?? "all";
  const expandId = params.expand ?? null;
  const db = getDb();

  let where: SQL | undefined;
  switch (filter) {
    case "step1":
      where = eq(emailsSent.stepOrder, 1);
      break;
    case "step2":
      where = eq(emailsSent.stepOrder, 2);
      break;
    case "step3":
      where = eq(emailsSent.stepOrder, 3);
      break;
    case "bounced":
      where = eq(emailsSent.bounced, true);
      break;
    case "all":
    default:
      where = undefined;
  }

  const rows = await db
    .select({
      id: emailsSent.id,
      sentAt: emailsSent.sentAt,
      subject: emailsSent.subject,
      body: emailsSent.body,
      stepOrder: emailsSent.stepOrder,
      bounced: emailsSent.bounced,
      messageId: emailsSent.messageId,
      email: contacts.email,
      firstName: contacts.firstName,
      businessName: businesses.name,
      campaignName: campaigns.name,
      leadStatus: campaignLeads.status,
    })
    .from(emailsSent)
    .innerJoin(
      campaignLeads,
      eq(campaignLeads.id, emailsSent.campaignLeadId),
    )
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(where)
    .orderBy(desc(emailsSent.sentAt))
    .limit(200);

  const totalCount = rows.length;
  const bouncedCount = rows.filter((r) => r.bounced).length;
  const repliedCount = rows.filter((r) => r.leadStatus === "replied").length;

  return (
    <>
      <PageHeader
        title="Verzonden mails"
        subtitle={`${totalCount} mails (laatste 200) · ${repliedCount} replies · ${bouncedCount} bounces`}
      />

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/sent" : `/sent?filter=${f.key}`}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: "999px",
              border: "1px solid #20252e",
              fontSize: "0.85rem",
              textDecoration: "none",
              color: filter === f.key ? "#0f1218" : "#c9cdd6",
              background: filter === f.key ? "#7be0a6" : "#0f1218",
              fontWeight: filter === f.key ? 600 : 400,
            }}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>Geen verzonden mails (yet).</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {rows.map((r) => (
            <details
              key={r.id}
              open={expandId === r.id}
              style={{
                border: "1px solid #20252e",
                borderRadius: "8px",
                background: "#0f1218",
                overflow: "hidden",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  padding: "0.85rem 1rem",
                  listStyle: "none",
                  display: "grid",
                  gridTemplateColumns: "10rem 1fr auto auto",
                  gap: "1rem",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: "0.85rem", opacity: 0.65 }}>
                  {new Date(r.sentAt).toLocaleString("nl-NL", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span>
                  <strong style={{ fontWeight: 600 }}>{r.subject}</strong>
                  <br />
                  <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>
                    {r.firstName ? `${r.firstName} — ` : ""}
                    {r.email} · {r.businessName} · {r.campaignName}
                  </span>
                </span>
                <Pill tone="neutral">step {r.stepOrder}</Pill>
                {r.bounced ? (
                  <Pill tone="bad">bounced</Pill>
                ) : r.leadStatus === "replied" ? (
                  <Pill tone="ok">replied</Pill>
                ) : (
                  <Pill tone="neutral">sent</Pill>
                )}
              </summary>

              <div
                style={{
                  borderTop: "1px solid #20252e",
                  padding: "1rem 1.25rem",
                  background: "#1c2129",
                }}
              >
                <div
                  style={{
                    fontSize: "0.78rem",
                    opacity: 0.55,
                    marginBottom: "0.75rem",
                    fontFamily: "monospace",
                  }}
                >
                  Message-ID: {r.messageId ?? "(geen)"}
                </div>
                <pre
                  style={{
                    fontFamily:
                      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                    fontSize: "0.92rem",
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    color: "#e6e8ee",
                  }}
                >
                  {r.body}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
