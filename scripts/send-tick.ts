#!/usr/bin/env tsx
/**
 * CLI: pnpm send-tick [--dry-run] [--batch=50]
 *
 * Runs one pass of the sequencer. Intended to be invoked by cron / a queue
 * worker every few minutes. Safe to run repeatedly.
 *
 * Env requirements are validated by @outreach/config; in --dry-run mode
 * we relax the requirements so you can smoke-test without real Postmark
 * credentials.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@outreach/db";
import { MockMailer, PostmarkMailer, type Mailer } from "@outreach/mailer";
import { runSendTick, DEFAULT_SEND_WINDOW } from "@outreach/sequencer";
import { AnthropicPersonalizer } from "@outreach/ai-personalization";
import { loadConfigOrExit } from "@outreach/config";

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

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const cfg = loadConfigOrExit("send-tick");
  const db = getDb();
  const mailer: Mailer = opts.dryRun
    ? new MockMailer()
    : new PostmarkMailer({
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

  const window = {
    startHour: cfg.SEND_WINDOW_START ?? DEFAULT_SEND_WINDOW.startHour,
    endHour: cfg.SEND_WINDOW_END ?? DEFAULT_SEND_WINDOW.endHour,
    weekdays: cfg.SEND_WEEKDAYS
      ? cfg.SEND_WEEKDAYS.split(",").map((s) => Number(s.trim()))
      : DEFAULT_SEND_WINDOW.weekdays,
  };

  const result = await runSendTick({
    db,
    mailer,
    fromEmail: cfg.FROM_EMAIL,
    fromName: cfg.FROM_NAME,
    ...(cfg.REPLY_TO_EMAIL ? { replyTo: cfg.REPLY_TO_EMAIL } : {}),
    publicBaseUrl: cfg.PUBLIC_BASE_URL,
    unsubscribeSecret: cfg.UNSUBSCRIBE_SECRET,
    dailyLimit: cfg.DAILY_SEND_LIMIT ?? 50,
    window,
    batchSize: opts.batchSize,
    dryRun: opts.dryRun,
    personalizer,
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
