import { eq, inArray } from "drizzle-orm";
import { settings, type Db } from "./index.js";

/**
 * Whitelisted setting keys — only these are accepted via the dashboard.
 * Anything outside this set is silently rejected by the form action so a
 * compromised dashboard session can't poison arbitrary env-style keys.
 *
 * Mirrors the env-var names so resolveSettings() can do a simple lookup.
 */
export const SETTING_KEYS = [
  // Mailer
  "MAILER_PROVIDER",
  "POSTMARK_SERVER_TOKEN",
  "POSTMARK_INBOUND_WEBHOOK_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SECURE",
  "SMTP_MAX_CONNECTIONS",
  "SMTP_RATE_LIMIT",
  "SMTP_RATE_DELTA_MS",
  // Sender identity
  "FROM_EMAIL",
  "FROM_NAME",
  "REPLY_TO_EMAIL",
  "PUBLIC_BASE_URL",
  // External APIs
  "GOOGLE_PLACES_API_KEY",
  "GOOGLE_GEOCODING_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_MODEL",
  "HUNTER_API_KEY",
  "PSI_API_KEY",
  // Sending hygiene
  "DAILY_SEND_LIMIT",
  "SEND_WINDOW_START",
  "SEND_WINDOW_END",
  "SEND_WEEKDAYS",
  "SEND_TIMEZONE",
  "WARMUP_DAYS",
  "WARMUP_FLOOR",
  "BOUNCE_THRESHOLD",
  "BOUNCE_WINDOW",
  "BOUNCE_MIN_SENT",
  "TICK_BATCH_SIZE",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Keys that should always be stored masked in the form. */
export const SECRET_KEYS = new Set<SettingKey>([
  "POSTMARK_SERVER_TOKEN",
  "POSTMARK_INBOUND_WEBHOOK_SECRET",
  "SMTP_PASS",
  "GOOGLE_PLACES_API_KEY",
  "GOOGLE_GEOCODING_API_KEY",
  "ANTHROPIC_API_KEY",
  "HUNTER_API_KEY",
  "PSI_API_KEY",
]);

export function isValidSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export function isSecretKey(key: SettingKey): boolean {
  return SECRET_KEYS.has(key);
}

/** Single-value lookup. Returns undefined when the key isn't set. */
export async function getSetting(
  db: Db,
  key: SettingKey,
): Promise<string | undefined> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0]?.value;
}

/**
 * Bulk fetch. Returns a Map for fast lookups + iteration in the dashboard.
 * Pass `keys` to scope to a subset (e.g. only the secrets, only mailer).
 */
export async function getSettings(
  db: Db,
  keys?: readonly SettingKey[],
): Promise<Map<SettingKey, string>> {
  const rows = keys
    ? await db
        .select()
        .from(settings)
        .where(inArray(settings.key, keys as unknown as string[]))
    : await db.select().from(settings);
  const out = new Map<SettingKey, string>();
  for (const row of rows) {
    if (isValidSettingKey(row.key)) {
      out.set(row.key, row.value);
    }
  }
  return out;
}

export async function setSetting(
  db: Db,
  key: SettingKey,
  value: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      key,
      value,
      isSecret: isSecretKey(key),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function deleteSetting(db: Db, key: SettingKey): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}
