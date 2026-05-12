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
const VALID_QUALITIES = new Set(["good", "decent", "outdated", "none"]);

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

function nullableTrim(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s.length > 0 ? s : null;
}

function nullableInt(raw: unknown, min: number, max: number): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export async function updateAutoAssignRules(
  campaignId: string,
  form: FormData,
): Promise<CampaignActionResult> {
  if (!campaignId) return { ok: false, message: "Geen campaign-id." };

  const enabled = form.get("enabled") === "on";
  const niche = nullableTrim(form.get("niche"));
  const city = nullableTrim(form.get("city"));
  const qualityRaw = nullableTrim(form.get("websiteQuality"));
  const websiteQuality =
    qualityRaw && VALID_QUALITIES.has(qualityRaw) ? qualityRaw : null;
  const minScore = nullableInt(form.get("minScore"), 0, 100);
  const maxScore = nullableInt(form.get("maxScore"), 0, 100);
  const maxLeads = nullableInt(form.get("maxLeads"), 1, 1_000_000);

  if (minScore !== null && maxScore !== null && minScore > maxScore) {
    return {
      ok: false,
      message: `Min-score (${minScore}) > max-score (${maxScore}). Niet opgeslagen.`,
    };
  }

  const db = getDb();
  await db
    .update(campaigns)
    .set({
      autoAssignEnabled: enabled,
      autoAssignNiche: niche,
      autoAssignCity: city,
      autoAssignWebsiteQuality: websiteQuality,
      autoAssignMinScore: minScore,
      autoAssignMaxScore: maxScore,
      autoAssignMaxLeads: maxLeads,
    })
    .where(eq(campaigns.id, campaignId));

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");

  const filters: string[] = [];
  if (niche) filters.push(`niche=${niche}`);
  if (city) filters.push(`city=${city}`);
  if (websiteQuality) filters.push(`quality=${websiteQuality}`);
  if (minScore !== null || maxScore !== null) {
    filters.push(`score=${minScore ?? "*"}..${maxScore ?? "*"}`);
  }
  if (maxLeads !== null) filters.push(`max=${maxLeads}`);
  const filterDesc = filters.length > 0 ? filters.join(", ") : "catch-all";

  return {
    ok: true,
    message: `Auto-assign ${enabled ? "AAN" : "uit"} — ${filterDesc}.`,
  };
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
