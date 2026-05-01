import { Worker, type WorkerOptions } from "bullmq";
import {
  runSendTick,
  type RunTickConfig,
  type TickResult,
} from "@outreach/sequencer";
import { getRedisConnection } from "./connection.js";
import { TICK_QUEUE, type TickJobData } from "./queues.js";

export interface CreateTickWorkerOptions {
  /**
   * Builder that returns a fresh RunTickConfig for each tick. Called once
   * per job; we deliberately don't cache the config so DB / Mailer
   * connections can be hot-reloaded between ticks.
   */
  buildConfig: () => RunTickConfig | Promise<RunTickConfig>;
  /**
   * Optional hook for logging / metrics. Receives the per-tick TickResult
   * after every successful run.
   */
  onTickComplete?: (result: TickResult) => void | Promise<void>;
  /**
   * BullMQ concurrency — how many ticks run in parallel on this worker.
   * Default 1: each tick is large already (batches up to N leads internally),
   * and running ticks in parallel risks exceeding the daily-send limit.
   */
  concurrency?: number;
}

/**
 * Spin up a BullMQ worker that processes the tick queue. The caller is
 * responsible for calling `worker.close()` on shutdown (SIGTERM/SIGINT).
 */
export function createTickWorker(opts: CreateTickWorkerOptions): Worker<TickJobData> {
  const workerOpts: WorkerOptions = {
    connection: getRedisConnection(),
    concurrency: opts.concurrency ?? 1,
  };

  const worker = new Worker<TickJobData, TickResult>(
    TICK_QUEUE,
    async (job) => {
      const config = await opts.buildConfig();
      const result = await runSendTick(config);
      if (opts.onTickComplete) await opts.onTickComplete(result);
      return result;
    },
    workerOpts,
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[queue] tick job ${job?.id ?? "?"} failed (attempt ${job?.attemptsMade ?? "?"}):`,
      err.message,
    );
  });
  worker.on("error", (err) => {
    console.error(`[queue] worker error:`, err.message);
  });

  return worker;
}
