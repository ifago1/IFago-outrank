import { and, inArray, lt, sql } from "drizzle-orm";
import { campaignLeads, type Db } from "@outreach/db";

/**
 * Deactivate leads that have had no activity (no send, no status
 * change) for longer than `daysOld`. They go to status='completed' so
 * the sequencer skips them on future ticks. Replied / bounced /
 * already-completed leads are left alone.
 *
 * Returns the IDs of the leads that got deactivated so callers can
 * log it. Idempotent — running it twice in a row marks nothing the
 * second time.
 */
export async function deactivateStaleLeads(
  db: Db,
  daysOld: number,
  now: Date = new Date(),
): Promise<{ deactivated: string[] }> {
  if (!Number.isFinite(daysOld) || daysOld <= 0) {
    return { deactivated: [] };
  }
  const cutoff = new Date(now.getTime() - daysOld * 86_400_000);
  const rows = await db
    .update(campaignLeads)
    .set({
      status: "completed",
      lastEventAt: now,
      nextSendAt: null,
    })
    .where(
      and(
        inArray(campaignLeads.status, ["queued", "sent"]),
        lt(campaignLeads.lastEventAt, cutoff),
      ),
    )
    .returning({ id: campaignLeads.id });
  return { deactivated: rows.map((r) => r.id) };
}

/**
 * For monitoring: how many leads are eligible for deactivation right
 * now? Used by the dashboard / digest to surface "lijst loopt vol met
 * stale-leads" voor de operator de cleanup-cadans niet trip.
 */
export async function countStaleLeads(
  db: Db,
  daysOld: number,
  now: Date = new Date(),
): Promise<number> {
  if (!Number.isFinite(daysOld) || daysOld <= 0) return 0;
  const cutoff = new Date(now.getTime() - daysOld * 86_400_000);
  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(campaignLeads)
    .where(
      and(
        inArray(campaignLeads.status, ["queued", "sent"]),
        lt(campaignLeads.lastEventAt, cutoff),
      ),
    );
  return rows[0]?.count ?? 0;
}
