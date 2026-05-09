import { eq } from "drizzle-orm";
import {
  campaignLeads,
  contacts,
  emailsSent,
  unsubscribes,
  type Db,
} from "@outreach/db";
import { markBounced, markReplied, matchReply } from "@outreach/sequencer";
import { classify } from "./classifier.js";
import { ImapClient } from "./imap-client.js";
import { parseMessage } from "./parse-message.js";
import { heuristicTriage, ReplyTriage, type TriageResult } from "./triage.js";
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
  /**
   * When set, replies are passed through Anthropic for AI triage. Without
   * a key, a deterministic heuristic still classifies replies — less
   * precise, but no missing data on the dashboard.
   */
  anthropicApiKey?: string | undefined;
  /** Override the Claude model for triage. Default: claude-haiku-4-5. */
  triageModel?: string;
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
  const triage = opts.anthropicApiKey
    ? new ReplyTriage({
        apiKey: opts.anthropicApiKey,
        ...(opts.triageModel ? { model: opts.triageModel } : {}),
      })
    : null;

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
        await applyClassification(
          opts.db,
          parsed,
          cls,
          summary,
          opts.dryRun,
          triage,
          log,
        );
        log(
          `[inbox] uid=${uid} from=${parsed.fromAddress ?? "?"} subject="${(parsed.subject ?? "").slice(0, 60)}" -> ${cls.kind}`,
        );

        // Replies stay UNSEEN so the user still sees them as bold/new
        // in their mail client. We tag them with the custom keyword
        // `outreachprocessed` so the next poll skips them — without
        // triggering the \Seen flag the mail-client UI cares about.
        // Bounces / auto-replies / unknowns get \Seen — informational
        // only, no need to surface to the user.
        if (!opts.dryRun) {
          if (cls.kind === "reply") {
            await client.markProcessed(uid);
          } else {
            await client.markSeen(uid);
          }
        }
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
  triage: ReplyTriage | null,
  log: (line: string) => void,
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

    let triageResult: TriageResult;
    try {
      triageResult = triage
        ? await triage.classify({
            subject: parsed.subject,
            body: parsed.text,
          })
        : heuristicTriage({ subject: parsed.subject, body: parsed.text });
    } catch (err) {
      log(
        `[inbox] triage failed for uid=${parsed.uid}: ${err instanceof Error ? err.message : String(err)} — falling back to heuristic`,
      );
      triageResult = heuristicTriage({
        subject: parsed.subject,
        body: parsed.text,
      });
    }

    if (!dryRun) {
      await markReplied(db, match.campaignLeadId, parsed.date);
      await db
        .update(campaignLeads)
        .set({
          replyClassification: triageResult.classification,
          replySummary: triageResult.summary,
          replyText: parsed.text.slice(0, 10_000),
        })
        .where(eq(campaignLeads.id, match.campaignLeadId));
    }
    log(
      `[inbox] uid=${parsed.uid} reply triage=${triageResult.classification} (${triageResult.source})`,
    );
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
