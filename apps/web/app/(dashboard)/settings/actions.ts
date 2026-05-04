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
import { SECRET_PLACEHOLDER, type SaveSettingsResult } from "./types";

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
