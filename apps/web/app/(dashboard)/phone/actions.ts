"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  getDb,
  logLeadEvent,
} from "@outreach/db";
import {
  PHONE_STATUSES,
  STATUS_META,
  type PhoneStatus,
  type PhoneStatusActionResult,
} from "./types";

const VALID = new Set<string>(PHONE_STATUSES);

/**
 * Cadence per non-final status. Bepaalt wanneer een lead weer in de
 * Open-bucket verschijnt:
 *   voicemail → 3 werkdagen
 *   called    → 7 dagen
 *   callback  → user-input via form (datetime-local)
 *   interested → null (uit de cadence, gaat naar warm-followup)
 */
function nextAttemptAt(status: PhoneStatus, form: FormData, now: Date): Date | null {
  if (status === "voicemail") return addWorkdays(now, 3);
  if (status === "called") return addDays(now, 7);
  if (status === "callback") {
    const raw = String(form.get("nextAttemptAt") ?? "").trim();
    if (!raw) return addDays(now, 1);
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return addDays(now, 1);
    return d;
  }
  return null;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function addWorkdays(d: Date, n: number): Date {
  const out = new Date(d);
  let added = 0;
  while (added < n) {
    out.setDate(out.getDate() + 1);
    const wd = out.getDay(); // 0=zo, 6=za
    if (wd !== 0 && wd !== 6) added += 1;
  }
  return out;
}

/**
 * Zet phone-status voor één business + cadence + side effects. Schrijft
 * ook een lead_event zodat de timeline op /leads/<id> de hele
 * geschiedenis bewaart.
 */
export async function setPhoneStatus(
  businessId: string,
  form: FormData,
): Promise<PhoneStatusActionResult> {
  if (!businessId) return { ok: false, message: "Geen business-id." };

  const rawStatus = String(form.get("status") ?? "").trim();
  const clearMode = rawStatus === "" || rawStatus === "clear";
  const notes = String(form.get("notes") ?? "").trim() || null;

  if (!clearMode && !VALID.has(rawStatus)) {
    return { ok: false, message: `Onbekende status "${rawStatus}".` };
  }
  const status = clearMode ? null : (rawStatus as PhoneStatus);

  const db = getDb();
  const now = new Date();

  const nextAttempt = status ? nextAttemptAt(status, form, now) : null;

  const updates: {
    phoneStatus: PhoneStatus | null;
    phoneCalledAt: Date | null;
    phoneNotes: string | null;
    phoneNextAttemptAt: Date | null;
    phoneAttempts?: number;
    phone?: null;
  } = {
    phoneStatus: status,
    phoneCalledAt: status ? now : null,
    phoneNotes: notes,
    phoneNextAttemptAt: nextAttempt,
  };

  // Increment attempts bij elke nieuwe poging — niet bij 'clear'.
  if (status !== null) {
    const before = await db
      .select({ phoneAttempts: businesses.phoneAttempts })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const current = before[0]?.phoneAttempts ?? 0;
    updates.phoneAttempts = current + 1;
  } else {
    updates.phoneAttempts = 0;
  }

  if (status === "wrong_number") {
    updates.phone = null;
  }

  await db
    .update(businesses)
    .set(updates)
    .where(eq(businesses.id, businessId));

  let skippedLeads = 0;
  let warmFollowupAssigned = 0;

  if (status === "not_interested" || status === "wrong_number") {
    // Harde stop: DNC + skip alle actieve campaign_leads.
    const contactRows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.businessId, businessId));
    const contactIds = contactRows.map((c) => c.id);

    await db
      .update(contacts)
      .set({ doNotContact: true })
      .where(eq(contacts.businessId, businessId));

    if (contactIds.length > 0) {
      const skipResult = await db
        .update(campaignLeads)
        .set({ status: "skipped", nextSendAt: null, lastEventAt: now })
        .where(
          and(
            inArray(campaignLeads.contactId, contactIds),
            or(
              eq(campaignLeads.status, "queued"),
              eq(campaignLeads.status, "sent"),
            ),
          ),
        )
        .returning({ id: campaignLeads.id });
      skippedLeads = skipResult.length;
    }
  } else if (status === "interested") {
    // Warm-followup: zoek een campagne met warm_followup_target=true
    // en hang daar één contact onder. Eerste non-DNC contact wint.
    // mailSendAt-input (datetime-local) bepaalt wanneer de eerste
    // mail uitgaat — default = nu. Form-veld leeg = direct.
    const rawMailSendAt = String(form.get("mailSendAt") ?? "").trim();
    let mailSendAt = now;
    if (rawMailSendAt) {
      const d = new Date(rawMailSendAt);
      if (!Number.isNaN(d.getTime())) mailSendAt = d;
    }
    warmFollowupAssigned = await assignToWarmFollowup(
      db,
      businessId,
      now,
      mailSendAt,
    );
  }

  await logLeadEvent(db, {
    businessId,
    type: "phone_status",
    source: "phone",
    payload: {
      status,
      notes,
      nextAttemptAt: nextAttempt ? nextAttempt.toISOString() : null,
      sideEffects: {
        skippedLeads,
        warmFollowupAssigned,
      },
    },
  });

  revalidatePath("/phone");
  revalidatePath(`/leads/${businessId}`);
  revalidatePath("/leads");
  revalidatePath("/campaigns");

  const meta = status ? STATUS_META[status] : null;
  const labelPart = meta ? `op "${meta.label}"` : "gewist";
  const sideParts: string[] = [];
  if (status === "not_interested" || status === "wrong_number") {
    sideParts.push("contacts op DNC");
    if (skippedLeads > 0) sideParts.push(`${skippedLeads} campaign-lead(s) skipped`);
  }
  if (status === "interested") {
    if (warmFollowupAssigned > 0) {
      sideParts.push("warm-followup campagne ingepland");
    } else {
      sideParts.push(
        "let op: geen actieve warm-followup campagne — markeer er één in /campaigns",
      );
    }
  }
  if (nextAttempt) {
    sideParts.push(
      `terug op de Open-lijst ${nextAttempt.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "short", timeStyle: "short" })}`,
    );
  }
  const sidePart = sideParts.length > 0 ? " · " + sideParts.join(" · ") : "";
  return { ok: true, message: `Status ${labelPart}${sidePart}.` };
}

