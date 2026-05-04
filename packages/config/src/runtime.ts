import {
  SETTING_KEYS,
  getSettings,
  type SettingKey,
  type Db,
} from "@outreach/db";

/**
 * Merge env vars with DB settings. DB wins — that's the whole point of
 * the dashboard Settings tab. Returns a plain object that callers can
 * destructure with the same field names they used to use directly from
 * process.env.
 *
 * Cheap: one indexed SELECT per call, returns ≤30 rows. Safe to call
 * per-request in web routes and per-tick in workers.
 */
export async function resolveRuntimeSettings(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<SettingKey, string | undefined>> {
  const dbSettings = await getSettings(db);
  const out = {} as Record<SettingKey, string | undefined>;
  for (const key of SETTING_KEYS) {
    out[key] = dbSettings.get(key) ?? env[key];
  }
  return out;
}

/**
 * Snapshot of env-only-from-process.env values keyed the same way as
 * resolveRuntimeSettings. Used by the dashboard /settings page to
 * surface "what's the env-fallback?" alongside the DB-stored value.
 */
export function envSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Record<SettingKey, string | undefined> {
  const out = {} as Record<SettingKey, string | undefined>;
  for (const key of SETTING_KEYS) {
    out[key] = env[key];
  }
  return out;
}
