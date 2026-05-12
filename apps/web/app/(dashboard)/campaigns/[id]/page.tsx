import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { campaigns, getDb, sequenceSteps } from "@outreach/db";
import { previewAutoAssign } from "@outreach/sequencer";
import { PageHeader } from "../../_ui";
import { AutoAssignEditor } from "./auto-assign-editor";
import { SequenceEditor, type StepView } from "./sequence-editor";

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

  const stepViews: StepView[] = steps.map((s) => ({
    id: s.id,
    stepOrder: s.stepOrder,
    delayDays: s.delayDays,
    subjectTemplate: s.subjectTemplate,
    bodyTemplate: s.bodyTemplate,
  }));

  const preview = await previewAutoAssign(db, id);

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`${campaign.niche ?? "no niche"} · status: ${campaign.status}`}
      />
      <AutoAssignEditor
        campaignId={id}
        enabled={campaign.autoAssignEnabled}
        niches={campaign.matchNiches ?? []}
        cities={campaign.matchCities ?? []}
        websiteQualities={campaign.matchWebsiteQualities ?? []}
        priority={campaign.matchPriority}
        preview={preview}
      />
      <SequenceEditor campaignId={id} steps={stepViews} />
    </>
  );
}
