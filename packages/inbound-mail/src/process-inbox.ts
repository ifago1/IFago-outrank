import { eq } from "drizzle-orm";
import { contacts, emailsSent, unsubscribes, type Db } from "@outreach/db";
import { markBounced, markReplied, matchReply } from "@outreach/sequencer";
import { classify } from "./classifier.js";
import { ImapClient } from "./imap-client.js";
import { parseMessage } from "./parse-message.js";
import type {
  Classification,
  ImapConnectionConfig,
  ParsedInboundMessage,
  PollSummary,
} from "./types.js";

export interface ProcessInboxOptions {
  db: Db;
  imap: ImapConnectionConfig;
  /** Max messages to handle per run. Default 100. */
  batchSize?: number;
  /** When true, don't write to the DB and don't mark messages \Seen. */
  dryRun?: boolean;
  /** Optional custom client (used by tests). */
  client?: ImapClient;
  log?: (line: string) => void;
}

/**
 * Open IMAP, scan up to `batchSize` UNSEEN messages, classify each one,
 * apply the corresponding DB write, then mark the message \Seen so the
 * next run skips it. Always idempotent — re-processing the same UID is
 * safe because all DB writes are.
 */
export async function processInbox(
  opts: ProcessInboxOptions,
): Promise<PollSummary> {
  const summary: PollSummary = {
    fetched: 0,
    matchedReplies: 0,
    matchedBounces: 0,
    unsubscribed: 0,
    ignored: 0,
    errors: 0,
  };
  const log = opts.log ?? (() => {});
  const client = opts.client ?? new ImapClient(opts.imap);
  const ownClient = !opts.client;

  try {
    await client.open();
    const uids = await client.listUnseen(opts.batchSize ?? 100);
    if (uids.length === 0) {
      log("[inbox] no unseen messages");
      return summary;
    }
    log(`[inbox] processing ${uids.length} unseen message(s)`);

    for (const uid of uids) {
      try {
        const fetched = await client.fetchRaw(uid);
        if (!fetched) continue;
        summary.fetched += 1;

        const parsed = await parseMessage(fetched.raw, uid);
        const cls = classify(parsed);
        await applyClassification(opts.db, parsed, cls, summary, opts.dryRun);
        log(
          `[inbox] uid=${uid} from=${parsed.fromAddress ?? "?"} subject="${(parsed.subject ?? "").slice(0, 60)}" -> ${cls.kind}`,
        );

        if (!opts.dryRun) await client.markSeen(uid);
      } catch (err) {
        summary.errors += 1;
        log(
          `[inbox] uid=${uid} error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    if (ownClient) {
      await client.close().catch(() => undefined);
    }
  }

  return summary;
}

async function applyClassification(
  db: Db,
  parsed: ParsedInboundMessage,
  cls: Classification,
  summary: PollSummary,
  dryRun: boolean | undefined,
): Promise<void> {
  if (cls.kind === "auto-reply") {
    summary.ignored += 1;
    return;
  }
  if (cls.kind === "unknown") {
    summary.ignored += 1;
    return;
  }

  if (cls.kind === "reply") {
    const inReplyTo = parsed.headers["in-reply-to"];
    const references = parsed.headers["references"];
    const match = await matchReply(db, {
      inReplyTo: inReplyTo ?? undefined,
      references: references ?? undefined,
    });
    if (!match) {
      summary.ignored += 1;
      return;
    }
    if (!dryRun) await markReplied(db, match.campaignLeadId, parsed.date);
    summary.matchedReplies += 1;
    return;
  }

  // bounce
  let messageId = cls.originalMessageId;
  if (!messageId) {
    summary.ignored += 1;
    return;
  }
  const sent = await db
    .select({
      id: emailsSent.id,
      campaignLeadId: emailsSent.campaignLeadId,
    })
    .from(emailsSent)
    .where(eq(emailsSent.messageId, messageId))
    .limit(1);

  const found = sent[0];
  if (!found) {
    summary.ignored += 1;
    return;
  }

  if (!dryRun) {
    await markBounced(db, found.id, found.campaignLeadId, parsed.date);
  }
  summary.matchedBounces += 1;

  if (cls.isHard && cls.recipient) {
    if (!dryRun) {
      await db
        .insert(unsubscribes)
        .values({
          email: cls.recipient.toLowerCase(),
          unsubscribedAt: parsed.date,
          reason: cls.reason ?? "hard_bounce",
        })
        .onConflictDoNothing({ target: unsubscribes.email });
      await db
        .update(contacts)
        .set({ doNotContact: true })
        .where(eq(contacts.email, cls.recipient.toLowerCase()));
    }
    summary.unsubscribed += 1;
  }
}
