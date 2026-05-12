import { desc, eq } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  getDb,
} from "@outreach/db";
import { PageHeader, Pill, Table } from "../_ui";

export const dynamic = "force-dynamic";

export default async function SentPage() {
  const db = getDb();

  const rows = await db
    .select({
      sentAt: emailsSent.sentAt,
      stepOrder: emailsSent.stepOrder,
      subject: emailsSent.subject,
      bounced: emailsSent.bounced,
      repliedAt: emailsSent.repliedAt,
      openedAt: emailsSent.openedAt,
      email: contacts.email,
      firstName: contacts.firstName,
      businessName: businesses.name,
      businessId: businesses.id,
      campaignName: campaigns.name,
    })
    .from(emailsSent)
    .innerJoin(campaignLeads, eq(campaignLeads.id, emailsSent.campaignLeadId))
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .orderBy(desc(emailsSent.sentAt))
    .limit(100);

  return (
    <>
      <PageHeader
        title="Sent"
        subtitle={`Laatste ${rows.length} verzonden mails (nieuwste eerst)`}
      />
      <Table
        columns={[
          "Verzonden",
          "Step",
          "Status",
          "Recipient",
          "Business",
          "Campaign",
          "Subject",
        ]}
        rows={rows.map((r) => [
          new Date(r.sentAt).toLocaleString("nl-NL", {
            timeZone: "Europe/Amsterdam",
          }),
          `#${r.stepOrder}`,
          <StatusPill
            key="s"
            bounced={r.bounced}
            repliedAt={r.repliedAt}
            openedAt={r.openedAt}
          />,
          `${r.firstName ? r.firstName + " — " : ""}${r.email}`,
          <a
            key="b"
            href={`/leads/${r.businessId}`}
            style={{ color: "#7aa7ff", textDecoration: "none" }}
          >
            {r.businessName}
          </a>,
          r.campaignName,
          r.subject,
        ])}
        empty="Nog niks verstuurd."
      />
    </>
  );
}

function StatusPill({
  bounced,
  repliedAt,
  openedAt,
}: {
  bounced: boolean;
  repliedAt: Date | null;
  openedAt: Date | null;
}) {
  if (bounced) return <Pill tone="bad">bounced</Pill>;
  if (repliedAt) return <Pill tone="ok">replied</Pill>;
  if (openedAt) return <Pill tone="warn">opened</Pill>;
  return <Pill tone="neutral">sent</Pill>;
}
