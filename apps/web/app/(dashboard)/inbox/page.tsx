import { desc, eq, or } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  getDb,
} from "@outreach/db";
import { PageHeader, Pill, Table } from "../_ui";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const db = getDb();

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
    })
    .from(campaignLeads)
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(
      or(
        eq(campaignLeads.status, "replied"),
        eq(campaignLeads.status, "bounced"),
      ),
    )
    .orderBy(desc(campaignLeads.lastEventAt))
    .limit(100);

  const replied = rows.filter((r) => r.status === "replied");
  const bounced = rows.filter((r) => r.status === "bounced");

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={`${replied.length} replies · ${bounced.length} bounces (latest 100)`}
      />
      <Table
        columns={["When", "Status", "Email", "Business", "Campaign", "After step"]}
        rows={rows.map((r) => [
          new Date(r.lastEventAt).toLocaleString("nl-NL"),
          <Pill key="s" tone={r.status === "replied" ? "ok" : "bad"}>
            {r.status}
          </Pill>,
          `${r.firstName ? r.firstName + " — " : ""}${r.email}`,
          r.businessName,
          r.campaignName,
          r.currentStep,
        ])}
        empty="Geen replies of bounces (yet)."
      />
    </>
  );
}
