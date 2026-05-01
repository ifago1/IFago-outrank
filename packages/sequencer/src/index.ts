export {
  preSendCheck,
  isInSendWindow,
  isUnsubscribed,
  isDailyLimitReached,
  DEFAULT_SEND_WINDOW,
} from "./guards.js";
export type {
  SendWindow,
  SkipReason,
  PreSendCheckInput,
} from "./guards.js";

export { runSendTick } from "./run-tick.js";
export type {
  RunTickConfig,
  TickResult,
  SendOutcome,
} from "./run-tick.js";

export {
  matchReply,
  markReplied,
  markBounced,
  extractIds,
} from "./reply-matcher.js";
export type { ReplyMatch } from "./reply-matcher.js";

export { buildPersonalObservation } from "./personalization.js";
export type { ObservationInput } from "./personalization.js";
