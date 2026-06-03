import IORedis, { type RedisOptions } from "ioredis";

/**
 * Single shared Redis connection for BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` so blocking commands (BRPOPLPUSH, etc.)
 * don't get aborted mid-wait.
 */
let _connection: IORedis | undefined;

export function getRedisConnection(url?: string): IORedis {
  if (_connection) return _connection;
  const redisUrl = url ?? process.env["REDIS_URL"];
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }
  const opts: RedisOptions = { maxRetriesPerRequest: null };
  _connection = new IORedis(redisUrl, opts);
  return _connection;
}

export async function closeRedis(): Promise<void> {
  if (_connection) {
    await _connection.quit().catch(() => {
      /* swallow — connection may already be closed */
    });
    _connection = undefined;
  }
}
