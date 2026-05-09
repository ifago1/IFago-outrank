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

export { pickWeighted } from "./variant-selector.js";
export type { Weighted } from "./variant-selector.js";

export {
  pickThompson,
  sampleBeta,
  sampleGamma,
} from "./thompson-sampler.js";
export type {
  ThompsonItem,
  ThompsonOptions,
  VariantStats,
} from "./thompson-sampler.js";

export {
  effectiveDailyLimit,
  evaluateBounceCircuit,
  adjustForHealth,
} from "./health.js";

export { loadDigestStats, renderDigest } from "./digest.js";
export type { DigestStats, RenderedDigest } from "./digest.js";
export type {
  WarmupOptions,
  BounceCircuitOptions,
  BounceCircuitDecision,
  SmartWarmupOptions,
  SmartWarmupDecision,
} from "./health.js";
