import { Worker, type WorkerOptions } from "bullmq";
import { type Db } from "@outreach/db";
import {
  processInbox,
  type ImapConnectionConfig,
  type PollSummary,
} from "@outreach/inbound-mail";
import { getRedisConnection } from "./connection.js";
import { tryAcquire } from "./lock.js";
import { INBOX_QUEUE, type InboxJobData } from "./queues.js";

const INBOX_LOCK_KEY = "outreach:inbox-lock";

export interface CreateInboxWorkerOptions {
  /**
   * Builder called per poll so dashboard-saved IMAP credentials take
   * effect without a worker restart. Returning `null` skips the poll
   * (useful when IMAP is not configured yet — keeps the worker idle
   * instead of spamming auth-failure errors).
   */
  buildContext: () => Promise<{
    db: Db;
    imap: ImapConnectionConfig;
    /**
     * When set, replies get AI-classified via Anthropic; without a key,
     * a deterministic heuristic still fills the same columns.
     */
    anthropicApiKey?: string | undefined;
  } | null>;
  /** Max messages handled per poll. Default 100. */
  batchSize?: number;
  onPollComplete?: (summary: PollSummary) => void | Promise<void>;
  workerConcurrency?: number;
}

/**
 * Recurring "inbox-poll" worker. On each fire:
 *  1. Acquires a Redis mutex (one poll across all replicas).
 *  2. Calls `buildContext()` to fetch fresh IMAP credentials from DB +
 *     env. Skips silently when none are configured.
 *  3. Runs `processInbox` which scans up to `batchSize` UNSEEN
 *     messages, classifies each, updates the matching campaign-lead /
 *     emails_sent / unsubscribes rows, and marks the message \Seen.
 */
export function createInboxWorker(
  opts: CreateInboxWorkerOptions,
): Worker<InboxJobData> {
  const workerOpts: WorkerOptions = {
    connection: getRedisConnection(),
    concurrency: opts.workerConcurrency ?? 1,
  };

  const batchSize = opts.batchSize ?? 100;
  const redis = getRedisConnection();
  const worker = new Worker<InboxJobData, PollSummary | null>(
    INBOX_QUEUE,
    async () => {
      const handle = await tryAcquire(redis, {
        key: INBOX_LOCK_KEY,
        ttlSeconds: 300,
      });
      if (!handle) {
        console.warn("[inbox] poll skipped: another worker holds the lock");
        return null;
      }
      try {
        const ctx = await opts.buildContext();
        if (!ctx) {
          console.warn(
            "[inbox] poll skipped: IMAP not configured (set IMAP_HOST/USER/PASS)",
          );
          return null;
        }
        const summary = await processInbox({
          db: ctx.db,
          imap: ctx.imap,
          batchSize,
          ...(ctx.anthropicApiKey
            ? { anthropicApiKey: ctx.anthropicApiKey }
            : {}),
          log: (line) => console.log(line),
        });
        console.log(
          `[inbox] done: fetched=${summary.fetched} replies=${summary.matchedReplies} bounces=${summary.matchedBounces} unsub=${summary.unsubscribed} ignored=${summary.ignored} errors=${summary.errors}`,
        );
        if (opts.onPollComplete) await opts.onPollComplete(summary);
        return summary;
      } finally {
        await handle.release();
      }
    },
    workerOpts,
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[inbox] poll job ${job?.id ?? "?"} failed:`,
      err.message,
    );
  });
  worker.on("error", (err) => {
    console.error("[inbox] worker error:", err.message);
  });
  return worker;
}
