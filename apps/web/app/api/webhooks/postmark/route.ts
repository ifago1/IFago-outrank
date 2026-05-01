import { NextResponse } from "next/server";
import {
  contacts,
  emailsSent,
  getDb,
  unsubscribes,
} from "@outreach/db";
import { eq } from "drizzle-orm";
import {
  markBounced,
  markReplied,
  matchReply,
} from "@outreach/sequencer";

export const runtime = "nodejs";

/**
 * Postmark inbound + bounce webhook.
 *
 * Inbound mail (RecordType="Inbound" or top-level shape with FromFull):
 *   - Match the message to a campaign_lead via In-Reply-To / References
 *   - Mark the lead as 'replied' so the sequencer stops
 *
 * Bounce events (RecordType="Bounce"):
 *   - Find the original send by Postmark MessageID
 *   - Mark emails_sent.bounced = true and the lead as 'bounced'
 *   - Hard bounces also add the recipient to the unsubscribes list
 *
 * Auth: shared-secret check via the `?secret=` query param. We compare against
 * POSTMARK_INBOUND_WEBHOOK_SECRET. (Postmark itself doesn't sign webhooks.)
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const expected = process.env["POSTMARK_INBOUND_WEBHOOK_SECRET"];
  if (!expected) {
    return NextResponse.json(
      { error: "webhook secret not configured" },
      { status: 503 },
    );
  }
  if (url.searchParams.get("secret") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: PostmarkPayload;
  try {
    payload = (await req.json()) as PostmarkPayload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();

  if (payload.RecordType === "Bounce") {
    return handleBounce(db, payload, now);
  }

  // Inbound: when type is omitted, Postmark posts the full inbound message
  return handleInbound(db, payload, now);
}

interface PostmarkPayload {
  RecordType?: "Bounce" | "SpamComplaint" | "Inbound";
  // Inbound fields
  FromFull?: { Email: string; Name?: string };
  ToFull?: Array<{ Email: string }>;
  Subject?: string;
  Headers?: Array<{ Name: string; Value: string }>;
  TextBody?: string;
  HtmlBody?: string;
  // Bounce fields
  Type?: string; // "HardBounce", "SoftBounce", "SpamComplaint", ...
  TypeCode?: number;
  MessageID?: string; // original outbound message-id
  Email?: string; // bounced recipient
  Inactive?: boolean;
}

async function handleInbound(
  db: ReturnType<typeof getDb>,
  payload: PostmarkPayload,
  now: Date,
) {
  const headers = headersToMap(payload.Headers ?? []);
  const inReplyTo = headers["in-reply-to"];
  const references = headers["references"];

  const match = await matchReply(db, {
    inReplyTo: inReplyTo ?? undefined,
    references: references ?? undefined,
  });

  if (!match) {
    return NextResponse.json({ ok: true, matched: false });
  }
  await markReplied(db, match.campaignLeadId, now);
  return NextResponse.json({
    ok: true,
    matched: true,
    campaignLeadId: match.campaignLeadId,
  });
}

async function handleBounce(
  db: ReturnType<typeof getDb>,
  payload: PostmarkPayload,
  now: Date,
) {
  if (!payload.MessageID) {
    return NextResponse.json(
      { ok: false, error: "missing MessageID" },
      { status: 400 },
    );
  }
  const sent = await db
    .select({ id: emailsSent.id, campaignLeadId: emailsSent.campaignLeadId })
    .from(emailsSent)
    .where(eq(emailsSent.messageId, payload.MessageID))
    .limit(1);

  const found = sent[0];
  if (!found) {
    return NextResponse.json({ ok: true, matched: false });
  }

  await markBounced(db, found.id, found.campaignLeadId, now);

  // Hard bounce or marked Inactive → never email this address again
  const isHard =
    payload.Type === "HardBounce" ||
    payload.Type === "SpamComplaint" ||
    payload.Inactive === true;
  if (isHard && payload.Email) {
    await db
      .insert(unsubscribes)
      .values({
        email: payload.Email.toLowerCase(),
        unsubscribedAt: now,
        reason: payload.Type ?? "hard_bounce",
      })
      .onConflictDoNothing({ target: unsubscribes.email });

    // Belt-and-braces: also flag the contact rows directly
    await db
      .update(contacts)
      .set({ doNotContact: true })
      .where(eq(contacts.email, payload.Email.toLowerCase()));
  }

  return NextResponse.json({
    ok: true,
    matched: true,
    bounceType: payload.Type ?? null,
  });
}

function headersToMap(
  hs: Array<{ Name: string; Value: string }>,
): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of hs) m[h.Name.toLowerCase()] = h.Value;
  return m;
}
