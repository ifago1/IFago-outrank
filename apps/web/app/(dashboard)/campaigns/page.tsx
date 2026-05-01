import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  campaignLeads,
  campaigns,
  emailsSent,
  getDb,
  sequenceSteps,
} from "@outreach/db";
import { PageHeader, Pill, Table } from "../_ui";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const db = getDb();
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      niche: campaigns.niche,
      status: campaigns.status,
      createdAt: campaigns.createdAt,
      stepCount: sql<number>`(SELECT count(*)::int FROM ${sequenceSteps} WHERE ${sequenceSteps.campaignId} = ${campaigns.id})`,
      leadCount: sql<number>`(SELECT count(*)::int FROM ${campaignLeads} WHERE ${campaignLeads.campaignId} = ${campaigns.id})`,
      sentCount: sql<number>`(
        SELECT count(*)::int FROM ${emailsSent}
        INNER JOIN ${campaignLeads} ON ${campaignLeads.id} = ${emailsSent.campaignLeadId}
        WHERE ${campaignLeads.campaignId} = ${campaigns.id}
      )`,
      repliedCount: sql<number>`(
        SELECT count(*)::int FROM ${campaignLeads}
        WHERE ${campaignLeads.campaignId} = ${campaigns.id} AND ${campaignLeads.status} = 'replied'
      )`,
    })
    .from(campaigns)
    .orderBy(sql`${campaigns.createdAt} DESC`);

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Outreach sequences"
        actions={
          <code style={{ fontSize: "0.8rem", opacity: 0.7 }}>
            pnpm seed-campaign --name=&quot;...&quot;
          </code>
        }
      />
      <Table
        columns={["Name", "Niche", "Status", "Steps", "Leads", "Sent", "Replied"]}
        rows={rows.map((c) => [
          <Link
            key="n"
            href={`/campaigns/${c.id}`}
            style={{ color: "#7ab8ff" }}
          >
            {c.name}
          </Link>,
          c.niche ?? "—",
          <Pill key="s" tone={statusTone(c.status)}>{c.status}</Pill>,
          c.stepCount,
          c.leadCount,
          c.sentCount,
          c.repliedCount > 0 ? <Pill key="r" tone="ok">{c.repliedCount}</Pill> : c.repliedCount,
        ])}
        empty="Nog geen campagnes — run `pnpm seed-campaign --name=...`."
      />
    </>
  );
}

function statusTone(status: string): "ok" | "neutral" | "warn" {
  if (status === "active") return "ok";
  if (status === "paused") return "warn";
  return "neutral";
}
