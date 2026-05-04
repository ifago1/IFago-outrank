import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed unsubscribe tokens.
 *
 * Wire format: `<b64url-email>.<iat-base36>.<sig>`
 *  - email: URL-safe base64 of the lowercased address
 *  - iat:   issued-at as base36 unix-seconds (compact + opaque-looking)
 *  - sig:   HMAC-SHA256 over `<email>.<iat>`
 *
 * No DB lookup needed to redeem — the signature alone proves
 * authenticity. Backwards-compatible with old tokens that lacked the
 * `iat` segment (those still verify but never expire).
 */

const SEP = ".";
const DEFAULT_MAX_AGE_SECONDS = 90 * 24 * 60 * 60; // 90 days

export function signUnsubscribeToken(email: string, secret: string): string {
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is empty");
  const normalized = email.trim().toLowerCase();
  const payload = b64url(Buffer.from(normalized, "utf8"));
  const iat = Math.floor(Date.now() / 1000).toString(36);
  const signed = `${payload}${SEP}${iat}`;
  const sig = b64url(createHmac("sha256", secret).update(signed).digest());
  return `${signed}${SEP}${sig}`;
}

export interface VerifyOptions {
  /**
   * Reject tokens older than this many seconds. Default 90 days. Pass
   * `Infinity` to disable expiry checks.
   */
  maxAgeSeconds?: number;
  /** For tests: override "now" (unix seconds). */
  now?: number;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
  opts: VerifyOptions = {},
):
  | { valid: true; email: string; issuedAt: number | null }
  | { valid: false; reason: string } {
  if (!secret) return { valid: false, reason: "no secret configured" };
  const parts = token.split(SEP);
  if (parts.length < 2) return { valid: false, reason: "malformed" };

  // Two formats:
  //  - 2 parts: <payload>.<sig>             (legacy, no iat)
  //  - 3 parts: <payload>.<iat>.<sig>       (current)
  let payload: string;
  let signed: string;
  let sig: string;
  let iatSeconds: number | null = null;

  if (parts.length === 2) {
    payload = parts[0]!;
    signed = payload;
    sig = parts[1]!;
  } else if (parts.length === 3) {
    payload = parts[0]!;
    const iatRaw = parts[1]!;
    sig = parts[2]!;
    signed = `${payload}${SEP}${iatRaw}`;
    iatSeconds = parseInt(iatRaw, 36);
    if (!Number.isFinite(iatSeconds)) {
      return { valid: false, reason: "malformed iat" };
    }
  } else {
    return { valid: false, reason: "malformed" };
  }

  const expectedSig = b64url(
    createHmac("sha256", secret).update(signed).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad signature" };
  }

  const email = Buffer.from(b64urlDecode(payload), "base64").toString("utf8");
  if (!email.includes("@")) return { valid: false, reason: "bad email" };

  // Expiry check — only when an iat is present (legacy tokens skip).
  const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (iatSeconds !== null && Number.isFinite(maxAge)) {
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    if (now - iatSeconds > maxAge) {
      return { valid: false, reason: "expired" };
    }
  }

  return { valid: true, email, issuedAt: iatSeconds };
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
