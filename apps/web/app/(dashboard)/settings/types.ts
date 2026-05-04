/**
 * Constants + types shared between the server action and the client
 * form. Kept in their own module because "use server" files may only
 * export async functions.
 */
import type { SettingKey } from "@outreach/db";

/**
 * Sentinel inserted into the form for fields that are currently set to
 * a secret value. The form renders "••••••••" so the secret never
 * leaves the server. When the user submits the form unchanged for a
 * secret field, we receive this sentinel and skip the update.
 */
export const SECRET_PLACEHOLDER = "__OUTREACH_KEEP_CURRENT__";

export interface SaveSettingsResult {
  ok: boolean;
  saved: SettingKey[];
  cleared: SettingKey[];
  errors: { key: string; message: string }[];
}
