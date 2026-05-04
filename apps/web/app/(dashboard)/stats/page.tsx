import { sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  emailsSent,
  getDb,
  sequenceStepVariants,
  sequenceSteps,
} from "@outreach/db";
import { PageHeader, Stat, Table } from "../_ui";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const db = getDb();

  const totals = await db
    .select({
      sent: sql<number>`(SELECT count(*)::int FROM emails_sent)`,
      bounced: sql<number>`(SELECT count(*)::int FROM emails_sent WHERE bounced = true)`,
      replied: sql<number>`(SELECT count(*)::int FROM campaign_leads WHERE status = 'replied')`,
      sentToday: sql<number>`(SELECT count(*)::int FROM emails_sent WHERE sent_at::date = current_date)`,
    })
    .from(sql`(SELECT 1) as _t`);
  const t = totals[0]!;

  const replyRate = t.sent > 0 ? (t.replied / t.sent) * 100 : 0;
  const bounceRate = t.sent > 0 ? (t.bounced / t.sent) * 100 : 0;

  const obsTotals = await db
    .select({
      ai: sql<number>`(SELECT count(*)::int FROM businesses WHERE personal_observation_source = 'ai')`,
      heuristic: sql<number>`(SELECT count(*)::int FROM businesses WHERE personal_observation_source = 'heuristic')`,
      none: sql<number>`(SELECT count(*)::int FROM businesses WHERE personal_observation IS NULL)`,
    })
    .from(sql`(SELECT 1) as _t`);
  const obs = obsTotals[0]!;

  const perCampaign = await db
    .select({
      name: campaigns.name,
      status: campaigns.status,
      sent: sql<number>`(
        SELECT count(*)::int FROM emails_sent es
        INNER JOIN campaign_leads cl ON cl.id = es.campaign_lead_id
        WHERE cl.campaign_id = campaigns.id
      )`,
      replied: sql<number>`(SELECT count(*)::int FROM campaign_leads cl WHERE cl.campaign_id = campaigns.id AND cl.status = 'replied')`,
      bounced: sql<number>`(SELECT count(*)::int FROM campaign_leads cl WHERE cl.campaign_id = campaigns.id AND cl.status = 'bounced')`,
    })
    .from(campaigns)
    .orderBy(sql`${campaigns.createdAt} DESC`);

  return (
    <>
      <PageHeader title="Stats" subtitle="Outreach performance" />

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <Stat label="Verstuurd (totaal)" value={t.sent} />
        <Stat label="Verstuurd vandaag" value={t.sentToday} />
        <Stat
          label="Reply rate"
          value={`${replyRate.toFixed(1)}%`}
          sub={`${t.replied} replies`}
        />
        <Stat
          label="Bounce rate"
          value={`${bounceRate.toFixed(1)}%`}
          sub={`${t.bounced} bounces`}
        />
      </section>

      <h2 style={{ fontSize: "1.05rem", margin: "1.5rem 0 0.75rem" }}>
        Personal observation cache
      </h2>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <Stat label="AI-generated" value={obs.ai} sub="Claude (cached)" />
        <Stat
          label="Heuristic fallback"
          value={obs.heuristic}
          sub="ANTHROPIC_API_KEY niet gezet of LLM faalde"
        />
        <Stat
          label="Nog niet gegenereerd"
          value={obs.none}
          sub="Wordt op de eerste send aangemaakt"
        />
      </section>

      <h2 style={{ fontSize: "1.05rem", margin: "1.5rem 0 0.75rem" }}>
        Per campagne
      </h2>
      <Table
        columns={["Campaign", "Status", "Sent", "Replied", "Bounced", "Reply %"]}
        rows={perCampaign.map((r) => {
          const rr = r.sent > 0 ? (r.replied / r.sent) * 100 : 0;
          return [r.name, r.status, r.sent, r.replied, r.bounced, `${rr.toFixed(1)}%`];
        })}
        empty="Geen campagnes om statistieken voor te tonen."
      />

      <h2 style={{ fontSize: "1.05rem", margin: "2rem 0 0.75rem" }}>
        A/B varianten
      </h2>
      <PerVariantStats db={db} />
    </>
  );
}

async function PerVariantStats({
  db,
}: {
  db: ReturnType<typeof getDb>;
}) {
  const rows = await db
    .select({
      campaignName: campaigns.name,
      stepOrder: sequenceSteps.stepOrder,
      label: sequenceStepVariants.label,
      sent: sql<number>`(SELECT count(*)::int FROM emails_sent es WHERE es.variant_id = sequence_step_variants.id)`,
      replied: sql<number>`(
        SELECT count(*)::int FROM emails_sent es
        INNER JOIN campaign_leads cl ON cl.id = es.campaign_lead_id
        WHERE es.variant_id = sequence_step_variants.id
          AND cl.status = 'replied'
      )`,
      bounced: sql<number>`(SELECT count(*)::int FROM emails_sent es WHERE es.variant_id = sequence_step_variants.id AND es.bounced = true)`,
    })
    .from(sequenceStepVariants)
    .innerJoin(
      sequenceSteps,
      sql`${sequenceSteps.id} = ${sequenceStepVariants.stepId}`,
    )
    .innerJoin(
      campaigns,
      sql`${campaigns.id} = ${sequenceSteps.campaignId}`,
    )
    .orderBy(
      sql`${campaigns.name}, ${sequenceSteps.stepOrder}, ${sequenceStepVariants.label}`,
    );

  return (
    <Table
      columns={["Campaign", "Step", "Variant", "Sent", "Replied", "Bounced", "Reply %"]}
      rows={rows.map((r) => {
        const rr = r.sent > 0 ? (r.replied / r.sent) * 100 : 0;
        return [
          r.campaignName,
          r.stepOrder,
          r.label,
          r.sent,
          r.replied,
          r.bounced,
          `${rr.toFixed(1)}%`,
        ];
      })}
      empty="Nog geen A/B varianten gedefinieerd. Voeg ze toe via sequence_step_variants."
    />
  );
}
