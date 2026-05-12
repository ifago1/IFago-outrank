export {
  preSendCheck,
  isInSendWindow,
  isUnsubscribed,
  isDailyLimitReached,
  startOfDay,
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

export { effectiveDailyLimit, evaluateBounceCircuit } from "./health.js";
export type {
  WarmupOptions,
  BounceCircuitOptions,
  BounceCircuitDecision,
} from "./health.js";

export {
  findMatchingCampaign,
  runAutoAssign,
  previewAutoAssign,
} from "./auto-assign.js";
export type {
  CandidateLead,
  CampaignRule,
  AutoAssignResult,
  RunAutoAssignOptions,
} from "./auto-assign.js";
