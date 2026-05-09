"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  campaigns,
  getDb,
  sequenceSteps,
} from "@outreach/db";
import { DEFAULT_SEQUENCE } from "@outreach/templates";
import type { CampaignActionResult } from "./types";

const VALID_STATUSES = new Set(["draft", "active", "paused"]);

export async function createCampaign(
  form: FormData,
): Promise<CampaignActionResult> {
  const name = String(form.get("name") ?? "").trim();
  const niche = String(form.get("niche") ?? "").trim();
  const activate = form.get("activate") === "on";

  if (!name) return { ok: false, message: "Naam is vereist." };

  const db = getDb();

  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.name, name))
    .limit(1);
  if (existing.length > 0) {
    return { ok: false, message: `Er bestaat al een campagne met de naam "${name}".` };
  }

  const [created] = await db
    .insert(campaigns)
    .values({
      name,
      ...(niche ? { niche } : {}),
      status: activate ? "active" : "draft",
    })
    .returning();

  if (!created) return { ok: false, message: "Insert faalde." };

  // Seed met de default 3-step sequence uit @outreach/templates.
  await db.insert(sequenceSteps).values(
    DEFAULT_SEQUENCE.map((step) => ({
      campaignId: created.id,
      stepOrder: step.stepOrder,
      delayDays: step.delayDays,
      subjectTemplate: step.subjectTemplate,
      bodyTemplate: step.bodyTemplate,
    })),
  );

  revalidatePath("/campaigns");
  return {
    ok: true,
    message: `Campagne "${name}" aangemaakt met 3-step default sequence.`,
    campaignId: created.id,
  };
}

export async function setCampaignStatus(
  id: string,
  status: string,
): Promise<CampaignActionResult> {
  if (!VALID_STATUSES.has(status)) {
    return { ok: false, message: `Onbekende status "${status}".` };
  }
  const db = getDb();
  await db.update(campaigns).set({ status }).where(eq(campaigns.id, id));
  revalidatePath("/campaigns");
  return { ok: true, message: `Status -> ${status}` };
}

export async function deleteCampaign(
  id: string,
): Promise<CampaignActionResult> {
  const db = getDb();
  // ON DELETE CASCADE op sequenceSteps + campaignLeads doet de rest.
  await db.delete(campaigns).where(eq(campaigns.id, id));
  revalidatePath("/campaigns");
  return { ok: true, message: "Verwijderd." };
}

/**
 * Update auto-assign rules for one campaign. NULL fields act as
 * wildcards in the matcher; omitting a field on the form clears it.
 *
 * Idempotent: re-submitting the same form is a no-op. The matcher only
 * runs when `enabled` is true, so toggling it without setting any rule
 * acts as "match everything in this campaign's niche" — useful when
 * you've already filled the campaign's `niche` field.
 */
export async function updateAutoAssign(
  id: string,
  form: FormData,
): Promise<CampaignActionResult> {
  const enabled = form.get("autoAssignEnabled") === "on";
  const niche = String(form.get("autoAssignNiche") ?? "").trim();
  const city = String(form.get("autoAssignCity") ?? "").trim();
  const websiteQuality = String(
    form.get("autoAssignWebsiteQuality") ?? "",
  ).trim();
  const maxLeadsRaw = String(form.get("autoAssignMaxLeads") ?? "").trim();
  const maxLeads = maxLeadsRaw ? Math.max(0, Number(maxLeadsRaw) || 0) : null;
  const minScoreRaw = String(form.get("autoAssignMinScore") ?? "").trim();
  const maxScoreRaw = String(form.get("autoAssignMaxScore") ?? "").trim();
  const aiPersonalizeFullBody = form.get("aiPersonalizeFullBody") === "on";

  const validQuality = new Set(["", "outdated", "decent", "good", "none"]);
  if (!validQuality.has(websiteQuality)) {
    return {
      ok: false,
      message: `Onbekende website-quality "${websiteQuality}".`,
    };
  }

  const minScore = minScoreRaw ? clampScore(Number(minScoreRaw)) : null;
  const maxScore = maxScoreRaw ? clampScore(Number(maxScoreRaw)) : null;
  if (
    minScore != null &&
    maxScore != null &&
    minScore > maxScore
  ) {
    return {
      ok: false,
      message: `Min-score (${minScore}) mag niet hoger zijn dan max-score (${maxScore}).`,
    };
  }

  const db = getDb();
  await db
    .update(campaigns)
    .set({
      autoAssignEnabled: enabled,
      autoAssignNiche: niche || null,
      autoAssignCity: city || null,
      autoAssignWebsiteQuality: websiteQuality || null,
      autoAssignMinScore: minScore,
      autoAssignMaxScore: maxScore,
      autoAssignMaxLeads: maxLeads,
      aiPersonalizeFullBody,
    })
    .where(eq(campaigns.id, id));

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return {
    ok: true,
    message: enabled
      ? "Auto-assign aangezet. Nieuwe leads die matchen worden automatisch toegevoegd."
      : "Auto-assign uitgezet.",
  };
}

function clampScore(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function updateSequenceStep(
  campaignId: string,
  stepOrder: number,
  form: FormData,
): Promise<CampaignActionResult> {
  const subjectTemplate = String(form.get("subjectTemplate") ?? "").trim();
  const bodyTemplate = String(form.get("bodyTemplate") ?? "").trim();
  const delayDaysRaw = String(form.get("delayDays") ?? "0").trim();
  const delayDays = Math.max(0, Number(delayDaysRaw) || 0);

  if (!subjectTemplate) return { ok: false, message: "Subject is vereist." };
  if (!bodyTemplate) return { ok: false, message: "Body is vereist." };

  const db = getDb();
  await db
    .update(sequenceSteps)
    .set({ subjectTemplate, bodyTemplate, delayDays })
    .where(
      and(
        eq(sequenceSteps.campaignId, campaignId),
        eq(sequenceSteps.stepOrder, stepOrder),
      ),
    );

  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, message: `Step ${stepOrder} bijgewerkt.` };
}
