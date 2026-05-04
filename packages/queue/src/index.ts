export { getRedisConnection, closeRedis } from "./connection.js";
export {
  TICK_QUEUE,
  DISCOVER_QUEUE,
  getTickQueue,
  getDiscoverQueue,
  scheduleRepeatingTick,
  scheduleRepeatingDiscoverPoll,
  closeQueues,
} from "./queues.js";
export type {
  TickJobData,
  DiscoverJobData,
  ScheduleOptions,
  ScheduleTickOptions,
} from "./queues.js";
export { createTickWorker } from "./worker.js";
export type { CreateTickWorkerOptions } from "./worker.js";
export { createDiscoverWorker } from "./discover-worker.js";
export type { CreateDiscoverWorkerOptions } from "./discover-worker.js";
export { tryAcquire, withMutex } from "./lock.js";
export type { MutexHandle, MutexOptions } from "./lock.js";
