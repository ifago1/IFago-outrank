import { Queue, type RepeatOptions } from "bullmq";
import { getRedisConnection } from "./connection.js";

/**
 * Queue names. Centralized so the worker (consumer) and the scheduler
 * (producer) reference the same constants.
 */
// BullMQ rejects queue names containing `:` (it uses colons as Redis key
// separator internally). Use `-` instead.
export const TICK_QUEUE = "outreach-tick";
export const DISCOVER_QUEUE = "outreach-discover";

export interface TickJobData {
  /** Server time the tick was scheduled at, ISO 8601. */
  scheduledAt: string;
}

export interface DiscoverJobData {
  scheduledAt: string;
}

let _tickQueue: Queue<TickJobData> | undefined;
let _discoverQueue: Queue<DiscoverJobData> | undefined;

const baseJobOpts = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 30_000 },
};

export function getTickQueue(): Queue<TickJobData> {
  if (_tickQueue) return _tickQueue;
  _tickQueue = new Queue<TickJobData>(TICK_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: baseJobOpts,
  });
  return _tickQueue;
}

export function getDiscoverQueue(): Queue<DiscoverJobData> {
  if (_discoverQueue) return _discoverQueue;
  _discoverQueue = new Queue<DiscoverJobData>(DISCOVER_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: baseJobOpts,
  });
  return _discoverQueue;
}

export interface ScheduleOptions {
  /** Frequency in ms. Different defaults for tick vs discover. */
  everyMs?: number;
  /** Override the repeatable job ID (idempotent). */
  jobId?: string;
}

/**
 * Idempotent: re-running with the same options is a no-op (BullMQ dedupes
 * repeatables by `key`, which is derived from `repeat` + `name`).
 */
export async function scheduleRepeatingTick(
  opts: ScheduleOptions = {},
): Promise<void> {
  const queue = getTickQueue();
  const repeat: RepeatOptions = { every: opts.everyMs ?? 5 * 60 * 1000 };
  await queue.add(
    "tick",
    { scheduledAt: new Date().toISOString() },
    { repeat, jobId: opts.jobId ?? "tick-repeating" },
  );
}

/**
 * Polls saved_searches table for due searches; default cadence is every
 * hour. The handler walks the table and triggers any search whose
 * interval has elapsed.
 */
export async function scheduleRepeatingDiscoverPoll(
  opts: ScheduleOptions = {},
): Promise<void> {
  const queue = getDiscoverQueue();
  const repeat: RepeatOptions = { every: opts.everyMs ?? 60 * 60 * 1000 };
  await queue.add(
    "discover-poll",
    { scheduledAt: new Date().toISOString() },
    { repeat, jobId: opts.jobId ?? "discover-poll-repeating" },
  );
}

export async function closeQueues(): Promise<void> {
  if (_tickQueue) {
    await _tickQueue.close();
    _tickQueue = undefined;
  }
  if (_discoverQueue) {
    await _discoverQueue.close();
    _discoverQueue = undefined;
  }
}

/** Backward-compat alias. */
export type ScheduleTickOptions = ScheduleOptions;
