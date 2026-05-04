import { eq } from "drizzle-orm";
import { savedSearches, type Db, type SavedSearch } from "@outreach/db";
import {
  runDiscovery,
  type DiscoveryResult,
  type GoogleKeys,
} from "./run-discovery.js";

export interface SavedSearchRunResult {
  searchId: string;
  ok: boolean;
  result?: DiscoveryResult;
  error?: string;
}

/**
 * Wrap runDiscovery() to update the saved_search row with the run
 * outcome. Always sets last_run_at, even on failure, so the scheduler
 * doesn't immediately retry a broken search.
 *
 * Accepts either a single Google API key (used for both Places +
 * Geocoding) or a {placesApiKey, geocodingApiKey} pair when you want
 * separate keys.
 */
export async function runSavedSearch(
  db: Db,
  keys: GoogleKeys | string,
  search: SavedSearch,
): Promise<SavedSearchRunResult> {
  const now = new Date();
  try {
    const result = await runDiscovery(db, keys, {
      niche: search.niche,
      city: search.city,
      ...(search.radiusMeters !== null
        ? { radiusMeters: search.radiusMeters }
        : {}),
      maxPages: search.maxPages,
    });

    await db
      .update(savedSearches)
      .set({
        lastRunAt: now,
        lastRunResult: {
          ok: true,
          ranAt: now.toISOString(),
          query: result.query,
          found: result.found,
          upserted: result.upserted,
          geocoded: result.geocoded,
        },
      })
      .where(eq(savedSearches.id, search.id));

    return { searchId: search.id, ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(savedSearches)
      .set({
        lastRunAt: now,
        lastRunResult: {
          ok: false,
          ranAt: now.toISOString(),
          error: message,
        },
      })
      .where(eq(savedSearches.id, search.id));
    return { searchId: search.id, ok: false, error: message };
  }
}

/**
 * Pure helper: filters saved searches that are due to run based on
 * `last_run_at + interval_days < now()`. Disabled searches are skipped.
 */
export function pickDueSearches(
  searches: readonly SavedSearch[],
  now: Date,
): SavedSearch[] {
  return searches.filter((s) => {
    if (!s.scheduleEnabled) return false;
    if (!s.lastRunAt) return true;
    const intervalMs = s.scheduleIntervalDays * 24 * 60 * 60 * 1000;
    const last = new Date(s.lastRunAt as unknown as string).getTime();
    return now.getTime() - last >= intervalMs;
  });
}
