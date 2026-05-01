import type Redis from "ioredis";

/**
 * Best-effort distributed lock via Redis SET NX EX. Used to ensure only
 * one tick is processing across all worker pods, even if someone
 * accidentally enqueues an extra job or runs `pnpm send-tick` while a
 * worker is also live.
 *
 * Caveats:
 *  - This is *not* a Redlock-grade distributed mutex. Don't use it for
 *    high-stakes correctness — for the sequencer it's a deduper.
 *  - We delete the key on release with a value-check Lua script so we
 *    never delete someone else's lock if our TTL expired mid-operation.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface MutexHandle {
  release: () => Promise<void>;
}

export interface MutexOptions {
  /** Lock key, e.g. "outreach:tick-lock". */
  key: string;
  /**
   * Lock TTL in seconds. Should comfortably exceed the longest expected
   * tick duration. Default 600s (10 minutes).
   */
  ttlSeconds?: number;
}

export async function tryAcquire(
  redis: Redis,
  opts: MutexOptions,
): Promise<MutexHandle | null> {
  const ttl = opts.ttlSeconds ?? 600;
  // Random per-acquire token so we only release our own lock.
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(opts.key, token, "EX", ttl, "NX");
  if (result !== "OK") return null;
  return {
    release: async () => {
      try {
        await redis.eval(RELEASE_SCRIPT, 1, opts.key, token);
      } catch {
        /* swallow — TTL will expire it eventually */
      }
    },
  };
}

/**
 * Convenience wrapper: acquire → run → release. Returns the function's
 * result, or null if the lock was already held.
 */
export async function withMutex<T>(
  redis: Redis,
  opts: MutexOptions,
  fn: () => Promise<T>,
): Promise<T | null> {
  const handle = await tryAcquire(redis, opts);
  if (!handle) return null;
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}
