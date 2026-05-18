import { and, asc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  leadEvents,
  logLeadEvent,
  sequenceStepVariants,
  sequenceSteps,
  unsubscribes,
  type Db,
} from "@outreach/db";
import type { Mailer } from "@outreach/mailer";
import { render, signUnsubscribeToken } from "@outreach/templates";
import type {
  AnthropicPersonalizer,
  EmailWriter,
} from "@outreach/ai-personalization";
import {
  preSendCheck,
  startOfDay,
  type SendWindow,
  type SkipReason,
} from "./guards.js";
import {
  effectiveDailyLimit,
  evaluateBounceCircuit,
} from "./health.js";
import { buildPersonalObservation } from "./personalization.js";
import { pickWeighted } from "./variant-selector.js";

export interface RunTickConfig {
  db: Db;
  mailer: Mailer;
  now?: Date;
  /** "name@agency.nl" — used in the From header. */
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  /** Base URL of the dashboard, for unsubscribe links. */
  publicBaseUrl: string;
  /** Used to HMAC-sign unsubscribe tokens. */
  unsubscribeSecret: string;
  /** Daily send cap for deliverability hygiene. */
  dailyLimit: number;
  /** When sends are allowed. */
  window: SendWindow;
  /** Cap on leads processed per tick (avoid huge bursts). */
  batchSize?: number;
  /** When true, evaluates everything but does not send / mutate state. */
  dryRun?: boolean;
  /**
   * Domain-warmup ramp. When set, the effective daily limit is interpolated
   * linearly from `floor` (day 0) to `dailyLimit` (day `days`). Disabled
   * (full daily limit immediately) when omitted.
   */
  warmup?: { days: number; floor: number };
  /**
   * Bounce-rate circuit breaker. When the recent bounce rate (last
   * `windowSize` sends) exceeds `threshold`, the entire tick is halted —
   * sending more mail with bad addresses scorches sender reputation.
   * Default threshold 5%, window 50 sends. Disabled when omitted.
   */
  bounceCircuit?: {
    threshold?: number;
    windowSize?: number;
    minSent?: number;
  };
  /**
   * Optional Claude-backed personalizer. When provided, the first time we
   * send to a business we ask Claude to write a one-line observation and
   * cache it on businesses.personal_observation. Subsequent steps reuse the
   * cached value. Falls back to the heuristic on any error.
   */
  personalizer?: AnthropicPersonalizer | undefined;
  /**
   * Optional Claude-backed full-email writer. When provided, replaces the
   * static step-templates: Claude schrijft per send subject + body o.b.v.
   * business + audit + reviews + step-context. Bij elke failure (timeout,
   * parse-error, rate-limit) valt de send terug op de sequence-template
   * zodat één AI-storing geen sends blokkeert.
   */
  emailWriter?: EmailWriter | undefined;
  /**
   * Override Math.random — used by tests to make A/B variant selection
   * deterministic.
   */
  random?: () => number;
}

export interface SendOutcome {
  campaignLeadId: string;
  email: string;
  step: number;
  status: "sent" | "skipped" | "failed";
  reason?: SkipReason | string;
  messageId?: string;
}

export interface TickResult {
  evaluated: number;
  sent: number;
  skipped: number;
  failed: number;
  outcomes: SendOutcome[];
}

interface DueRow {
  campaignLeadId: string;
  campaignId: string;
  contactId: string;
  currentStep: number;
  email: string;
  contactFirstName: string | null;
  contactDoNotContact: boolean;
  businessId: string;
  businessName: string;
  businessCity: string | null;
  businessRating: string | null; // numeric -> string in pg
  businessReviewsCount: number | null;
  businessRawData: unknown;
  businessWebsiteUrl: string | null;
  businessWebsiteQuality: string | null;
  businessAuditDetail: unknown;
  cachedObservation: string | null;
  campaignNiche: string | null;
  campaignName: string;
  campaignAiGenerateEmails: boolean;
}

