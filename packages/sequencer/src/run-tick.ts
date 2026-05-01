import { and, asc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  sequenceSteps,
  unsubscribes,
  type Db,
} from "@outreach/db";
import type { Mailer } from "@outreach/mailer";
import { render, signUnsubscribeToken } from "@outreach/templates";
import {
  preSendCheck,
  type SendWindow,
  type SkipReason,
} from "./guards.js";
import { buildPersonalObservation } from "./personalization.js";

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
  campaignNiche: string | null;
  campaignName: string;
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

  const due = await fetchDueLeads(cfg.db, now, batchSize);
  const unsubscribed = await fetchUnsubscribed(cfg.db);
  const sentTodayBase = await countSentToday(cfg.db, now);

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
      dailyLimit: cfg.dailyLimit,
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

    const observation = buildPersonalObservation({
      businessName: row.businessName,
      rating: row.businessRating ? Number(row.businessRating) : null,
      reviewsCount: row.businessReviewsCount,
      city: row.businessCity,
      niche: row.campaignNiche,
    });

    const unsubUrl = `${cfg.publicBaseUrl.replace(/\/$/, "")}/api/unsubscribe?t=${signUnsubscribeToken(row.email, cfg.unsubscribeSecret)}`;

    const vars = {
      first_name: row.contactFirstName ?? "",
      business_name: row.businessName,
      personal_observation: observation,
      sender_name: cfg.fromName,
      unsubscribe_url: unsubUrl,
    };

    const subject = render(stepDef.subjectTemplate, vars, {
      onMissing: "blank",
    });
    const body = render(stepDef.bodyTemplate, vars, { onMissing: "blank" });

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
        subject,
        body,
        messageId: result.messageId,
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
      campaignNiche: campaigns.niche,
      campaignName: campaigns.name,
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

async function countSentToday(db: Db, now: Date): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailsSent)
    .where(gte(emailsSent.sentAt, startOfDay));
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
