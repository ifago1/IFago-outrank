import { type Db, getSetting } from "@outreach/db";
import type { ImapConnectionConfig } from "@outreach/inbound-mail";

/**
 * Build the IMAP config from settings + env. Returns null when neither
 * source has the minimum required fields (host + user + pass) — the
 * caller (worker / CLI) should treat that as "not configured" and
 * skip silently rather than crash.
 *
 * Defaults:
 *   - Host: SMTP host with `smtp` swapped to `imap` (best-effort).
 *           For mailprotect.be that yields the right server. Falls back
 *           to the same host name unchanged.
 *   - Port: 993 (TLS) when secure, 143 otherwise.
 *   - User/Pass: same as SMTP_*.
 *   - Folder: INBOX.
 */
export async function buildImapConfig(
  db: Db,
): Promise<ImapConnectionConfig | null> {
  const host =
    (await getSetting(db, "IMAP_HOST")) ??
    process.env["IMAP_HOST"] ??
    deriveImapHost(
      (await getSetting(db, "SMTP_HOST")) ?? process.env["SMTP_HOST"],
    );
  const user =
    (await getSetting(db, "IMAP_USER")) ??
    process.env["IMAP_USER"] ??
    (await getSetting(db, "SMTP_USER")) ??
    process.env["SMTP_USER"];
  const pass =
    (await getSetting(db, "IMAP_PASS")) ??
    process.env["IMAP_PASS"] ??
    (await getSetting(db, "SMTP_PASS")) ??
    process.env["SMTP_PASS"];

  if (!host || !user || !pass) return null;

  const portRaw =
    (await getSetting(db, "IMAP_PORT")) ?? process.env["IMAP_PORT"];
  const secureRaw =
    (await getSetting(db, "IMAP_SECURE")) ?? process.env["IMAP_SECURE"];
  const folder =
    (await getSetting(db, "IMAP_FOLDER")) ??
    process.env["IMAP_FOLDER"] ??
    "INBOX";

  const port = portRaw ? Number(portRaw) : 993;
  const secure = secureRaw ? secureRaw === "true" : port === 993;

  return { host, port, secure, user, pass, folder };
}

function deriveImapHost(smtpHost: string | undefined): string | undefined {
  if (!smtpHost) return undefined;
  if (smtpHost.startsWith("smtp.")) return `imap.${smtpHost.slice(5)}`;
  if (smtpHost.startsWith("smtp-")) return smtpHost.replace(/^smtp-/, "imap-");
  return smtpHost;
}
