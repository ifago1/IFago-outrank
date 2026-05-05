import type { Classification, ParsedInboundMessage } from "./types.js";

/**
 * Heuristics for distinguishing real human replies from bounce DSNs and
 * vacation auto-responders. Order matters — bounce signals take priority
 * because mailer-daemons sometimes ALSO copy the In-Reply-To header.
 */
export function classify(msg: ParsedInboundMessage): Classification {
  if (looksLikeBounce(msg)) {
    return {
      kind: "bounce",
      isHard: msg.deliveryStatus?.isHard ?? guessHardFromText(msg),
      recipient: bouncedRecipient(msg),
      originalMessageId: originalMessageId(msg),
      reason: bounceReason(msg),
    };
  }
  if (looksLikeAutoReply(msg)) return { kind: "auto-reply" };

  const inReplyTo = msg.headers["in-reply-to"];
  const references = msg.headers["references"];
  if (inReplyTo || references) return { kind: "reply" };

  return { kind: "unknown" };
}

const BOUNCE_FROM_PATTERNS = [
  /mailer-daemon@/i,
  /postmaster@/i,
  /no[-_]?reply@/i,
];

const BOUNCE_SUBJECT_PATTERNS = [
  /undeliver/i,
  /returned\s+mail/i,
  /delivery\s+(status|failure)/i,
  /failure\s+notice/i,
  /mail\s+delivery\s+failed/i,
  /could\s+not\s+be\s+delivered/i,
];

function looksLikeBounce(msg: ParsedInboundMessage): boolean {
  if (msg.deliveryStatus) return true;

  // multipart/report content type is the strongest non-DSN signal.
  const ct = (msg.headers["content-type"] ?? "").toLowerCase();
  if (ct.includes("multipart/report")) return true;

  if (msg.fromAddress && BOUNCE_FROM_PATTERNS.some((re) => re.test(msg.fromAddress!))) {
    return true;
  }
  if (msg.subject && BOUNCE_SUBJECT_PATTERNS.some((re) => re.test(msg.subject!))) {
    return true;
  }
  if (msg.headers["auto-submitted"]?.toLowerCase().includes("auto-replied")) {
    // Auto-replied is typically vacation, not a bounce, so skip here.
    return false;
  }
  return false;
}

const AUTO_REPLY_HEADERS = ["x-autoreply", "x-autorespond", "x-autoresponse"];

function looksLikeAutoReply(msg: ParsedInboundMessage): boolean {
  const submitted = (msg.headers["auto-submitted"] ?? "").toLowerCase();
  if (submitted && submitted !== "no") return true;

  for (const h of AUTO_REPLY_HEADERS) {
    if (msg.headers[h]) return true;
  }

  const subject = msg.subject?.toLowerCase() ?? "";
  if (
    /out\s+of\s+office/i.test(subject) ||
    /afwezigheid|vakantie|automatisch/i.test(subject) ||
    /automatic\s+reply/i.test(subject)
  ) {
    return true;
  }
  return false;
}

function originalMessageId(msg: ParsedInboundMessage): string | null {
  for (const a of msg.attachedRfc822) {
    if (a.messageId) return stripAngles(a.messageId);
  }
  // Postfix sometimes echoes the bounced message-id in the diagnostic
  // section as `X-Postfix-Sender:` or in plain text — not reliable, skip.
  return null;
}

function bouncedRecipient(msg: ParsedInboundMessage): string | null {
  if (msg.deliveryStatus?.finalRecipient) {
    return msg.deliveryStatus.finalRecipient;
  }
  // Fallback: scan the body for a bare email address. This is best-effort
  // for non-DSN bounces (some providers send free-form failure mail).
  const m = msg.text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function bounceReason(msg: ParsedInboundMessage): string | null {
  if (msg.deliveryStatus?.diagnosticCode) {
    return msg.deliveryStatus.diagnosticCode.slice(0, 500);
  }
  if (msg.deliveryStatus?.status) return `status ${msg.deliveryStatus.status}`;
  return msg.subject ?? null;
}

function guessHardFromText(msg: ParsedInboundMessage): boolean {
  const t = msg.text.toLowerCase();
  if (/user\s+unknown|no\s+such\s+user|address\s+rejected|550\s/i.test(t)) {
    return true;
  }
  return false;
}

function stripAngles(s: string): string {
  return s.replace(/^<|>$/g, "").trim();
}
