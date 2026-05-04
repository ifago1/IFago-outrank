import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import { Worker, type WorkerOptions } from "bullmq";
import { businesses, type Db } from "@outreach/db";
import {
  enrichAndPersist,
  type PersistedEnrichment,
} from "@outreach/enrichment";
import { getRedisConnection } from "./connection.js";
import { tryAcquire } from "./lock.js";
import { ENRICH_QUEUE, type EnrichJobData } from "./queues.js";

const ENRICH_LOCK_KEY = "outreach:enrich-lock";

export interface CreateEnrichWorkerOptions {
  /**
   * Builder called per poll so dashboard-saved settings (Hunter key)
   * take effect without a worker restart.
   */
  buildContext: () => Promise<{
    db: Db;
    hunterApiKey?: string | undefined;
  }>;
  /** Max businesses to enrich per poll. Default 50. */
  batchSize?: number;
  /** Re-enrich when previous attempt is older than this (days). Default 90. */
  staleDays?: number;
  /** Per-business parallelism. Default 5. */
  concurrency?: number;
  onPollComplete?: (
    results: PersistedEnrichment[],
  ) => void | Promise<void>;
  workerConcurrency?: number;
}

/**
 * Recurring "enrich-poll" worker. On each fire:
 *  1. Acquires a Redis mutex so concurrent polls across pods don't both
 *     enrich the same businesses.
 *  2. Picks up to `batchSize` businesses with a websiteUrl that have
 *     never been enriched, or were last attempted more than
 *     `staleDays` days ago.
 *  3. Runs the website-scrape (+ optional Hunter) pipeline on them and
 *     writes any discovered emails to `contacts`. Every processed row
 *     is stamped with `enrichment_attempted_at = NOW()` so the next
 *     poll skips it.
 */
export function createEnrichWorker(
  opts: CreateEnrichWorkerOptions,
): Worker<EnrichJobData> {
  const workerOpts: WorkerOptions = {
    connection: getRedisConnection(),
    concurrency: opts.workerConcurrency ?? 1,
  };

  const batchSize = opts.batchSize ?? 50;
  const staleDays = opts.staleDays ?? 90;
  const concurrency = opts.concurrency ?? 5;

  const redis = getRedisConnection();
  const worker = new Worker<EnrichJobData, PersistedEnrichment[]>(
    ENRICH_QUEUE,
    async () => {
      const handle = await tryAcquire(redis, {
        key: ENRICH_LOCK_KEY,
        ttlSeconds: 600,
      });
      if (!handle) {
        console.warn("[enrich] poll skipped: another worker holds the lock");
        return [];
      }
      try {
        const ctx = await opts.buildContext();
        const rows = await ctx.db
          .select({
            id: businesses.id,
            name: businesses.name,
            websiteUrl: businesses.websiteUrl,
          })
          .from(businesses)
          .where(
            and(
              isNotNull(businesses.websiteUrl),
              or(
                sql`${businesses.enrichmentAttemptedAt} IS NULL`,
                lt(
                  businesses.enrichmentAttemptedAt,
                  sql`NOW() - (${staleDays} || ' days')::interval`,
                ),
              ),
            ),
          )
          .limit(batchSize);

        if (rows.length === 0) {
          console.log("[enrich] no businesses due for enrichment");
          return [];
        }

        console.log(`[enrich] processing ${rows.length} business(es)`);
        const persisted = await enrichAndPersist(ctx.db, rows, {
          concurrency,
          ...(ctx.hunterApiKey ? { hunterApiKey: ctx.hunterApiKey } : {}),
        });

        const found = persisted.reduce((s, p) => s + p.inserted, 0);
        const failed = persisted.filter((p) => p.error).length;
        console.log(
          `[enrich] done: ${persisted.length} processed, ${found} contact(s) written, ${failed} failed`,
        );

        if (opts.onPollComplete) await opts.onPollComplete(persisted);
        return persisted;
      } finally {
        await handle.release();
      }
    },
    workerOpts,
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[enrich] poll job ${job?.id ?? "?"} failed:`,
      err.message,
    );
  });
  worker.on("error", (err) => {
    console.error("[enrich] worker error:", err.message);
  });
  return worker;
}
