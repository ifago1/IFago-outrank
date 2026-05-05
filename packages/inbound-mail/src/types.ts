/**
 * Normalized representation of an inbound email after parsing the raw
 * RFC822 source. Sourced via mailparser; the fields here are the subset
 * we actually need for reply / bounce processing.
 */
export interface ParsedInboundMessage {
  /** UID assigned by the IMAP server, used to mark the message as seen. */
  uid: number;
  /** RFC5322 Message-ID header on this inbound message (not the original). */
  messageId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  /** Decoded plaintext body, falls back to stripped HTML. */
  text: string;
  /** Date header, falls back to internalDate. */
  date: Date;
  /** Lowercased keys, single-string values. Multi-occurrence joined by ", ". */
  headers: Record<string, string>;
  /**
   * Attached message/rfc822 parts (used for DSN bounces — the third part
   * usually contains the original outbound headers). Each entry is the
   * normalized parse of that nested message.
   */
  attachedRfc822: Array<{
    messageId: string | null;
    headers: Record<string, string>;
  }>;
  /**
   * machine-readable DSN report (Final-Recipient, Status, Diagnostic-Code).
   * Populated when a `message/delivery-status` part is present.
   */
  deliveryStatus: DeliveryStatus | null;
}

export interface DeliveryStatus {
  /** RFC3464 status code, e.g. "5.1.1" or "4.4.7". */
  status: string | null;
  /** "failed" / "delayed" / "delivered" — comes from Action field. */
  action: string | null;
  /** rfc822-cleaned bounced recipient. */
  finalRecipient: string | null;
  diagnosticCode: string | null;
  /** True for permanent failures (status starts with 5.). */
  isHard: boolean;
}

export type Classification =
  | { kind: "bounce"; isHard: boolean; recipient: string | null; originalMessageId: string | null; reason: string | null }
  | { kind: "auto-reply" }
  | { kind: "reply" }
  | { kind: "unknown" };

export interface PollSummary {
  fetched: number;
  matchedReplies: number;
  matchedBounces: number;
  unsubscribed: number;
  ignored: number;
  errors: number;
}

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** Mailbox to scan; defaults to "INBOX". */
  folder?: string;
  /** Connect / fetch timeout in ms. Default 20000. */
  timeoutMs?: number;
}
