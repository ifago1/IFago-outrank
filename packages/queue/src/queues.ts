import { Queue, type RepeatOptions } from "bullmq";
import { getRedisConnection } from "./connection.js";

/**
 * Queue names. Centralized so the worker (consumer) and the scheduler
 * (producer) reference the same constants.
 */
export const TICK_QUEUE = "outreach:tick";

export interface TickJobData {
  /** Server time the tick was scheduled at, ISO 8601. */
  scheduledAt: string;
}

/**
 * Returns the singleton tick queue. Adds the repeating job lazily — calling
 * this from a server-startup script ensures one tick per `everyMs` even
 * across pod restarts (BullMQ dedupes the repeatable by ID).
 */
let _tickQueue: Queue<TickJobData> | undefined;

export function getTickQueue(): Queue<TickJobData> {
  if (_tickQueue) return _tickQueue;
  _tickQueue = new Queue<TickJobData>(TICK_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      // Avoid Redis bloat from completed tick jobs (we run forever).
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
    },
  });
  return _tickQueue;
}

export interface ScheduleTickOptions {
  /** Tick frequency in ms. Default: every 5 minutes. */
  everyMs?: number;
  /** Override the repeatable job ID (idempotent). */
  jobId?: string;
}

/**
 * Idempotent: re-running with the same options is a no-op (BullMQ dedupes
 * repeatables by `key`, which is derived from `repeat` + `name`).
 */
export async function scheduleRepeatingTick(
  opts: ScheduleTickOptions = {},
): Promise<void> {
  const queue = getTickQueue();
  const everyMs = opts.everyMs ?? 5 * 60 * 1000;
  const repeat: RepeatOptions = { every: everyMs };
  await queue.add(
    "tick",
    { scheduledAt: new Date().toISOString() },
    {
      repeat,
      jobId: opts.jobId ?? "tick-repeating",
    },
  );
}

export async function closeQueues(): Promise<void> {
  if (_tickQueue) {
    await _tickQueue.close();
    _tickQueue = undefined;
  }
}
