import { desc } from "drizzle-orm";
import { getDb, savedSearches } from "@outreach/db";
import { PageHeader } from "../_ui";
import { DiscoverClient } from "./discover-client";
import type { SavedSearchView } from "./types";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedSearches)
    .orderBy(desc(savedSearches.createdAt));

  const searches: SavedSearchView[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    niche: r.niche,
    city: r.city,
    radiusMeters: r.radiusMeters,
    maxPages: r.maxPages,
    scheduleEnabled: r.scheduleEnabled,
    scheduleIntervalDays: r.scheduleIntervalDays,
    lastRunAt:
      r.lastRunAt instanceof Date ? r.lastRunAt.toISOString() : (r.lastRunAt as unknown as string | null),
    lastRunResult: (r.lastRunResult as SavedSearchView["lastRunResult"]) ?? null,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt as unknown as string),
  }));

  return (
    <>
      <PageHeader
        title="Discover"
        subtitle="Definieer welke leads het platform automatisch zoekt. De scheduler checkt elk uur welke saved searches op vervaltijd staan en runt ze."
      />
      <DiscoverClient searches={searches} />
    </>
  );
}
