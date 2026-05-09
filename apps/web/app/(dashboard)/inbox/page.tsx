import { desc, eq, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  getDb,
} from "@outreach/db";
import { PageHeader, Pill, Table } from "../_ui";

export const dynamic = "force-dynamic";

type FilterMode = "all" | "replied" | "bounced" | "positive" | "needs_action";

interface SearchParams {
  filter?: FilterMode;
}

const FILTERS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "Alles" },
  { key: "replied", label: "Replies" },
  { key: "bounced", label: "Bounces" },
  { key: "positive", label: "Positief" },
  { key: "needs_action", label: "Vraagt actie" },
];

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filter: FilterMode = params.filter ?? "all";
  const db = getDb();

  const where: SQL = (() => {
    switch (filter) {
      case "replied":
        return eq(campaignLeads.status, "replied");
      case "bounced":
        return eq(campaignLeads.status, "bounced");
      case "positive":
        return eq(campaignLeads.replyClassification, "positive");
      case "needs_action":
        return or(
          eq(campaignLeads.replyClassification, "positive"),
          eq(campaignLeads.replyClassification, "question"),
        )!;
      default:
        return or(
          eq(campaignLeads.status, "replied"),
          eq(campaignLeads.status, "bounced"),
        )!;
    }
  })();

  const rows = await db
    .select({
      id: campaignLeads.id,
      status: campaignLeads.status,
      lastEventAt: campaignLeads.lastEventAt,
      currentStep: campaignLeads.currentStep,
      email: contacts.email,
      firstName: contacts.firstName,
      businessName: businesses.name,
      campaignName: campaigns.name,
      classification: campaignLeads.replyClassification,
      summary: campaignLeads.replySummary,
    })
    .from(campaignLeads)
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(where)
    .orderBy(desc(campaignLeads.lastEventAt))
    .limit(200);

  const replied = rows.filter((r) => r.status === "replied").length;
  const bounced = rows.filter((r) => r.status === "bounced").length;
  const positive = rows.filter(
    (r) => r.classification === "positive",
  ).length;

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={`${replied} replies · ${bounced} bounces · ${positive} positief (laatste 200)`}
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
            href={f.key === "all" ? "/inbox" : `/inbox?filter=${f.key}`}
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

      <Table
        columns={["When", "Status", "Triage", "Summary", "Email", "Business", "Campaign"]}
        rows={rows.map((r) => [
          new Date(r.lastEventAt).toLocaleString("nl-NL"),
          <Pill key="s" tone={r.status === "replied" ? "ok" : "bad"}>
            {r.status}
          </Pill>,
          r.classification ? (
            <Pill key="c" tone={triageTone(r.classification)}>
              {r.classification}
            </Pill>
          ) : (
            "—"
          ),
          <span
            key="sum"
            title={r.summary ?? ""}
            style={{
              opacity: 0.85,
              maxWidth: "20rem",
              display: "inline-block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              verticalAlign: "middle",
            }}
          >
            {r.summary ?? "—"}
          </span>,
          `${r.firstName ? r.firstName + " — " : ""}${r.email}`,
          r.businessName,
          r.campaignName,
        ])}
        empty={
          filter === "all"
            ? "Geen replies of bounces (yet)."
            : `Geen items met filter "${filter}".`
        }
      />
    </>
  );
}

function triageTone(
  classification: string,
): "ok" | "warn" | "bad" | "neutral" {
  switch (classification) {
    case "positive":
    case "referral":
      return "ok";
    case "question":
      return "warn";
    case "negative":
      return "bad";
    case "out_of_office":
    case "unknown":
    default:
      return "neutral";
  }
}
