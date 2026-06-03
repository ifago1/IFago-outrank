import { WebsiteScorer } from "./audit.js";
import { AiAuditor } from "./ai-audit.js";
import { PsiClient } from "./psi.js";
import type { WebsiteAuditResult } from "./types.js";

/**
 * Sluit de drie tiers van website-kwaliteit aan elkaar samen tot één
 * audit-resultaat dat we als JSONB in `businesses.audit_detail`
 * kunnen wegschrijven.
 *
 * Tier 1 (HTML-heuristieken) draait altijd. Tier 2 (PSI) en Tier 3
 * (AI) zijn opt-in via het meegegeven options-object — de runner
 * faalt gracefully als een specifieke tier-call mislukt zodat één
 * trage PSI-call de hele audit niet om zeep helpt.
 */
export interface CompositeAuditOptions {
  /** Plak een PSI-key voor Tier 2. Weglaten = geen PSI-call. */
  psiApiKey?: string;
  /** Plak een Anthropic-key voor Tier 3. Weglaten = geen AI-audit. */
  anthropicApiKey?: string;
  /** Default: claude-haiku-4-5. */
  aiModel?: string;
  /** Optioneel — businessName voor de AI-prompt context. */
  businessName?: string;
}

export interface PsiAuditDetail {
  ok: boolean;
  fetchedAt: string;
  /** 0-100, mobile strategy. null als PSI niet kon scoren. */
  performanceMobile: number | null;
  accessibilityMobile: number | null;
  bestPracticesMobile: number | null;
  seoMobile: number | null;
  /** Bij fout: foutmelding voor diagnose, geen score-velden gevuld. */
  error?: string;
}

export interface AiAuditDetail {
  ok: boolean;
  fetchedAt: string;
  score: number | null;
  summary: string | null;
  strengths: string[];
  weaknesses: string[];
  model: string;
  error?: string;
}

export interface CompositeAuditResult {
  /** Merged bucket-decision na alle tiers. */
  bucket: WebsiteAuditResult["bucket"];
  /** Pure HTML-score (0-100) — afkomstig van Tier 1. */
  htmlScore: number;
  signals: WebsiteAuditResult["signals"];
  /** True als de site überhaupt te bereiken was. */
  reachable: boolean;
  finalUrl: string | null;
  psi?: PsiAuditDetail;
  ai?: AiAuditDetail;
}

/**
 * Voert tier 1 altijd uit, tier 2/3 als hun keys gezet zijn. Eén call
 * per tier, alle drie sequentieel — parallelliseren over tiers heeft
 * weinig zin (PSI is sowieso langzaam, AI is snel, HTML al ge-fetched).
 */
export async function runCompositeAudit(
  url: string,
  opts: CompositeAuditOptions = {},
): Promise<CompositeAuditResult> {
  const scorer = new WebsiteScorer();
  const html = await scorer.audit(url);

  const result: CompositeAuditResult = {
    bucket: html.bucket,
    htmlScore: html.score,
    signals: html.signals,
    reachable: html.reachable,
    finalUrl: html.fetch?.finalUrl ?? null,
  };

  // Niet-bereikbaar → tier 2/3 hebben niets om mee te werken.
  if (!html.reachable) return result;

  if (opts.psiApiKey) {
    result.psi = await runPsi(url, opts.psiApiKey);
  }

  if (opts.anthropicApiKey && html.fetch) {
    result.ai = await runAi(
      url,
      html.fetch.htmlLower,
      opts.anthropicApiKey,
      opts.aiModel,
      opts.businessName,
    );
  }

  // Bucket-bijstelling: PSI-mobile < 40 cap't naar "outdated" (echt
  // langzame sites zijn altijd top-prio voor pitch); AI-score ≤ 3
  // forceert ook outdated.
  result.bucket = adjustBucket(result);

  return result;
}

async function runPsi(
  url: string,
  apiKey: string,
): Promise<PsiAuditDetail> {
  const psi = new PsiClient({ apiKey });
  const fetchedAt = new Date().toISOString();
  try {
    const res = await psi.audit(url, { strategy: "mobile" });
    return {
      ok: true,
      fetchedAt,
      performanceMobile: res.scores.performance,
      accessibilityMobile: res.scores.accessibility,
      bestPracticesMobile: res.scores["best-practices"],
      seoMobile: res.scores.seo,
    };
  } catch (err) {
    return {
      ok: false,
      fetchedAt,
      performanceMobile: null,
      accessibilityMobile: null,
      bestPracticesMobile: null,
      seoMobile: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runAi(
  url: string,
  html: string,
  apiKey: string,
  aiModel: string | undefined,
  businessName: string | undefined,
): Promise<AiAuditDetail> {
  const fetchedAt = new Date().toISOString();
  const model = aiModel ?? "claude-haiku-4-5";
  try {
    const auditor = new AiAuditor({ apiKey, model });
    const res = await auditor.audit({
      url,
      html,
      ...(businessName ? { businessName } : {}),
    });
    return {
      ok: true,
      fetchedAt,
      score: res.score,
      summary: res.summary,
      strengths: res.strengths,
      weaknesses: res.weaknesses,
      model,
    };
  } catch (err) {
    return {
      ok: false,
      fetchedAt,
      score: null,
      summary: null,
      strengths: [],
      weaknesses: [],
      model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function adjustBucket(
  result: CompositeAuditResult,
): WebsiteAuditResult["bucket"] {
  let bucket = result.bucket;
  const psiPerf = result.psi?.performanceMobile;
  if (typeof psiPerf === "number" && psiPerf < 40) {
    if (bucket === "good") bucket = "decent";
    else if (bucket === "decent") bucket = "outdated";
  }
  const aiScore = result.ai?.score;
  if (typeof aiScore === "number") {
    if (aiScore <= 3) bucket = "outdated";
    else if (aiScore <= 5 && bucket === "good") bucket = "decent";
  }
  return bucket;
}
