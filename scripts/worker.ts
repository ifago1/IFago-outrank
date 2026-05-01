#!/usr/bin/env tsx
/**
 * Long-running BullMQ worker. Process this with a process supervisor
 * (systemd, pm2, Render, Railway, etc.). Pair with `pnpm schedule-ticks`
 * to enqueue the recurring tick job.
 *
 * Required env: DATABASE_URL, REDIS_URL, POSTMARK_SERVER_TOKEN, FROM_EMAIL,
 *               FROM_NAME, PUBLIC_BASE_URL, UNSUBSCRIBE_SECRET.
 * Optional env: REPLY_TO_EMAIL, DAILY_SEND_LIMIT, SEND_WINDOW_*,
 *               SEND_WEEKDAYS, ANTHROPIC_API_KEY.
 */
import { closeDb, getDb } from "@outreach/db";
import { PostmarkMailer } from "@outreach/mailer";
import { DEFAULT_SEND_WINDOW } from "@outreach/sequencer";
import { AnthropicPersonalizer } from "@outreach/ai-personalization";
import { closeQueues, closeRedis, createTickWorker } from "@outreach/queue";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function buildWindow() {
  const start = Number(process.env["SEND_WINDOW_START"]);
  const end = Number(process.env["SEND_WINDOW_END"]);
  const weekdaysRaw = process.env["SEND_WEEKDAYS"];
  const weekdays = weekdaysRaw
    ? weekdaysRaw.split(",").map((s) => Number(s.trim())).filter((n) => n > 0)
    : DEFAULT_SEND_WINDOW.weekdays;
  return {
    startHour: Number.isFinite(start) ? start : DEFAULT_SEND_WINDOW.startHour,
    endHour: Number.isFinite(end) ? end : DEFAULT_SEND_WINDOW.endHour,
    weekdays,
  };
}

const mailer = new PostmarkMailer({
  serverToken: required("POSTMARK_SERVER_TOKEN"),
  from: required("FROM_EMAIL"),
  fromName: process.env["FROM_NAME"] ?? "",
  ...(process.env["REPLY_TO_EMAIL"]
    ? { replyTo: process.env["REPLY_TO_EMAIL"] }
    : {}),
  defaultTag: "outreach",
});

const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const personalizer = anthropicKey
  ? new AnthropicPersonalizer({ apiKey: anthropicKey })
  : undefined;

const worker = createTickWorker({
  buildConfig: () => ({
    db: getDb(),
    mailer,
    fromEmail: required("FROM_EMAIL"),
    fromName: process.env["FROM_NAME"] ?? "Outreach",
    ...(process.env["REPLY_TO_EMAIL"]
      ? { replyTo: process.env["REPLY_TO_EMAIL"] }
      : {}),
    publicBaseUrl: required("PUBLIC_BASE_URL"),
    unsubscribeSecret: required("UNSUBSCRIBE_SECRET"),
    dailyLimit: Number(process.env["DAILY_SEND_LIMIT"] ?? "50"),
    window: buildWindow(),
    batchSize: Number(process.env["TICK_BATCH_SIZE"] ?? "50"),
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