/**
 * Run one pass of the sequencer:
 * 1. Find due leads (next_send_at <= now, status = queued|sent).
 * 2. Determine the next step from sequence_steps.
 * 3. Evaluate guards.
 * 4. Render + send via the configured Mailer.
 * 5. Record in emails_sent, advance current_step, schedule next_send_at.
 */
export async function runSendTick(cfg: RunTickConfig): Promise<TickResult> {
  const now = cfg.now ?? new Date();
  const batchSize = cfg.batchSize ?? 50;

  // Tick-level guard: bounce-rate circuit breaker.
  if (cfg.bounceCircuit) {
    const windowSize = cfg.bounceCircuit.windowSize ?? 50;
    const recent = await fetchRecentBounceStats(cfg.db, windowSize);
    const decision = evaluateBounceCircuit({
      recentBounces: recent.bounces,
      recentSent: recent.sent,
      ...(cfg.bounceCircuit.threshold !== undefined
        ? { threshold: cfg.bounceCircuit.threshold }
        : {}),
      ...(cfg.bounceCircuit.minSent !== undefined
        ? { minSent: cfg.bounceCircuit.minSent }
        : {}),
    });
    if (decision.open) {
      console.warn(
        `[runSendTick] bounce circuit open — halting tick (${decision.reason})`,
      );
      return { evaluated: 0, sent: 0, skipped: 0, failed: 0, outcomes: [] };
    }
  }

  // Tick-level: compute the warmup-adjusted daily limit (once per tick).
  let effectiveLimit = cfg.dailyLimit;
  if (cfg.warmup) {
    const firstSentAt = await fetchFirstSentAt(cfg.db);
    effectiveLimit = effectiveDailyLimit({
      firstSentAt,
      now,
      fullLimit: cfg.dailyLimit,
      warmupDays: cfg.warmup.days,
      floor: cfg.warmup.floor,
    });
  }

  const due = await fetchDueLeads(cfg.db, now, batchSize);
  const unsubscribed = await fetchUnsubscribed(cfg.db);
  const sentTodayBase = await countSentToday(cfg.db, now, cfg.window.timezone);

  let sentNow = 0;
  let skipped = 0;
  let failed = 0;
  const outcomes: SendOutcome[] = [];

  for (const row of due) {
    const stepDef = await loadNextStep(
      cfg.db,
      row.campaignId,
      row.currentStep + 1,
    );
    if (!stepDef) {
      // No more steps — mark this lead's sequence finished.
      if (!cfg.dryRun) {
        await cfg.db
          .update(campaignLeads)
          .set({
            status: "completed",
            nextSendAt: null,
            lastEventAt: now,
          })
          .where(eq(campaignLeads.id, row.campaignLeadId));
      }
      outcomes.push({
        campaignLeadId: row.campaignLeadId,
        email: row.email,
        step: row.currentStep,
        status: "skipped",
        reason: "sequence_finished",
      });
      skipped += 1;
      continue;
    }

    const hasOtherActive = await hasActiveLeadInOtherCampaign(
      cfg.db,
      row.businessId,
      row.campaignId,
    );

    const skip = preSendCheck({
      email: row.email,
      contactDoNotContact: row.contactDoNotContact,
      hasOtherActiveCampaign: hasOtherActive,
      unsubscribed,
      now,
      window: cfg.window,
      sentToday: sentTodayBase + sentNow,
      dailyLimit: effectiveLimit,
    });

    if (skip) {
      outcomes.push({
        campaignLeadId: row.campaignLeadId,
        email: row.email,
        step: stepDef.stepOrder,
        status: "skipped",
        reason: skip,
      });
      skipped += 1;
      // Hard-stop reasons: take the lead out of rotation
      if (
        skip === "unsubscribed" ||
        skip === "do_not_contact" ||
        skip === "already_in_other_campaign"
      ) {
        if (!cfg.dryRun) {
          await cfg.db
            .update(campaignLeads)
            .set({
              status:
                skip === "unsubscribed" ? "unsubscribed" : "skipped",
              nextSendAt: null,
              lastEventAt: now,
            })
            .where(eq(campaignLeads.id, row.campaignLeadId));
        }
      }
      // Soft-defer reasons (window / daily limit): leave next_send_at as-is,
      // we'll pick this lead up again on the next tick.
      continue;
    }

    // Threading: if this is step >= 2, find step 1's message-id for In-Reply-To
    let inReplyTo: string | undefined;
    if (stepDef.stepOrder > 1) {
      const first = await firstMessageId(cfg.db, row.campaignLeadId);
      if (first) inReplyTo = `<${first}>`;
    }

    // A/B variant selection (no variants → use the step itself)
    const variants = await loadVariants(cfg.db, stepDef.id);
    const random = cfg.random ?? Math.random;
    const variant =
      variants.length > 0
        ? pickWeighted(
            variants.map((v) => ({ item: v, weight: v.weight })),
            random,
          )
        : null;
    const subjectTemplate = variant?.subjectTemplate ?? stepDef.subjectTemplate;
    const bodyTemplate = variant?.bodyTemplate ?? stepDef.bodyTemplate;

    const observation = await resolveObservation(cfg, row);

    const unsubUrl = `${cfg.publicBaseUrl.replace(/\/$/, "")}/api/unsubscribe?t=${signUnsubscribeToken(row.email, cfg.unsubscribeSecret)}`;

    const vars = {
      first_name: row.contactFirstName ?? "",
      business_name: row.businessName,
      personal_observation: observation,
      sender_name: cfg.fromName,
      unsubscribe_url: unsubUrl,
    };

    // AI-generated subject + body alleen wanneer:
    //   1) globale AI_GENERATE_EMAILS is aan (cfg.emailWriter gezet)
    //   2) per-campaign vlag staat ook aan
    // Fallback naar static template bij elke failure zodat één
    // Anthropic-outage geen sends blokkeert.
    let subject: string;
    let body: string;
    const ai =
      cfg.emailWriter && row.campaignAiGenerateEmails
        ? await tryGenerateEmail(cfg.emailWriter, cfg.db, row, stepDef.stepOrder)
        : null;
    if (ai) {
      // AI body ends with {{sender_name}} per the prompt; append the
      // same unsub-footer the templates use, then render placeholders.
      subject = render(ai.subject, vars, { onMissing: "blank" });
      body = render(
        `${ai.body}\n\n—\nLiever geen mails? {{unsubscribe_url}}`,
        vars,
        { onMissing: "blank" },
      );
    } else {
      subject = render(subjectTemplate, vars, { onMissing: "blank" });
      body = render(bodyTemplate, vars, { onMissing: "blank" });
    }

    if (cfg.dryRun) {
      outcomes.push({
        campaignLeadId: row.campaignLeadId,
        email: row.email,
        step: stepDef.stepOrder,
        status: "sent",
        reason: "dry_run",
        messageId: "(dry-run)",
      });
      sentNow += 1;
      continue;
    }

    try {
      const result = await cfg.mailer.send({
        to: row.email,
        subject,
        text: body,
        from: cfg.fromEmail,
        fromName: cfg.fromName,
        ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
        ...(inReplyTo ? { inReplyTo } : {}),
        unsubscribeUrl: unsubUrl,
        tags: {
          campaign: row.campaignName,
          step: String(stepDef.stepOrder),
        },
      });

      await cfg.db.insert(emailsSent).values({
        campaignLeadId: row.campaignLeadId,
        stepOrder: stepDef.stepOrder,
        ...(variant ? { variantId: variant.id } : {}),
        subject,
        body,
        messageId: result.messageId,
      });

      await logLeadEvent(cfg.db, {
        businessId: row.businessId,
        type: "mail_sent",
        source: "mail",
        payload: {
          stepOrder: stepDef.stepOrder,
          subject,
          messageId: result.messageId,
          campaignId: row.campaignId,
          variantId: variant?.id ?? null,
          aiGenerated: ai !== null,
        },
      });

      const nextDef = await loadNextStep(
        cfg.db,
        row.campaignId,
        stepDef.stepOrder + 1,
      );
      const nextSendAt = nextDef
        ? addDays(now, nextDef.delayDays)
        : null;

      await cfg.db
        .update(campaignLeads)
        .set({
          status: nextDef ? "sent" : "completed",
          currentStep: stepDef.stepOrder,
          nextSendAt,
          lastEventAt: now,
        })
        .where(eq(campaignLeads.id, row.campaignLeadId));

      outcomes.push({
        campaignLeadId: row.campaignLeadId,
        email: row.email,
        step: stepDef.stepOrder,
        status: "sent",
        messageId: result.messageId,
      });
      sentNow += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({
        campaignLeadId: row.campaignLeadId,
        email: row.email,
        step: stepDef.stepOrder,
        status: "failed",
        reason: msg,
      });
      failed += 1;
      // Don't advance the lead — it'll be retried on the next tick.
    }
  }

  return {
    evaluated: due.length,
    sent: sentNow,
    skipped,
    failed,
    outcomes,
  };
}

