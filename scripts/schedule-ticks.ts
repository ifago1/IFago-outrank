#!/usr/bin/env tsx
/**
 * Idempotent: registers the recurring tick job in BullMQ. Safe to run on
 * every deploy. Default interval: every 5 minutes (override with --every-ms).
 *
 * Required env: REDIS_URL.
 */
import { parseArgs } from "node:util";
import {
  closeQueues,
  closeRedis,
  scheduleRepeatingDigest,
  scheduleRepeatingDiscoverPoll,
  scheduleRepeatingEnrichPoll,
  scheduleRepeatingInboxPoll,
  scheduleRepeatingTick,
} from "@outreach/queue";
import { loadConfigOrExit } from "@outreach/config";

async function main(): Promise<void> {
  loadConfigOrExit("schedule-ticks");
  const { values } = parseArgs({
    options: {
      "tick-every-ms": { type: "string", default: String(5 * 60 * 1000) },
      "discover-every-ms": {
        type: "string",
        default: String(60 * 60 * 1000),
      },
      "enrich-every-ms": {
        type: "string",
        default: String(6 * 60 * 60 * 1000),
      },
      "inbox-every-ms": {
        type: "string",
        default: String(10 * 60 * 1000),
      },
      "digest-pattern": {
        type: "string",
        default: "0 8 * * *",
      },
      "digest-tz": { type: "string", default: "Europe/Amsterdam" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm schedule-ticks [--tick-every-ms=300000] [--discover-every-ms=3600000] [--enrich-every-ms=21600000] [--inbox-every-ms=600000] [--digest-pattern="0 8 * * *"] [--digest-tz=Europe/Amsterdam]

Registers five recurring BullMQ jobs:
  outreach-tick       (default every 5 min)  — sequencer send-tick
  outreach-discover   (default every 60 min) — saved-searches poll
  outreach-enrich     (default every 6 hr)   — backfill scrape leads
                                                missing contact info
  outreach-inbox      (default every 10 min) — IMAP poll for replies +
                                                bounces
  outreach-digest     (default 08:00 Europe/Amsterdam, weekdays via cron)
                                              — daily KPI digest mail

Idempotent: re-running with the same intervals/patterns is a no-op.
`);
    process.exit(0);
  }

  const tickMs = Number(values["tick-every-ms"]);
  const discoverMs = Number(values["discover-every-ms"]);
  const enrichMs = Number(values["enrich-every-ms"]);
  const inboxMs = Number(values["inbox-every-ms"]);
  const digestPattern = String(values["digest-pattern"]);
  const digestTz = String(values["digest-tz"]);
  await scheduleRepeatingTick({ everyMs: tickMs });
  await scheduleRepeatingDiscoverPoll({ everyMs: discoverMs });
  await scheduleRepeatingEnrichPoll({ everyMs: enrichMs });
  await scheduleRepeatingInboxPoll({ everyMs: inboxMs });
  await scheduleRepeatingDigest({ pattern: digestPattern, tz: digestTz });
  console.log(
    `Scheduled tick=${tickMs}ms + discover=${discoverMs}ms + enrich=${enrichMs}ms + inbox=${inboxMs}ms + digest='${digestPattern}' (${digestTz}).`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await closeRedis();
  });
