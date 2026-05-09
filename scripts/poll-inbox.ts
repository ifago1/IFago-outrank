#!/usr/bin/env tsx
/**
 * CLI: pnpm poll-inbox [--limit=100] [--dry-run]
 *
 * One-shot run of the inbox-poller against the configured IMAP mailbox.
 * Reads SMTP_* / IMAP_* from .env or settings (settings wins). The same
 * code runs every 10 minutes via the BullMQ inbox-poll worker, so this
 * CLI is mainly for one-off / debugging runs.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb, getSetting } from "@outreach/db";
import { processInbox } from "@outreach/inbound-mail";
import { buildImapConfig } from "./lib/imap-config.js";

interface CliOptions {
  limit: number;
  dryRun: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "100" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm poll-inbox [--limit=100] [--dry-run]

Scans the IMAP mailbox for unread mail and matches each one to a
campaign-lead (reply or bounce). Marks processed messages \\Seen so the
next run skips them.

Options:
  --limit       Max messages to process this run (default: 100)
  --dry-run     Parse + classify but skip DB writes and don't mark \\Seen
  -h, --help    Show this help

Reads IMAP_HOST/PORT/USER/PASS/FOLDER from .env or the settings table.
Falls back to SMTP_* values when IMAP_* are unset (works for providers
where IMAP and SMTP share credentials, like mailprotect.be).
`);
    process.exit(0);
  }
  return {
    limit: Number(values.limit),
    dryRun: values["dry-run"] ?? false,
  };
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const db = getDb();

  const imap = await buildImapConfig(db);
  if (!imap) {
    console.error(
      "IMAP not configured. Set IMAP_HOST/USER/PASS in .env or in the Settings tab.",
    );
    process.exit(1);
  }

  console.log(
    `Polling ${imap.user}@${imap.host}:${imap.port} (folder=${imap.folder ?? "INBOX"})...`,
  );

  const anthropicApiKey =
    (await getSetting(db, "ANTHROPIC_API_KEY")) ??
    process.env["ANTHROPIC_API_KEY"];

  const summary = await processInbox({
    db,
    imap,
    batchSize: opts.limit,
    dryRun: opts.dryRun,
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    log: (line) => console.log(line),
  });

  console.log(
    `Done — fetched=${summary.fetched} replies=${summary.matchedReplies} bounces=${summary.matchedBounces} unsubscribed=${summary.unsubscribed} ignored=${summary.ignored} errors=${summary.errors}${opts.dryRun ? " [dry-run]" : ""}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
