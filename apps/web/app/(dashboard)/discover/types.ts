/** Shared types between the discover server actions and the client form. */

export interface DiscoverActionResult {
  ok: boolean;
  message: string;
  /** When this is a "Run now" action, the discovery summary. */
  found?: number;
  upserted?: number;
}

export interface SavedSearchView {
  id: string;
  name: string;
  niche: string;
  city: string;
  radiusMeters: number | null;
  maxPages: number;
  scheduleEnabled: boolean;
  scheduleIntervalDays: number;
  lastRunAt: string | null;
  lastRunResult: {
    ok: boolean;
    ranAt: string;
    found?: number;
    upserted?: number;
    error?: string;
    query?: string;
    geocoded?: { lat: number; lng: number; radius: number } | null;
  } | null;
  createdAt: string;
}
