#!/usr/bin/env tsx
/**
 * CLI: pnpm send-tick [--dry-run] [--batch=50]
 *
 * Runs one pass of the sequencer. Intended to be invoked by cron / a queue
 * worker every few minutes. Safe to run repeatedly.
 *
 * Required env: DATABASE_URL, POSTMARK_SERVER_TOKEN, FROM_EMAIL, FROM_NAME,
 *               PUBLIC_BASE_URL, UNSUBSCRIBE_SECRET.
 * Optional env: REPLY_TO_EMAIL, DAILY_SEND_LIMIT, SEND_WINDOW_START,
 *               SEND_WINDOW_END, SEND_WEEKDAYS.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@outreach/db";
import { MockMailer, PostmarkMailer, type Mailer } from "@outreach/mailer";
import { runSendTick, DEFAULT_SEND_WINDOW } from "@outreach/sequencer";

interface CliOptions {
  dryRun: boolean;
  batchSize: number;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      batch: { type: "string", default: "50" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm send-tick [--dry-run] [--batch=50]

Runs one pass of the email sequencer.

Options:
  --dry-run   Evaluate everything but do not send or write
  --batch     Max leads to process this tick (default: 50)
  -h, --help  Show this help
`);
    process.exit(0);
  }
  return {
    dryRun: values["dry-run"] ?? false,
    batchSize: Number(values.batch),
  };
}

function buildMailer(dryRun: boolean): Mailer {
  if (dryRun) return new MockMailer();
  const token = required("POSTMARK_SERVER_TOKEN");
  const opts = {
    serverToken: token,
    from: required("FROM_EMAIL"),
    fromName: process.env["FROM_NAME"] ?? "",
    ...(process.env["REPLY_TO_EMAIL"]
      ? { replyTo: process.env["REPLY_TO_EMAIL"] }
      : {}),
    defaultTag: "outreach",
  };
  return new PostmarkMailer(opts);
}

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

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();
  const mailer = buildMailer(opts.dryRun);

  const result = await runSendTick({
    db,
    mailer,
    fromEmail: process.env["FROM_EMAIL"] ?? "noreply@example.com",
    fromName: process.env["FROM_NAME"] ?? "Outreach",
    ...(process.env["REPLY_TO_EMAIL"]
      ? { replyTo: process.env["REPLY_TO_EMAIL"] }
      : {}),
    publicBaseUrl: process.env["PUBLIC_BASE_URL"] ?? "http://localhost:3000",
    unsubscribeSecret:
      process.env["UNSUBSCRIBE_SECRET"] ?? "dev-only-insecure",
    dailyLimit: Number(process.env["DAILY_SEND_LIMIT"] ?? "50"),
    window: buildWindow(),
    batchSize: opts.batchSize,
    dryRun: opts.dryRun,
  });

  console.log(
    `Tick: evaluated=${result.evaluated} sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`,
  );
  for (const o of result.outcomes) {
    console.log(
      `  [${o.status}] step ${o.step} -> ${o.email} ${o.reason ? `(${o.reason})` : ""}${o.messageId ? ` msg=${o.messageId}` : ""}`,
    );
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
