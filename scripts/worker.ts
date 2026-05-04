#!/usr/bin/env tsx
/**
 * Long-running BullMQ worker. Each tick re-reads runtime settings from
 * the DB so anything you change in the dashboard Settings tab takes
 * effect on the very next tick — no service restart needed.
 *
 * Hard-required env (validated at startup):
 *   DATABASE_URL, REDIS_URL, UNSUBSCRIBE_SECRET
 * Everything else (mailer creds, API keys, send-window, warmup, ...)
 * lives in the `settings` DB table, fed by the dashboard. As a fallback
 * we read these from process.env so a fresh install boots even before
 * you've opened /settings.
 */
import { closeDb, getDb } from "@outreach/db";
import { closeQueues, closeRedis, createTickWorker } from "@outreach/queue";
import { loadConfigOrExit } from "@outreach/config";
import { buildRuntimeConfig } from "./lib/runtime-config.js";

const cfg = loadConfigOrExit("worker");

const worker = createTickWorker({
  buildConfig: () =>
    buildRuntimeConfig({
      db: getDb(),
      unsubscribeSecret: cfg.UNSUBSCRIBE_SECRET,
      ...(cfg.TICK_BATCH_SIZE !== undefined
        ? { batchSize: cfg.TICK_BATCH_SIZE }
        : {}),
    }),
  onTickComplete: (result) => {
    console.log(
      `[worker] tick: evaluated=${result.evaluated} sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`,
    );
  },
});

console.log("[worker] tick worker started — waiting for jobs");

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}, draining...`);
  try {
    await worker.close();
    await closeQueues();
    await closeRedis();
    await closeDb();
  } catch (err) {
    console.error("[worker] shutdown error:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
