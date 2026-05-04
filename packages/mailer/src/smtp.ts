import nodemailer from "nodemailer";
import type { Mailer, SendEmailInput, SendEmailResult } from "./types.js";

/**
 * Minimal transporter contract — keeps us decoupled from nodemailer's
 * many strict generic-laden types. Real `nodemailer.createTransport()`
 * returns something that satisfies this; tests inject a plain stub.
 */
export interface MinimalTransporter {
  sendMail(input: Record<string, unknown>): Promise<{
    messageId?: string;
    [key: string]: unknown;
  }>;
  close?: () => void;
}

export interface SmtpMailerOptions {
  /** SMTP host, e.g. "smtp.fastmail.com" or "mail.eigen-server.nl". */
  host: string;
  /** Usually 587 (STARTTLS) or 465 (implicit TLS). */
  port: number;
  user: string;
  pass: string;
  /**
   * true  -> implicit TLS from connection start (port 465).
   * false -> upgrade via STARTTLS after handshake (port 587, default).
   * Auto-detect when omitted: port === 465 -> true, anders false.
   */
  secure?: boolean;
  /** From address used as default. Overridable per send. */
  from: string;
  fromName?: string;
  replyTo?: string;
  /** Pool connections so back-to-back sends share TCP. Default true. */
  pool?: boolean;
  /** Max parallel SMTP connections. Default 5. */
  maxConnections?: number;
  /**
   * Rate limit: max `rateLimit` messages per `rateDelta` ms. Useful to
   * stay under your SMTP provider's per-second cap (Gmail = ~5/s,
   * Workspace = 10/s, generic relay varies).
   */
  rateLimit?: number;
  rateDelta?: number;
  /**
   * Test injection: pass a pre-built transporter (nodemailer's
   * jsonTransport, streamTransport, or a hand-rolled stub). When set,
   * host/port/auth are ignored.
   */
  transporter?: MinimalTransporter;
}

/**
 * SMTP-based mailer. Drop-in replacement for PostmarkMailer through the
 * shared {@link Mailer} interface.
 *
 * Synchronous SMTP errors (e.g. 550 "no such user") propagate as thrown
 * errors. Asynchronous bounces (NDRs that come back as separate emails)
 * are NOT handled — that requires IMAP polling. For cold-outreach
 * with a clean MX-validated list this is acceptable; if you need full
 * bounce coverage, prefer Postmark or layer in IMAP separately.
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: MinimalTransporter;
  private readonly from: string;
  private readonly fromName: string | undefined;
  private readonly replyTo: string | undefined;

  constructor(opts: SmtpMailerOptions) {
    if (!opts.transporter) {
      if (!opts.host) throw new Error("SmtpMailer: host required");
      if (!opts.port) throw new Error("SmtpMailer: port required");
    }
    if (!opts.from) throw new Error("SmtpMailer: from required");

    if (opts.transporter) {
      this.transporter = opts.transporter;
    } else {
      // Cast: nodemailer's TransportOptions is a giant union; the subset
      // below is what every real SMTP setup accepts.
      this.transporter = nodemailer.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure ?? opts.port === 465,
        auth: { user: opts.user, pass: opts.pass },
        pool: opts.pool ?? true,
        maxConnections: opts.maxConnections ?? 5,
        ...(opts.rateLimit
          ? {
              rateLimit: opts.rateLimit,
              rateDelta: opts.rateDelta ?? 1000,
            }
          : {}),
      } as Parameters<typeof nodemailer.createTransport>[0]) as unknown as MinimalTransporter;
    }
    this.from = opts.from;
    this.fromName = opts.fromName;
    this.replyTo = opts.replyTo;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const fromAddr = input.from ?? this.from;
    const fromName = input.fromName ?? this.fromName;
    const fromHeader = fromName ? `"${fromName}" <${fromAddr}>` : fromAddr;

    const headers: Record<string, string> = {};
    if (input.inReplyTo) {
      headers["In-Reply-To"] = input.inReplyTo;
      headers["References"] = input.inReplyTo;
    }
    if (input.unsubscribeUrl) {
      // RFC 8058 one-click unsubscribe — gmail/outlook surface this in
      // their UI as a native "Unsubscribe" button.
      headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    if (input.tags) {
      // Pass tags as X-headers so any downstream filtering / stats engine
      // can read them. Most SMTP servers preserve unknown X- headers.
      for (const [k, v] of Object.entries(input.tags)) {
        headers[`X-Outreach-${k}`] = v;
      }
    }

    const info = await this.transporter.sendMail({
      from: fromHeader,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(input.replyTo ?? this.replyTo
        ? { replyTo: input.replyTo ?? this.replyTo }
        : {}),
      headers,
    });

    // Strip <> wrappers from the Message-ID — Postmark returns it bare,
    // and we store it bare in emails_sent so reply-matching works the
    // same on both providers.
    const messageId = (info.messageId ?? "").replace(/^<|>$/g, "");

    return { messageId, raw: info };
  }

  /**
   * Close pooled SMTP connections. Call on graceful shutdown.
   * No-op when a stub transporter without `close` was injected.
   */
  async close(): Promise<void> {
    if (typeof this.transporter.close === "function") {
      this.transporter.close();
    }
  }
}
