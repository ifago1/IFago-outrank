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
