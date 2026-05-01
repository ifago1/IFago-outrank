import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed unsubscribe tokens. Format: `<base64url-email>.<sig>`.
 * - No DB lookup needed to redeem — the signature alone proves authenticity.
 * - Uses URL-safe base64 so the token drops cleanly into a query string.
 */

const SEP = ".";

export function signUnsubscribeToken(email: string, secret: string): string {
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is empty");
  const normalized = email.trim().toLowerCase();
  const payload = b64url(Buffer.from(normalized, "utf8"));
  const sig = b64url(
    createHmac("sha256", secret).update(payload).digest(),
  );
  return `${payload}${SEP}${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): { valid: true; email: string } | { valid: false; reason: string } {
  if (!secret) return { valid: false, reason: "no secret configured" };
  const idx = token.indexOf(SEP);
  if (idx <= 0) return { valid: false, reason: "malformed" };
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  const expectedSig = b64url(
    createHmac("sha256", secret).update(payload).digest(),
  );

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad signature" };
  }

  const email = Buffer.from(b64urlDecode(payload), "base64").toString("utf8");
  if (!email.includes("@")) return { valid: false, reason: "bad email" };
  return { valid: true, email };
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(s: string): string {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}
