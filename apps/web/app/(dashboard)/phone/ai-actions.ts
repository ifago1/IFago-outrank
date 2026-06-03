"use server";

import { eq } from "drizzle-orm";
import {
  businesses,
  campaigns,
  contacts,
  getDb,
  getSetting,
} from "@outreach/db";
import { CallPitch, EmailWriter } from "@outreach/ai-personalization";

export interface CallPitchResult {
  ok: boolean;
  pitch?: string;
  error?: string;
}

export interface MailPreviewResult {
  ok: boolean;
  subject?: string;
  body?: string;
  error?: string;
}

/**
 * On-demand: Claude genereert een 2-3 zin bel-opener voor deze
 * business. Toont in de phone-row UI bij klik op de pitch-knop.
 * Vereist ANTHROPIC_API_KEY in DB-settings of env. Bij failure
 * geeft een vriendelijke fallback terug i.p.v. crashen.
 */
export async function generateCallPitch(
  businessId: string,
): Promise<CallPitchResult> {
  if (!businessId) return { ok: false, error: "Geen business-id." };

  const db = getDb();
  const apiKey =
    (await getSetting(db, "ANTHROPIC_API_KEY")) ??
    process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY ontbreekt — vul 'm in onder /settings.",
    };
  }

  const rows = await db
    .select({
      name: businesses.name,
      city: businesses.city,
      category: businesses.category,
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
      rating: businesses.googleRating,
      reviewsCount: businesses.reviewsCount,
      auditDetail: businesses.auditDetail,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const r = rows[0];
  if (!r) return { ok: false, error: "Business niet gevonden." };

  const audit = parseAuditDetail(r.auditDetail);
  const aiModel = await getSetting(db, "AI_MODEL");

  const pitch = new CallPitch({
    apiKey,
    ...(aiModel ? { model: aiModel } : {}),
  });
  try {
    const out = await pitch.generate({
      businessName: r.name,
      niche: r.category,
      city: r.city,
      rating: r.rating != null ? Number(r.rating) : null,
      reviewsCount: r.reviewsCount,
      websiteUrl: r.websiteUrl,
      websiteQuality: r.websiteQuality,
      auditSummary: audit.summary,
      auditWeaknesses: audit.weaknesses,
    });
    return { ok: true, pitch: out.pitch };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `AI-call mislukt: ${err.message}`
          : "AI-call mislukt.",
    };
  }
}

/**
 * Preview van wat Claude zou versturen als warm-followup mail
 * gegeven de huidige bel-notitie. Read-only: bevestig je 'm via
 * "interesse" markeren in de phone-row, dan komt de feitelijke
 * mail door bij de volgende send-tick.
 */
export async function previewWarmFollowupMail(
  businessId: string,
  notes: string,
): Promise<MailPreviewResult> {
  if (!businessId) return { ok: false, error: "Geen business-id." };

  const db = getDb();
  const apiKey =
    (await getSetting(db, "ANTHROPIC_API_KEY")) ??
    process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY ontbreekt — vul 'm in onder /settings.",
    };
  }

  // Welke campagne is target?
  const targetCampaign = await db
    .select({ niche: campaigns.niche, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.warmFollowupTarget, true))
    .limit(1);
  if (targetCampaign.length === 0) {
    return {
      ok: false,
      error:
        "Geen warm-followup target campagne ingesteld — markeer er één in /campaigns.",
    };
  }

  const rows = await db
    .select({
      name: businesses.name,
      city: businesses.city,
      category: businesses.category,
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
      rating: businesses.googleRating,
      reviewsCount: businesses.reviewsCount,
      auditDetail: businesses.auditDetail,
      rawPlacesData: businesses.rawPlacesData,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const r = rows[0];
  if (!r) return { ok: false, error: "Business niet gevonden." };

  const audit = parseAuditDetail(r.auditDetail);
  const reviewSnippets = extractReviewSnippets(r.rawPlacesData);
  const aiEmailModel =
    (await getSetting(db, "AI_EMAIL_MODEL")) ??
    (await getSetting(db, "AI_MODEL"));

  const writer = new EmailWriter({
    apiKey,
    ...(aiEmailModel ? { model: aiEmailModel } : {}),
  });

  try {
    const out = await writer.generate({
      businessName: r.name,
      niche: targetCampaign[0]?.niche ?? r.category,
      city: r.city,
      rating: r.rating != null ? Number(r.rating) : null,
      reviewsCount: r.reviewsCount,
      reviewSnippets,
      websiteUrl: r.websiteUrl,
      websiteQuality: parseWebsiteQuality(r.websiteQuality),
      psiPerformanceMobile: audit.psiPerformanceMobile,
      auditSummary: audit.summary,
      auditWeaknesses: audit.weaknesses,
      stepOrder: 1,
      callContext: {
        status: "interested",
        calledAt: new Date().toISOString(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    });
    return { ok: true, subject: out.subject, body: out.body };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `AI-call mislukt: ${err.message}`
          : "AI-call mislukt.",
    };
  }
}

interface AuditDetail {
  psiPerformanceMobile: number | null;
  summary: string | null;
  weaknesses: string[];
}

function parseAuditDetail(detail: unknown): AuditDetail {
  if (!detail || typeof detail !== "object") {
    return { psiPerformanceMobile: null, summary: null, weaknesses: [] };
  }
  const d = detail as Record<string, unknown>;
  const psi = d["psiPerformanceMobile"] ?? d["psi_performance_mobile"];
  const summary = d["aiSummary"] ?? d["ai_summary"] ?? d["summary"];
  const weaknesses = d["aiWeaknesses"] ?? d["ai_weaknesses"] ?? d["weaknesses"];
  return {
    psiPerformanceMobile:
      typeof psi === "number" ? psi : psi == null ? null : Number(psi),
    summary: typeof summary === "string" ? summary : null,
    weaknesses: Array.isArray(weaknesses)
      ? weaknesses.filter((w): w is string => typeof w === "string")
      : [],
  };
}

function parseWebsiteQuality(
  v: string | null,
): "good" | "decent" | "outdated" | "none" | null {
  if (v === "good" || v === "decent" || v === "outdated" || v === "none") {
    return v;
  }
  return null;
}

function extractReviewSnippets(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const reviews = r["reviews"];
  if (!Array.isArray(reviews)) return [];
  return reviews
    .map((rev) => {
      if (!rev || typeof rev !== "object") return null;
      const text = (rev as Record<string, unknown>)["text"];
      if (typeof text === "object" && text && "text" in text) {
        const inner = (text as Record<string, unknown>)["text"];
        return typeof inner === "string" ? inner : null;
      }
      return typeof text === "string" ? text : null;
    })
    .filter((t): t is string => Boolean(t))
    .slice(0, 5);
}
