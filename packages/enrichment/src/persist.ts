import { eq, inArray } from "drizzle-orm";
import { businesses, contacts, type Business, type Db } from "@outreach/db";
import { autoAssignContacts, type AutoAssignSummary } from "./auto-assign.js";
import { EnrichmentService } from "./service.js";
import { HunterClient } from "./hunter.js";
import { WebsiteScraper } from "./website-scraper.js";
import type { EnrichmentInput, EnrichmentResult } from "./types.js";

export interface PersistedEnrichment {
  business: Pick<Business, "id" | "name" | "websiteUrl">;
  result: EnrichmentResult | null;
  /** Number of contact rows actually written this run. */
  inserted: number;
  /** IDs of newly-inserted contact rows (used by auto-assign). */
  insertedContactIds: string[];
  error: string | null;
}

export interface EnrichAndPersistOptions {
  /** Override the service (used for tests). */
  service?: EnrichmentService;
  /** Hunter API key — when omitted, only website-scrape runs. */
  hunterApiKey?: string | undefined;
  /** Parallel businesses processed at once. Default 5. */
  concurrency?: number;
  /** Skip writes; useful for `--dry-run`. */
  dryRun?: boolean;
  /**
   * After contacts are written, run auto-assign rules on the newly-
   * created contact IDs. Default true. Set to false in CLI flows where
   * the operator wants to inspect contacts before they enter campaigns.
   */
  autoAssign?: boolean;
}

/**
 * Run enrichment for a list of businesses, write any discovered emails
 * to `contacts`, and stamp `enrichment_attempted_at` on every row that
 * was processed (even when no emails were found, so the next backfill
 * run skips it). Errors per-business are captured and returned, never
 * thrown — so a flaky upstream doesn't abort a batch.
 *
 * Used by:
 *  - `pnpm enrich` CLI (manual / one-off)
 *  - `runDiscovery` (auto-enrich freshly discovered leads)
 *  - the recurring `outreach-enrich` BullMQ worker (backfill stale)
 */
export async function enrichAndPersist(
  db: Db,
  rows: readonly Pick<Business, "id" | "name" | "websiteUrl">[],
  opts: EnrichAndPersistOptions = {},
): Promise<PersistedEnrichment[]> {
  if (rows.length === 0) return [];

  const service =
    opts.service ??
    new EnrichmentService({
      scraper: new WebsiteScraper(),
      ...(opts.hunterApiKey
        ? { hunter: new HunterClient({ apiKey: opts.hunterApiKey }) }
        : {}),
    });

  const inputs: EnrichmentInput[] = rows.map((b) => ({
    businessName: b.name,
    ...(b.websiteUrl ? { websiteUrl: b.websiteUrl } : {}),
  }));

  const batch = await service.enrichBatch(inputs, {
    concurrency: opts.concurrency ?? 5,
  });

  const out: PersistedEnrichment[] = [];
  const processedIds: string[] = [];
  const allInsertedContactIds: string[] = [];

  for (let i = 0; i < batch.length; i++) {
    const b = rows[i]!;
    const r = batch[i]!;
    if (r.error) {
      out.push({
        business: b,
        result: null,
        inserted: 0,
        insertedContactIds: [],
        error: r.error,
      });
      continue;
    }
    const result = r.result!;
    let inserted = 0;
    let insertedContactIds: string[] = [];

    if (!opts.dryRun && result.emails.length > 0) {
      const insertRows = result.emails.map((e) => ({
        businessId: b.id,
        email: e.email,
        ...(e.firstName ? { firstName: e.firstName } : {}),
        ...(e.lastName ? { lastName: e.lastName } : {}),
        source: e.source,
        isVerified: true,
      }));
      const inserted_ = await db
        .insert(contacts)
        .values(insertRows)
        .onConflictDoNothing({
          target: [contacts.businessId, contacts.email],
        })
        .returning({ id: contacts.id });
      inserted = inserted_.length;
      insertedContactIds = inserted_.map((row) => row.id);
      allInsertedContactIds.push(...insertedContactIds);
    }

    processedIds.push(b.id);
    out.push({
      business: b,
      result,
      inserted,
      insertedContactIds,
      error: null,
    });
  }

  if (!opts.dryRun && processedIds.length > 0) {
    const now = new Date();
    if (processedIds.length === 1) {
      await db
        .update(businesses)
        .set({ enrichmentAttemptedAt: now })
        .where(eq(businesses.id, processedIds[0]!));
    } else {
      await db
        .update(businesses)
        .set({ enrichmentAttemptedAt: now })
        .where(inArray(businesses.id, processedIds));
    }
  }

  if (
    !opts.dryRun &&
    opts.autoAssign !== false &&
    allInsertedContactIds.length > 0
  ) {
    let assigned: AutoAssignSummary | undefined;
    try {
      assigned = await autoAssignContacts(db, allInsertedContactIds);
    } catch {
      // auto-assign mag een enrichment-run nooit doen mislukken; logged
      // op caller-niveau.
    }
    if (assigned && assigned.assigned > 0) {
      const detail = assigned.perCampaign
        .map((p) => `${p.campaignName}=${p.count}`)
        .join(", ");
      console.log(
        `[auto-assign] wrote ${assigned.assigned} lead(s) (${detail})`,
      );
    }
  }

  return out;
}