/**
 * Voeg de eerste non-DNC contact van deze business toe aan de warm-
 * followup campagne (campaigns.warm_followup_target=true). Returnt 0
 * als geen target-campagne of geen geschikt contact, 1 bij succes.
 *
 * De bel-notitie wordt opgeslagen in de lead_event zodat de
 * EmailWriter er bij send-time aan kan refereren via het meest
 * recente phone_status event.
 */
async function assignToWarmFollowup(
  db: ReturnType<typeof getDb>,
  businessId: string,
  now: Date,
  mailSendAt: Date,
): Promise<number> {
  const target = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.warmFollowupTarget, true),
        eq(campaigns.status, "active"),
      ),
    )
    .limit(1);
  if (target.length === 0) return 0;
  const campaignId = target[0]!.id;

  const cRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.businessId, businessId),
        eq(contacts.doNotContact, false),
      ),
    )
    .limit(1);
  if (cRows.length === 0) return 0;
  const contactId = cRows[0]!.id;

  // Upsert: bestaand campaign_lead krijgt de nieuwe nextSendAt + reset
  // naar queued zodat een herhaalde "interesse" markering 'm opnieuw
  // op de planning zet i.p.v. silent te negeren.
  const inserted = await db
    .insert(campaignLeads)
    .values({
      campaignId,
      contactId,
      status: "queued",
      currentStep: 0,
      nextSendAt: mailSendAt,
      lastEventAt: now,
    })
    .onConflictDoUpdate({
      target: [campaignLeads.campaignId, campaignLeads.contactId],
      set: {
        status: "queued",
        nextSendAt: mailSendAt,
        lastEventAt: now,
      },
    })
    .returning({ id: campaignLeads.id });

  if (inserted.length > 0) {
    await logLeadEvent(db, {
      businessId,
      type: "auto_assigned",
      source: "system",
      payload: {
        campaignId,
        reason: "warm_followup_after_interested",
        mailSendAt: mailSendAt.toISOString(),
      },
    });
  }

  return inserted.length;
}
