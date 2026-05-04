"use server";

import { revalidatePath } from "next/cache";
import {
  deleteSetting,
  getDb,
  isSecretKey,
  isValidSettingKey,
  setSetting,
  type SettingKey,
} from "@outreach/db";
import { resolveRuntimeSettings } from "@outreach/config";
import { createMailer } from "@outreach/mailer";
import {
  SECRET_PLACEHOLDER,
  type SaveSettingsResult,
  type SendTestEmailResult,
} from "./types";

/**
 * Server action: bulk-save settings from the dashboard form. Uses a
 * key-allowlist to ignore arbitrary form fields, and skips secret
 * fields submitted with the unchanged sentinel.
 */
export async function saveSettings(
  formData: FormData,
): Promise<SaveSettingsResult> {
  const db = getDb();
  const saved: SettingKey[] = [];
  const cleared: SettingKey[] = [];
  const errors: { key: string; message: string }[] = [];

  for (const [rawKey, rawValue] of formData.entries()) {
    if (!isValidSettingKey(rawKey)) continue;
    const key = rawKey;
    const value = String(rawValue ?? "").trim();

    // Secret fields submitted unchanged — leave existing DB value alone.
    if (isSecretKey(key) && value === SECRET_PLACEHOLDER) continue;

    try {
      if (value === "") {
        await deleteSetting(db, key);
        cleared.push(key);
      } else {
        await setSetting(db, key, value);
        saved.push(key);
      }
    } catch (err) {
      errors.push({
        key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Force a fresh server render so the updated values + status pills
  // reflect on the next page load.
  revalidatePath("/settings");

  return { ok: errors.length === 0, saved, cleared, errors };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Server action: send a test email using the current (DB + env merged)
 * mailer config. Reads settings live so the just-saved values are used
 * — no service restart needed.
 */
export async function sendTestEmail(
  formData: FormData,
): Promise<SendTestEmailResult> {
  const to = String(formData.get("to") ?? "").trim();
  if (!to || !EMAIL_RE.test(to)) {
    return { ok: false, message: "Geef een geldig e-mailadres op." };
  }

  const db = getDb();
  const cfg = await resolveRuntimeSettings(db);

  const provider = (cfg.MAILER_PROVIDER as "postmark" | "smtp" | undefined) ??
    "postmark";
  const fromEmail = cfg.FROM_EMAIL;
  const fromName = cfg.FROM_NAME ?? "Outreach";

  if (!fromEmail) {
    return {
      ok: false,
      message: "FROM_EMAIL is leeg — vul eerst de Afzender-sectie in en sla op.",
    };
  }

  try {
    const mailer = (() => {
      if (provider === "smtp") {
        const missing = (
          ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"] as const
        ).filter((k) => !cfg[k]);
        if (missing.length > 0) {
          throw new Error(
            `Provider=smtp maar ontbrekende velden: ${missing.join(", ")}. Vul in en sla op.`,
          );
        }
        return createMailer({
          provider: "smtp",
          smtp: {
            host: cfg.SMTP_HOST!,
            port: Number(cfg.SMTP_PORT) || 587,
            user: cfg.SMTP_USER!,
            pass: cfg.SMTP_PASS!,
            ...(cfg.SMTP_SECURE !== undefined
              ? { secure: cfg.SMTP_SECURE === "true" }
              : {}),
            from: fromEmail,
            fromName,
            ...(cfg.REPLY_TO_EMAIL ? { replyTo: cfg.REPLY_TO_EMAIL } : {}),
          },
        });
      }
      if (!cfg.POSTMARK_SERVER_TOKEN) {
        throw new Error(
          "POSTMARK_SERVER_TOKEN is leeg — vul in en sla op, of switch naar SMTP.",
        );
      }
      return createMailer({
        provider: "postmark",
        postmark: {
          serverToken: cfg.POSTMARK_SERVER_TOKEN,
          from: fromEmail,
          fromName,
          ...(cfg.REPLY_TO_EMAIL ? { replyTo: cfg.REPLY_TO_EMAIL } : {}),
          defaultTag: "outreach-test",
        },
      });
    })();

    const ts = new Date().toISOString();
    const result = await mailer.send({
      to,
      subject: `Outreach test mail (${provider}) — ${ts}`,
      text: [
        "Dit is een test-mail vanuit het Outreach dashboard.",
        "",
        `Provider:  ${provider}`,
        `From:      ${fromName} <${fromEmail}>`,
        `Tijdstip:  ${ts}`,
        "",
        "Als je deze mail ontvangt is je SMTP/Postmark configuratie correct.",
      ].join("\n"),
      tags: { type: "test" },
    });

    return {
      ok: true,
      message: `Verzonden naar ${to} via ${provider}.`,
      ...(result.messageId ? { messageId: result.messageId } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Verzenden mislukt: ${msg}` };
  }
}
