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
  scheduleRepeatingDiscoverPoll,
  scheduleRepeatingEnrichPoll,
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
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm schedule-ticks [--tick-every-ms=300000] [--discover-every-ms=3600000] [--enrich-every-ms=21600000]

Registers three recurring BullMQ jobs:
  outreach-tick       (default every 5 min)  — sequencer send-tick
  outreach-discover   (default every 60 min) — saved-searches poll
  outreach-enrich     (default every 6 hr)   — backfill scrape leads
                                                missing contact info

Idempotent: re-running with the same intervals is a no-op.
`);
    process.exit(0);
  }

  const tickMs = Number(values["tick-every-ms"]);
  const discoverMs = Number(values["discover-every-ms"]);
  const enrichMs = Number(values["enrich-every-ms"]);
  await scheduleRepeatingTick({ everyMs: tickMs });
  await scheduleRepeatingDiscoverPoll({ everyMs: discoverMs });
  await scheduleRepeatingEnrichPoll({ everyMs: enrichMs });
  console.log(
    `Scheduled tick=${tickMs}ms + discover-poll=${discoverMs}ms + enrich-poll=${enrichMs}ms.`,
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
