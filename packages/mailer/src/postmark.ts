import type { Mailer, SendEmailInput, SendEmailResult } from "./types.js";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

export interface PostmarkMailerOptions {
  serverToken: string;
  from: string;
  fromName?: string;
  replyTo?: string;
  /** Tag every send with this for filtering in the Postmark dashboard. */
  defaultTag?: string;
  fetchImpl?: typeof fetch;
  /** Postmark's MessageStream — defaults to "outbound". */
  messageStream?: string;
}

interface PostmarkSendResponse {
  MessageID: string;
  ErrorCode: number;
  Message?: string;
  SubmittedAt?: string;
  To?: string;
}

export class PostmarkMailer implements Mailer {
  private readonly token: string;
  private readonly from: string;
  private readonly fromName: string | undefined;
  private readonly replyTo: string | undefined;
  private readonly defaultTag: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly messageStream: string;

  constructor(opts: PostmarkMailerOptions) {
    if (!opts.serverToken) throw new Error("Postmark serverToken required");
    if (!opts.from) throw new Error("Postmark from address required");
    this.token = opts.serverToken;
    this.from = opts.from;
    this.fromName = opts.fromName;
    this.replyTo = opts.replyTo;
    this.defaultTag = opts.defaultTag;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.messageStream = opts.messageStream ?? "outbound";
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const fromAddr = input.from ?? this.from;
    const fromName = input.fromName ?? this.fromName;
    const fromHeader = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

    const headers: Array<{ Name: string; Value: string }> = [];
    if (input.inReplyTo) {
      headers.push({ Name: "In-Reply-To", Value: input.inReplyTo });
      headers.push({ Name: "References", Value: input.inReplyTo });
    }
    if (input.unsubscribeUrl) {
      // RFC 8058 one-click unsubscribe
      headers.push({
        Name: "List-Unsubscribe",
        Value: `<${input.unsubscribeUrl}>`,
      });
      headers.push({
        Name: "List-Unsubscribe-Post",
        Value: "List-Unsubscribe=One-Click",
      });
    }

    const payload: Record<string, unknown> = {
      From: fromHeader,
      To: input.to,
      Subject: input.subject,
      TextBody: input.text,
      MessageStream: this.messageStream,
      TrackOpens: false, // outreach: skip pixel tracking by default
    };
    if (input.html) payload["HtmlBody"] = input.html;
    if (this.replyTo || input.replyTo)
      payload["ReplyTo"] = input.replyTo ?? this.replyTo;
    if (headers.length > 0) payload["Headers"] = headers;
    if (this.defaultTag) payload["Tag"] = this.defaultTag;
    if (input.tags) payload["Metadata"] = input.tags;

    const res = await this.fetchImpl(POSTMARK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.token,
      },
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => null)) as
      | PostmarkSendResponse
      | null;
    if (!res.ok || !json) {
      throw new Error(
        `Postmark send failed (${res.status}): ${json?.Message ?? "no body"}`,
      );
    }
    if (json.ErrorCode !== 0) {
      throw new Error(
        `Postmark error ${json.ErrorCode}: ${json.Message ?? "unknown"}`,
      );
    }
    return { messageId: json.MessageID, raw: json };
  }
}
