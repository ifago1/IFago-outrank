import { Worker, type WorkerOptions } from "bullmq";
import { type Db } from "@outreach/db";
import type { Mailer } from "@outreach/mailer";
import { loadDigestStats, renderDigest } from "@outreach/sequencer";
import { getRedisConnection } from "./connection.js";
import { tryAcquire } from "./lock.js";
import { DIGEST_QUEUE, type DigestJobData } from "./queues.js";

const DIGEST_LOCK_KEY = "outreach:digest-lock";

export interface CreateDigestWorkerOptions {
  /**
   * Builder called per fire so dashboard-saved settings (mailer creds,
   * notify-email) take effect without a worker restart.
   */
  buildContext: () => Promise<{
    db: Db;
    mailer: Mailer;
    fromEmail: string;
    fromName: string;
    /** Address that gets the digest. Falls back to fromEmail. */
    notifyEmail?: string | undefined;
  }>;
  /** How many hours back the digest covers. Default 24. */
  windowHours?: number;
  workerConcurrency?: number;
}

/**
 * Recurring digest worker. On each fire:
 *  1. Acquires a Redis mutex so multiple replicas don't all email.
 *  2. Loads stats for the previous N hours (default 24).
 *  3. Renders + sends the digest via the existing mailer.
 *
 * Skips silently when there were no sends in the window — no point in
 * spamming the operator with empty digests during quiet days.
 */
export function createDigestWorker(
  opts: CreateDigestWorkerOptions,
): Worker<DigestJobData> {
  const workerOpts: WorkerOptions = {
    connection: getRedisConnection(),
    concurrency: opts.workerConcurrency ?? 1,
  };
  const windowHours = opts.windowHours ?? 24;

  const redis = getRedisConnection();
  const worker = new Worker<DigestJobData, void>(
    DIGEST_QUEUE,
    async () => {
      const handle = await tryAcquire(redis, {
        key: DIGEST_LOCK_KEY,
        ttlSeconds: 300,
      });
      if (!handle) {
        console.warn("[digest] skipped: another worker holds the lock");
        return;
      }
      try {
        const ctx = await opts.buildContext();
        const until = new Date();
        const since = new Date(until.getTime() - windowHours * 3600 * 1000);
        const stats = await loadDigestStats(ctx.db, since, until);

        if (stats.sent === 0 && stats.replies === 0 && stats.bounces === 0) {
          console.log(
            `[digest] nothing to report (window ${since.toISOString()} → ${until.toISOString()})`,
          );
          return;
        }

        const rendered = renderDigest(stats);
        const to = ctx.notifyEmail ?? ctx.fromEmail;

        await ctx.mailer.send({
          from: ctx.fromEmail,
          fromName: ctx.fromName,
          to,
          subject: rendered.subject,
          text: rendered.body,
        });

        console.log(
          `[digest] sent to ${to} — sent=${stats.sent} replies=${stats.replies} positive=${stats.positive} bounces=${stats.bounces}`,
        );
      } finally {
        await handle.release();
      }
    },
    workerOpts,
  );

  worker.on("failed", (job, err) => {
    console.error(`[digest] job ${job?.id ?? "?"} failed:`, err.message);
  });
  worker.on("error", (err) => {
    console.error("[digest] worker error:", err.message);
  });
  return worker;
}
