import { Worker, type WorkerOptions } from "bullmq";
import { savedSearches, type Db } from "@outreach/db";
import {
  pickDueSearches,
  runSavedSearch,
  type SavedSearchRunResult,
} from "@outreach/discovery";
import { getRedisConnection } from "./connection.js";
import { tryAcquire } from "./lock.js";
import { DISCOVER_QUEUE, type DiscoverJobData } from "./queues.js";

const DISCOVER_LOCK_KEY = "outreach:discover-lock";

export interface CreateDiscoverWorkerOptions {
  /**
   * Builder that returns the Db handle + Google API key. Called per
   * poll so dashboard-saved settings (Google key) take effect without
   * a worker restart.
   */
  buildContext: () => Promise<{ db: Db; googleApiKey: string | undefined }>;
  onPollComplete?: (results: SavedSearchRunResult[]) => void | Promise<void>;
  concurrency?: number;
}

/**
 * Worker for the recurring "discover-poll" job. On each fire:
 *  1. Acquires a Redis mutex so concurrent polls across pods don't both
 *     run the same searches.
 *  2. Reads all saved_searches and filters those whose interval has
 *     elapsed (or that have never run) and are enabled.
 *  3. Runs each due search sequentially — Google Places quotas are
 *     per-day, so we don't gain much from parallelism.
 *  4. Reports per-search results.
 */
export function createDiscoverWorker(
  opts: CreateDiscoverWorkerOptions,
): Worker<DiscoverJobData> {
  const workerOpts: WorkerOptions = {
    connection: getRedisConnection(),
    concurrency: opts.concurrency ?? 1,
  };

  const redis = getRedisConnection();
  const worker = new Worker<DiscoverJobData, SavedSearchRunResult[]>(
    DISCOVER_QUEUE,
    async () => {
      const handle = await tryAcquire(redis, {
        key: DISCOVER_LOCK_KEY,
        ttlSeconds: 600,
      });
      if (!handle) {
        console.warn("[discover] poll skipped: another worker holds the lock");
        return [];
      }
      try {
        const ctx = await opts.buildContext();
        if (!ctx.googleApiKey) {
          console.warn("[discover] no Google API key — skipping poll");
          return [];
        }
        const all = await ctx.db.select().from(savedSearches);
        const due = pickDueSearches(all, new Date());
        if (due.length === 0) return [];
        console.log(`[discover] ${due.length} search(es) due, running…`);

        const results: SavedSearchRunResult[] = [];
        for (const s of due) {
          const r = await runSavedSearch(ctx.db, ctx.googleApiKey, s);
          results.push(r);
          if (r.ok) {
            console.log(
              `[discover] "${s.name}" -> ${r.result?.found ?? 0} found / ${r.result?.upserted ?? 0} upserted`,
            );
          } else {
            console.error(`[discover] "${s.name}" failed: ${r.error}`);
          }
        }
        if (opts.onPollComplete) await opts.onPollComplete(results);
        return results;
      } finally {
        await handle.release();
      }
    },
    workerOpts,
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[discover] poll job ${job?.id ?? "?"} failed:`,
      err.message,
    );
  });
  worker.on("error", (err) => {
    console.error("[discover] worker error:", err.message);
  });
  return worker;
}
