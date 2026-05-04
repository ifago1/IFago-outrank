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
import { closeDb, getDb, getSetting } from "@outreach/db";
import {
  closeQueues,
  closeRedis,
  createDiscoverWorker,
  createTickWorker,
} from "@outreach/queue";
import { loadConfigOrExit } from "@outreach/config";
import { buildRuntimeConfig } from "./lib/runtime-config.js";

const cfg = loadConfigOrExit("worker");

const tickWorker = createTickWorker({
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

const discoverWorker = createDiscoverWorker({
  buildContext: async () => {
    const db = getDb();
    // Settings tab can override the env-supplied key.
    const dbKey = await getSetting(db, "GOOGLE_PLACES_API_KEY");
    const googleApiKey = dbKey ?? process.env["GOOGLE_PLACES_API_KEY"];
    return { db, googleApiKey };
  },
});

console.log(
  "[worker] tick + discover workers started — waiting for jobs",
);

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}, draining...`);
  try {
    await tickWorker.close();
    await discoverWorker.close();
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
