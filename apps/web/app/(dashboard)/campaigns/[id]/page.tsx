import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { campaigns, getDb, sequenceSteps } from "@outreach/db";
import { listVariables } from "@outreach/templates";
import { PageHeader, Pill } from "../../_ui";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const cRows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  const campaign = cRows[0];
  if (!campaign) notFound();

  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, id))
    .orderBy(asc(sequenceSteps.stepOrder));

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`${campaign.niche ?? "no niche"} · status: ${campaign.status}`}
      />
      <h2 style={{ fontSize: "1.05rem", margin: "1.5rem 0 0.75rem" }}>
        Sequence ({steps.length} steps)
      </h2>
      {steps.map((step) => {
        const vars = [
          ...new Set([
            ...listVariables(step.subjectTemplate),
            ...listVariables(step.bodyTemplate),
          ]),
        ];
        return (
          <article
            key={step.id}
            style={{
              border: "1px solid #20252e",
              borderRadius: "8px",
              padding: "1rem 1.25rem",
              marginBottom: "0.75rem",
              background: "#0f1218",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <strong>Step {step.stepOrder}</strong>
              <Pill tone="neutral">+{step.delayDays} days</Pill>
            </header>
            <div style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>
              <strong>Subject:</strong> {step.subjectTemplate}
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#0a0c11",
                padding: "0.75rem",
                borderRadius: "6px",
                fontSize: "0.85rem",
                margin: 0,
              }}
            >
              {step.bodyTemplate}
            </pre>
            {vars.length > 0 ? (
              <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", opacity: 0.7 }}>
                Variables: {vars.map((v) => `{{${v}}}`).join(", ")}
              </div>
            ) : null}
          </article>
        );
      })}
    </>
  );
}
