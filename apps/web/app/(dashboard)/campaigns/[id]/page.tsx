import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { campaigns, getDb, getSetting, sequenceSteps } from "@outreach/db";
import { previewAutoAssign } from "@outreach/sequencer";
import { PageHeader } from "../../_ui";
import { AiModeEditor } from "./ai-mode-editor";
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

  // Snapshot van de globale AI-instellingen voor de waarschuwing in de
  // campagne-UI ("je hebt AI aan voor deze campagne, maar globaal staat
  // 'ie uit dus er gebeurt niks").
  const globalAiRaw = (await getSetting(db, "AI_GENERATE_EMAILS")) ?? process.env["AI_GENERATE_EMAILS"];
  const globalAiEnabled =
    globalAiRaw !== undefined &&
    globalAiRaw !== "" &&
    globalAiRaw !== "false" &&
    globalAiRaw !== "0";
  const hasAnthropicKey = Boolean(
    (await getSetting(db, "ANTHROPIC_API_KEY")) ?? process.env["ANTHROPIC_API_KEY"],
  );

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`${campaign.niche ?? "no niche"} · status: ${campaign.status}`}
      />
      <AiModeEditor
        campaignId={id}
        aiEnabled={campaign.aiGenerateEmails}
        warmFollowupTarget={campaign.warmFollowupTarget}
        globalAiEnabled={globalAiEnabled}
        hasAnthropicKey={hasAnthropicKey}
      />
      <AutoAssignEditor
        campaignId={id}
        enabled={campaign.autoAssignEnabled}
        niche={campaign.autoAssignNiche}
        city={campaign.autoAssignCity}
        websiteQuality={campaign.autoAssignWebsiteQuality}
        minScore={campaign.autoAssignMinScore}
        maxScore={campaign.autoAssignMaxScore}
        maxLeads={campaign.autoAssignMaxLeads}
        preview={preview}
      />
      <SequenceEditor campaignId={id} steps={stepViews} />
    </>
  );
}