async function fetchDueLeads(
  db: Db,
  now: Date,
  limit: number,
): Promise<DueRow[]> {
  return db
    .select({
      campaignLeadId: campaignLeads.id,
      campaignId: campaignLeads.campaignId,
      contactId: campaignLeads.contactId,
      currentStep: campaignLeads.currentStep,
      email: contacts.email,
      contactFirstName: contacts.firstName,
      contactDoNotContact: contacts.doNotContact,
      businessId: businesses.id,
      businessName: businesses.name,
      businessCity: businesses.city,
      businessRating: businesses.googleRating,
      businessReviewsCount: businesses.reviewsCount,
      businessRawData: businesses.rawPlacesData,
      businessWebsiteUrl: businesses.websiteUrl,
      businessWebsiteQuality: businesses.websiteQuality,
      businessAuditDetail: businesses.auditDetail,
      cachedObservation: businesses.personalObservation,
      campaignNiche: campaigns.niche,
      campaignName: campaigns.name,
      campaignAiGenerateEmails: campaigns.aiGenerateEmails,
    })
    .from(campaignLeads)
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .innerJoin(businesses, eq(businesses.id, contacts.businessId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(
      and(
        eq(campaigns.status, "active"),
        or(
          eq(campaignLeads.status, "queued"),
          eq(campaignLeads.status, "sent"),
        ),
        or(
          isNull(campaignLeads.nextSendAt),
          lte(campaignLeads.nextSendAt, now),
        ),
      ),
    )
    .orderBy(asc(campaignLeads.nextSendAt))
    .limit(limit);
}

async function fetchUnsubscribed(db: Db): Promise<Set<string>> {
  const rows = await db.select({ email: unsubscribes.email }).from(unsubscribes);
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

async function fetchFirstSentAt(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ first: sql<Date | null>`MIN(${emailsSent.sentAt})` })
    .from(emailsSent);
  const first = rows[0]?.first;
  return first ? new Date(first as unknown as string) : null;
}

async function fetchRecentBounceStats(
  db: Db,
  windowSize: number,
): Promise<{ sent: number; bounces: number }> {
  // Take the last N emails by sent_at and count bounces among them.
  const rows = await db
    .select({ bounced: emailsSent.bounced })
    .from(emailsSent)
    .orderBy(sql`${emailsSent.sentAt} DESC`)
    .limit(windowSize);
  return {
    sent: rows.length,
    bounces: rows.filter((r) => r.bounced).length,
  };
}

async function countSentToday(
  db: Db,
  now: Date,
  timezone?: string,
): Promise<number> {
  const dayStart = startOfDay(now, timezone);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailsSent)
    .where(gte(emailsSent.sentAt, dayStart));
  return rows[0]?.count ?? 0;
}

