import { promises as dns } from "node:dns";

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

const ROLE_PREFIXES = new Set([
  "info",
  "contact",
  "hello",
  "office",
  "support",
  "sales",
  "admin",
  "noreply",
  "no-reply",
  "klantenservice",
  "receptie",
]);

export function isSyntaxValid(email: string): boolean {
  if (typeof email !== "string") return false;
  if (email.length > 254) return false;
  return EMAIL_RE.test(email.trim());
}

export function getDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase();
  if (!local) return false;
  return ROLE_PREFIXES.has(local);
}

/**
 * Resolve MX records for the email's domain. Returns true if the domain
 * accepts mail. We treat A-record fallback as not-deliverable to reduce
 * bounce rate — this is stricter than RFC 5321 but better for cold outreach.
 */
export async function hasMxRecord(
  domain: string,
  resolver: { resolveMx?: typeof dns.resolveMx } = dns,
): Promise<boolean> {
  try {
    const records = await (resolver.resolveMx ?? dns.resolveMx)(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

export interface ValidationResult {
  email: string;
  syntaxOk: boolean;
  hasMx: boolean;
  isRole: boolean;
  isDeliverable: boolean;
}

export async function validateEmail(
  email: string,
  resolver?: { resolveMx?: typeof dns.resolveMx },
): Promise<ValidationResult> {
  const trimmed = email.trim().toLowerCase();
  const syntaxOk = isSyntaxValid(trimmed);
  if (!syntaxOk) {
    return {
      email: trimmed,
      syntaxOk: false,
      hasMx: false,
      isRole: false,
      isDeliverable: false,
    };
  }
  const domain = getDomain(trimmed);
  const hasMx = domain ? await hasMxRecord(domain, resolver) : false;
  const isRole = isRoleAddress(trimmed);
  return {
    email: trimmed,
    syntaxOk,
    hasMx,
    isRole,
    isDeliverable: syntaxOk && hasMx,
  };
}
