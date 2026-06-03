#!/usr/bin/env tsx
/**
 * CLI: pnpm send-tick [--dry-run] [--batch=50]
 *
 * Runs one pass of the sequencer. Intended to be invoked manually or by
 * cron — `pnpm worker` already calls runSendTick itself, so you don't
 * normally need this when the worker service is running.
 *
 * Settings come from the DB-backed `settings` table (mailer creds, API
 * keys, send-window, etc.) with .env as fallback. --dry-run swaps the
 * mailer for an in-memory stub so you can smoke-test without sending.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@outreach/db";
import { MockMailer } from "@outreach/mailer";
import { runSendTick } from "@outreach/sequencer";
import { loadConfigOrExit } from "@outreach/config";
import { buildRuntimeConfig } from "./lib/runtime-config.js";

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

  const config = await buildRuntimeConfig({
    db,
    unsubscribeSecret: cfg.UNSUBSCRIBE_SECRET,
    batchSize: opts.batchSize,
    dryRun: opts.dryRun,
    ...(opts.dryRun ? { mailerOverride: new MockMailer() } : {}),
  });

  const result = await runSendTick(config);

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
