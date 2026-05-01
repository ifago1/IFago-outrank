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
  scheduleRepeatingTick,
} from "@outreach/queue";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "every-ms": { type: "string", default: String(5 * 60 * 1000) },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`
Usage: pnpm schedule-ticks [--every-ms=300000]

Registers the recurring "outreach:tick" job. Run once at deploy time;
re-running is a no-op (BullMQ dedupes repeatables).
`);
    process.exit(0);
  }

  await scheduleRepeatingTick({ everyMs: Number(values["every-ms"]) });
  console.log(
    `Scheduled repeating tick (every ${values["every-ms"]} ms).`,
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