async function loadNextStep(
  db: Db,
  campaignId: string,
  stepOrder: number,
) {
  const rows = await db
    .select()
    .from(sequenceSteps)
    .where(
      and(
        eq(sequenceSteps.campaignId, campaignId),
        eq(sequenceSteps.stepOrder, stepOrder),
      ),
    )
    .limit(1);
  return rows[0];
}

async function hasActiveLeadInOtherCampaign(
  db: Db,
  businessId: string,
  thisCampaignId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: campaignLeads.id })
    .from(campaignLeads)
    .innerJoin(contacts, eq(contacts.id, campaignLeads.contactId))
    .where(
      and(
        eq(contacts.businessId, businessId),
        ne(campaignLeads.campaignId, thisCampaignId),
        or(
          eq(campaignLeads.status, "queued"),
          eq(campaignLeads.status, "sent"),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function firstMessageId(
  db: Db,
  campaignLeadId: string,
): Promise<string | null> {
  const rows = await db
    .select({ messageId: emailsSent.messageId })
    .from(emailsSent)
    .where(
      and(
        eq(emailsSent.campaignLeadId, campaignLeadId),
        eq(emailsSent.stepOrder, 1),
      ),
    )
    .limit(1);
  return rows[0]?.messageId ?? null;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

async function loadVariants(db: Db, stepId: string) {
  return db
    .select({
      id: sequenceStepVariants.id,
      label: sequenceStepVariants.label,
      weight: sequenceStepVariants.weight,
      subjectTemplate: sequenceStepVariants.subjectTemplate,
      bodyTemplate: sequenceStepVariants.bodyTemplate,
    })
    .from(sequenceStepVariants)
    .where(eq(sequenceStepVariants.stepId, stepId));
}

/**
 * Resolve the personal_observation:
 *   1. Cached on businesses.personal_observation → use as-is
 *   2. cfg.personalizer set → call Claude, cache the result
 *   3. Fall back to the heuristic (also cached so we don't keep retrying AI)
 */
async function resolveObservation(
  cfg: RunTickConfig,
  row: DueRow,
): Promise<string> {
  if (row.cachedObservation) return row.cachedObservation;

  const heuristic = buildPersonalObservation({
    businessName: row.businessName,
    rating: row.businessRating ? Number(row.businessRating) : null,
    reviewsCount: row.businessReviewsCount,
    city: row.businessCity,
    niche: row.campaignNiche,
  });

  if (!cfg.personalizer || cfg.dryRun) return heuristic;

  try {
    const reviewSnippets = extractReviewSnippets(row.businessRawData);
    const result = await cfg.personalizer.generate({
      businessName: row.businessName,
      city: row.businessCity,
      niche: row.campaignNiche,
      rating: row.businessRating ? Number(row.businessRating) : null,
      reviewsCount: row.businessReviewsCount,
      reviewSnippets,
    });
    if (!result.text) return heuristic;
    await cfg.db
      .update(businesses)
      .set({
        personalObservation: result.text,
        personalObservationSource: "ai",
      })
      .where(eq(businesses.id, row.businessId));
    return result.text;
  } catch {
    // Cache the heuristic so we don't keep hammering the LLM on transient errors.
    await cfg.db
      .update(businesses)
      .set({
        personalObservation: heuristic,
        personalObservationSource: "heuristic",
      })
      .where(eq(businesses.id, row.businessId));
    return heuristic;
  }
}

/**
 * Try to generate subject + body via the EmailWriter. Returns null on any
 * failure (network, parse-error, rate-limit) so the caller can fall back
 * to the static template — never let one bad AI call halt the tick.
 */
async function tryGenerateEmail(
  writer: EmailWriter,
  db: Db,
  row: DueRow,
  stepOrder: number,
): Promise<{ subject: string; body: string } | null> {
  try {
    const reviewSnippets = extractReviewSnippets(row.businessRawData);
    const audit = parseAuditDetail(row.businessAuditDetail);
    const callContext = await fetchCallContext(db, row.businessId);
    const result = await writer.generate({
      businessName: row.businessName,
      niche: row.campaignNiche,
      city: row.businessCity,
      rating: row.businessRating ? Number(row.businessRating) : null,
      reviewsCount: row.businessReviewsCount,
      reviewSnippets,
      websiteUrl: row.businessWebsiteUrl,
      websiteQuality: parseWebsiteQuality(row.businessWebsiteQuality),
      psiPerformanceMobile: audit.psiPerformanceMobile,
      auditSummary: audit.summary,
      auditWeaknesses: audit.weaknesses,
      stepOrder,
      ...(callContext ? { callContext } : {}),
    });
    return { subject: result.subject, body: result.body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[runSendTick] EmailWriter failed for ${row.email} step ${stepOrder}, falling back to template: ${msg}`,
    );
    return null;
  }
}

/**
 * Pakt de meest recente phone_status event voor deze business, indien
 * binnen de laatste 90 dagen. Returnt undefined als er geen relevant
 * gesprek is — dan blijft de mail een normale cold-mail.
 */
async function fetchCallContext(
  db: Db,
  businessId: string,
): Promise<{ status: string; calledAt?: string; notes?: string } | undefined> {
  const rows = await db
    .select({
      payload: leadEvents.payload,
      occurredAt: leadEvents.occurredAt,
    })
    .from(leadEvents)
    .where(
      and(
        eq(leadEvents.businessId, businessId),
        eq(leadEvents.type, "phone_status"),
      ),
    )
    .orderBy(sql`${leadEvents.occurredAt} DESC`)
    .limit(1);
  const ev = rows[0];
  if (!ev) return undefined;
  const p = ev.payload as { status?: string; notes?: string } | null;
  if (!p?.status) return undefined;
  // Negeer afsluitende statussen — daar willen we sowieso geen mail
  // meer naartoe sturen (de DNC-check vangt 'm op).
  if (p.status === "not_interested" || p.status === "wrong_number") {
    return undefined;
  }
  const ageMs =
    Date.now() -
    (ev.occurredAt instanceof Date
      ? ev.occurredAt.getTime()
      : new Date(ev.occurredAt as unknown as string).getTime());
  if (ageMs > 90 * 24 * 60 * 60 * 1000) return undefined;
  return {
    status: p.status,
    calledAt:
      ev.occurredAt instanceof Date
        ? ev.occurredAt.toISOString()
        : (ev.occurredAt as unknown as string),
    ...(p.notes ? { notes: p.notes } : {}),
  };
}

function parseWebsiteQuality(
  q: string | null,
): "good" | "decent" | "outdated" | "none" | null {
  if (q === "good" || q === "decent" || q === "outdated" || q === "none") {
    return q;
  }
  return null;
}

interface ParsedAudit {
  summary: string | null;
  weaknesses: string[];
  psiPerformanceMobile: number | null;
}

function parseAuditDetail(raw: unknown): ParsedAudit {
  const out: ParsedAudit = {
    summary: null,
    weaknesses: [],
    psiPerformanceMobile: null,
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const ai = r["ai"] as Record<string, unknown> | undefined;
  if (ai && typeof ai === "object") {
    if (typeof ai["summary"] === "string") out.summary = ai["summary"];
    if (Array.isArray(ai["weaknesses"])) {
      out.weaknesses = ai["weaknesses"].filter(
        (w): w is string => typeof w === "string",
      );
    }
  }
  const psi = r["psi"] as Record<string, unknown> | undefined;
  if (psi && typeof psi === "object") {
    const perf = psi["performanceMobile"];
    if (typeof perf === "number") out.psiPerformanceMobile = perf;
  }
  return out;
}

/**
 * Best-effort extraction of short review-like text from the raw Places
 * payload. The Places API only returns reviews when explicitly requested in
 * the field mask (currently we don't), so this typically yields []; once we
 * add `places.reviews` to the field mask in packages/places this becomes
 * automatically populated.
 */
function extractReviewSnippets(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const reviews = (raw as Record<string, unknown>)["reviews"];
  if (!Array.isArray(reviews)) return [];
  const out: string[] = [];
  for (const r of reviews.slice(0, 5)) {
    if (r && typeof r === "object") {
      const text = (r as Record<string, unknown>)["text"];
      if (typeof text === "string" && text.trim().length > 0) {
        out.push(text);
        continue;
      }
      const nested = (text as Record<string, unknown> | null)?.["text"];
      if (typeof nested === "string") out.push(nested);
    }
  }
  return out;
}
