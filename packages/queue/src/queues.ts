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
export const ENRICH_QUEUE = "outreach-enrich";
export const INBOX_QUEUE = "outreach-inbox";
export const DIGEST_QUEUE = "outreach-digest";

export interface TickJobData {
  /** Server time the tick was scheduled at, ISO 8601. */
  scheduledAt: string;
}

export interface DiscoverJobData {
  scheduledAt: string;
}

export interface EnrichJobData {
  scheduledAt: string;
}

export interface InboxJobData {
  scheduledAt: string;
}

export interface DigestJobData {
  scheduledAt: string;
}

let _tickQueue: Queue<TickJobData> | undefined;
let _discoverQueue: Queue<DiscoverJobData> | undefined;
let _enrichQueue: Queue<EnrichJobData> | undefined;
let _inboxQueue: Queue<InboxJobData> | undefined;
let _digestQueue: Queue<DigestJobData> | undefined;

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

export function getEnrichQueue(): Queue<EnrichJobData> {
  if (_enrichQueue) return _enrichQueue;
  _enrichQueue = new Queue<EnrichJobData>(ENRICH_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: baseJobOpts,
  });
  return _enrichQueue;
}

export function getInboxQueue(): Queue<InboxJobData> {
  if (_inboxQueue) return _inboxQueue;
  _inboxQueue = new Queue<InboxJobData>(INBOX_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: baseJobOpts,
  });
  return _inboxQueue;
}

export function getDigestQueue(): Queue<DigestJobData> {
  if (_digestQueue) return _digestQueue;
  _digestQueue = new Queue<DigestJobData>(DIGEST_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: baseJobOpts,
  });
  return _digestQueue;
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

/**
 * Periodically scans `businesses` for rows with a websiteUrl that have
 * never been enriched (or whose enrichment is older than the worker's
 * stale-threshold) and runs the website-scraper / Hunter pipeline on
 * a small batch each fire. Default cadence: every 6 hours.
 */
export async function scheduleRepeatingEnrichPoll(
  opts: ScheduleOptions = {},
): Promise<void> {
  const queue = getEnrichQueue();
  const repeat: RepeatOptions = { every: opts.everyMs ?? 6 * 60 * 60 * 1000 };
  await queue.add(
    "enrich-poll",
    { scheduledAt: new Date().toISOString() },
    { repeat, jobId: opts.jobId ?? "enrich-poll-repeating" },
  );
}

/**
 * Polls the configured IMAP mailbox for unread mail and matches each
 * one against an outbound campaign-lead (reply or bounce). Default
 * cadence: every 10 minutes.
 */
export async function scheduleRepeatingInboxPoll(
  opts: ScheduleOptions = {},
): Promise<void> {
  const queue = getInboxQueue();
  const repeat: RepeatOptions = { every: opts.everyMs ?? 10 * 60 * 1000 };
  await queue.add(
    "inbox-poll",
    { scheduledAt: new Date().toISOString() },
    { repeat, jobId: opts.jobId ?? "inbox-poll-repeating" },
  );
}

export interface ScheduleDigestOptions {
  /** Cron expression. Default "0 8 * * *" — every day at 08:00. */
  pattern?: string;
  /** IANA timezone for the cron schedule. Default "Europe/Amsterdam". */
  tz?: string;
  jobId?: string;
}

/**
 * Daily KPI digest — composes a summary of the previous 24h and emails
 * it to NOTIFY_EMAIL (or FROM_EMAIL when not set). Defaults to fire
 * every day at 08:00 Europe/Amsterdam.
 */
export async function scheduleRepeatingDigest(
  opts: ScheduleDigestOptions = {},
): Promise<void> {
  const queue = getDigestQueue();
  const repeat: RepeatOptions = {
    pattern: opts.pattern ?? "0 8 * * *",
    tz: opts.tz ?? "Europe/Amsterdam",
  };
  await queue.add(
    "digest",
    { scheduledAt: new Date().toISOString() },
    { repeat, jobId: opts.jobId ?? "digest-repeating" },
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
  if (_enrichQueue) {
    await _enrichQueue.close();
    _enrichQueue = undefined;
  }
  if (_inboxQueue) {
    await _inboxQueue.close();
    _inboxQueue = undefined;
  }
  if (_digestQueue) {
    await _digestQueue.close();
    _digestQueue = undefined;
  }
}

/** Backward-compat alias. */
export type ScheduleTickOptions = ScheduleOptions;
