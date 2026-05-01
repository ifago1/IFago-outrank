export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body. Required. */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** From address override (defaults to mailer's configured from). */
  from?: string;
  fromName?: string;
  replyTo?: string;
  /**
   * Threading: when sending step N>1, set this to the Message-ID returned by
   * step 1's send so it threads as a reply.
   */
  inReplyTo?: string;
  /** RFC 2392 list-unsubscribe URL — added to headers and as a one-click HTTP unsub. */
  unsubscribeUrl?: string;
  /** Free-form key/value tags for the provider (Postmark Metadata). */
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  /** Provider-assigned message identifier — store this in emails_sent.message_id. */
  messageId: string;
  /** Provider response payload, kept for diagnostics. */
  raw?: unknown;
}

export interface Mailer {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
