export { ImapClient } from "./imap-client.js";
export type { FetchedRawMessage } from "./imap-client.js";
export { parseMessage } from "./parse-message.js";
export { classify } from "./classifier.js";
export { processInbox } from "./process-inbox.js";
export type { ProcessInboxOptions } from "./process-inbox.js";
export { ReplyTriage, heuristicTriage } from "./triage.js";
export type {
  ReplyClassification,
  ReplyTriageOptions,
  TriageInput,
  TriageResult,
} from "./triage.js";
export type {
  Classification,
  DeliveryStatus,
  ImapConnectionConfig,
  ParsedInboundMessage,
  PollSummary,
} from "./types.js";
