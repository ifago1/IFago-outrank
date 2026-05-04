import { eq } from "drizzle-orm";
import { campaignLeads, emailsSent, type Db } from "@outreach/db";

/**
 * Find the campaign-lead an inbound email belongs to. Tries In-Reply-To
 * first, then References (which may be a chain). Falls back to matching the
 * sender against any contact we last wrote to.
 */
export interface ReplyMatch {
  campaignLeadId: string;
  matchedOn: "in-reply-to" | "references";
  emailSentId: string;
}

export async function matchReply(
  db: Db,
  headers: { inReplyTo?: string | undefined; references?: string | undefined },
): Promise<ReplyMatch | null> {
  const candidates = collectMessageIds(headers);
  for (const id of candidates) {
    const row = await db
      .select({ id: emailsSent.id, campaignLeadId: emailsSent.campaignLeadId })
      .from(emailsSent)
      .where(eq(emailsSent.messageId, id))
      .limit(1);
    if (row[0]) {
      return {
        campaignLeadId: row[0].campaignLeadId,
        matchedOn: id === candidates[0] ? "in-reply-to" : "references",
        emailSentId: row[0].id,
      };
    }
  }
  return null;
}

export async function markReplied(
  db: Db,
  campaignLeadId: string,
  repliedAt: Date,
): Promise<void> {
  await db
    .update(campaignLeads)
    .set({
      status: "replied",
      nextSendAt: null,
      lastEventAt: repliedAt,
    })
    .where(eq(campaignLeads.id, campaignLeadId));
}

export async function markBounced(
  db: Db,
  emailSentId: string,
  campaignLeadId: string,
  at: Date,
): Promise<void> {
  await db
    .update(emailsSent)
    .set({ bounced: true })
    .where(eq(emailsSent.id, emailSentId));
  await db
    .update(campaignLeads)
    .set({ status: "bounced", nextSendAt: null, lastEventAt: at })
    .where(eq(campaignLeads.id, campaignLeadId));
}

function collectMessageIds(headers: {
  inReplyTo?: string | undefined;
  references?: string | undefined;
}): string[] {
  const ids: string[] = [];
  if (headers.inReplyTo) ids.push(...extractIds(headers.inReplyTo));
  if (headers.references) ids.push(...extractIds(headers.references));
  return [...new Set(ids)];
}

export function extractIds(input: string): string[] {
  // Split on whitespace and strip angle brackets
  return input
    .split(/\s+/)
    .map((s) => s.replace(/^<|>$/g, "").trim())
    .filter((s) => s.length > 0);
}
