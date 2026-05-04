import { sql } from "drizzle-orm";
import {
  campaigns,
  getDb,
} from "@outreach/db";
import { PageHeader } from "../_ui";
import { CampaignsClient } from "./campaigns-client";

export const dynamic = "force-dynamic";

export interface CampaignRow {
  id: string;
  name: string;
  niche: string | null;
  status: string;
  stepCount: number;
  leadCount: number;
  sentCount: number;
  repliedCount: number;
  createdAt: string;
}

export default async function CampaignsPage() {
  const db = getDb();
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      niche: campaigns.niche,
      status: campaigns.status,
      createdAt: campaigns.createdAt,
      stepCount: sql<number>`(SELECT count(*)::int FROM sequence_steps ss WHERE ss.campaign_id = campaigns.id)`,
      leadCount: sql<number>`(SELECT count(*)::int FROM campaign_leads cl WHERE cl.campaign_id = campaigns.id)`,
      sentCount: sql<number>`(
        SELECT count(*)::int FROM emails_sent es
        INNER JOIN campaign_leads cl ON cl.id = es.campaign_lead_id
        WHERE cl.campaign_id = campaigns.id
      )`,
      repliedCount: sql<number>`(
        SELECT count(*)::int FROM campaign_leads cl
        WHERE cl.campaign_id = campaigns.id AND cl.status = 'replied'
      )`,
    })
    .from(campaigns)
    .orderBy(sql`${campaigns.createdAt} DESC`);

  const campaignRows: CampaignRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    niche: r.niche,
    status: r.status,
    stepCount: r.stepCount,
    leadCount: r.leadCount,
    sentCount: r.sentCount,
    repliedCount: r.repliedCount,
    createdAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : (r.createdAt as unknown as string),
  }));

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Een campagne bevat een 3-step e-mail sequence + de leads die hem doorlopen. Pauze/activeer met de status-knop, bewerk de mail-templates door op de naam te klikken."
      />
      <CampaignsClient campaigns={campaignRows} />
    </>
  );
}
