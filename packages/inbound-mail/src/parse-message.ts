import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import type { DeliveryStatus, ParsedInboundMessage } from "./types.js";

/**
 * Convert a raw RFC822 message (Buffer or string) plus the IMAP UID into
 * the normalized shape we use for classification and matching.
 */
export async function parseMessage(
  raw: Buffer | string,
  uid: number,
): Promise<ParsedInboundMessage> {
  const parsed = await simpleParser(raw, { skipImageLinks: true });
  return normalize(parsed, uid);
}

function normalize(p: ParsedMail, uid: number): ParsedInboundMessage {
  const fromList = addressList(p.from);
  const toList = collectAddresses(p.to);

  const headers: Record<string, string> = {};
  for (const [k, v] of p.headers.entries()) {
    headers[k.toLowerCase()] = headerValueToString(v);
  }

  const text =
    p.text?.trim() ??
    (p.html ? stripHtml(p.html) : "") ??
    "";

  const attachedRfc822 = (p.attachments ?? [])
    .filter((a) => a.contentType === "message/rfc822")
    .map((a) => attachmentHeaders(a.content));

  const deliveryStatus = extractDeliveryStatus(p);

  return {
    uid,
    messageId: p.messageId ?? null,
    fromAddress: fromList[0]?.address ?? null,
    fromName: fromList[0]?.name ?? null,
    toAddresses: toList.map((a) => a.address).filter((s): s is string => !!s),
    subject: p.subject ?? null,
    text,
    date: p.date ?? new Date(),
    headers,
    attachedRfc822,
    deliveryStatus,
  };
}

function attachmentHeaders(content: Buffer): {
  messageId: string | null;
  headers: Record<string, string>;
} {
  const text = content.toString("utf8");
  // Headers end at the first blank line. We don't need the body of the
  // nested message here — the original outbound Message-ID is enough.
  const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const headers: Record<string, string> = {};
  let lastKey: string | null = null;
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^\s/.test(line) && lastKey) {
      headers[lastKey] = `${headers[lastKey] ?? ""} ${line.trim()}`.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
    lastKey = key;
  }
  const messageId = headers["message-id"] ?? null;
  return { messageId, headers };
}

function extractDeliveryStatus(p: ParsedMail): DeliveryStatus | null {
  const dsnAttachment = (p.attachments ?? []).find(
    (a) => a.contentType === "message/delivery-status",
  );
  if (!dsnAttachment) return null;

  const txt = dsnAttachment.content.toString("utf8");
  const fields = parseDsnFields(txt);
  const status = fields["status"] ?? null;
  return {
    status,
    action: fields["action"] ?? null,
    finalRecipient: cleanRecipient(fields["final-recipient"] ?? null),
    diagnosticCode: fields["diagnostic-code"] ?? null,
    isHard: typeof status === "string" && status.startsWith("5."),
  };
}

function parseDsnFields(txt: string): Record<string, string> {
  const out: Record<string, string> = {};
  let lastKey: string | null = null;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) {
      lastKey = null;
      continue;
    }
    if (/^\s/.test(line) && lastKey) {
      out[lastKey] = `${out[lastKey] ?? ""} ${line.trim()}`.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
    lastKey = key;
  }
  return out;
}

/**
 * "rfc822; user@example.com" → "user@example.com".
 * Also strips angle brackets and surrounding whitespace.
 */
function cleanRecipient(raw: string | null): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/^[a-zA-Z0-9-]+;\s*/, "").trim();
  const angle = stripped.match(/<([^>]+)>/);
  return (angle?.[1] ?? stripped).toLowerCase().trim() || null;
}

function addressList(
  v: AddressObject | AddressObject[] | undefined,
): { address: string | null; name: string | null }[] {
  return collectAddresses(v).map((a) => ({
    address: a.address ?? null,
    name: a.name ?? null,
  }));
}

function collectAddresses(
  v: AddressObject | AddressObject[] | undefined,
): { address?: string; name?: string }[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: { address?: string; name?: string }[] = [];
  for (const a of arr) {
    for (const v of a.value) {
      if (v.address) out.push({ ...(v.address ? { address: v.address.toLowerCase() } : {}), ...(v.name ? { name: v.name } : {}) });
    }
  }
  return out;
}

function headerValueToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(headerValueToString).join(", ");
  if (v && typeof v === "object" && "value" in v) {
    const value = (v as { value: unknown }).value;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(String).join(", ");
  }
  if (v == null) return "";
  return String(v);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
