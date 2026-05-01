#!/usr/bin/env tsx
/**
 * Long-running BullMQ worker. Process this with a process supervisor
 * (systemd, pm2, Render, Railway, etc.). Pair with `pnpm schedule-ticks`
 * to enqueue the recurring tick job.
 *
 * Env requirements are validated by @outreach/config; if anything is
 * missing or malformed we exit immediately with a list of issues.
 */
import { closeDb, getDb } from "@outreach/db";
import { PostmarkMailer } from "@outreach/mailer";
import { DEFAULT_SEND_WINDOW } from "@outreach/sequencer";
import { AnthropicPersonalizer } from "@outreach/ai-personalization";
import { closeQueues, closeRedis, createTickWorker } from "@outreach/queue";
import { loadConfigOrExit } from "@outreach/config";

const cfg = loadConfigOrExit("worker");

function buildWindow() {
  return {
    startHour: cfg.SEND_WINDOW_START ?? DEFAULT_SEND_WINDOW.startHour,
    endHour: cfg.SEND_WINDOW_END ?? DEFAULT_SEND_WINDOW.endHour,
    weekdays: cfg.SEND_WEEKDAYS
      ? cfg.SEND_WEEKDAYS.split(",").map((s) => Number(s.trim()))
      : DEFAULT_SEND_WINDOW.weekdays,
  };
}

const mailer = new PostmarkMailer({
  serverToken: cfg.POSTMARK_SERVER_TOKEN,
  from: cfg.FROM_EMAIL,
  fromName: cfg.FROM_NAME,
  ...(cfg.REPLY_TO_EMAIL ? { replyTo: cfg.REPLY_TO_EMAIL } : {}),
  defaultTag: "outreach",
});

const personalizer = cfg.ANTHROPIC_API_KEY
  ? new AnthropicPersonalizer({
      apiKey: cfg.ANTHROPIC_API_KEY,
      ...(cfg.AI_MODEL ? { model: cfg.AI_MODEL } : {}),
    })
  : undefined;

const worker = createTickWorker({
  buildConfig: () => ({
    db: getDb(),
    mailer,
    fromEmail: cfg.FROM_EMAIL,
    fromName: cfg.FROM_NAME,
    ...(cfg.REPLY_TO_EMAIL ? { replyTo: cfg.REPLY_TO_EMAIL } : {}),
    publicBaseUrl: cfg.PUBLIC_BASE_URL,
    unsubscribeSecret: cfg.UNSUBSCRIBE_SECRET,
    dailyLimit: cfg.DAILY_SEND_LIMIT ?? 50,
    window: buildWindow(),
    batchSize: cfg.TICK_BATCH_SIZE ?? 50,
    personalizer,
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
