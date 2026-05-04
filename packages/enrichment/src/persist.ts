import { eq, inArray } from "drizzle-orm";
import { businesses, contacts, type Business, type Db } from "@outreach/db";
import { EnrichmentService } from "./service.js";
import { HunterClient } from "./hunter.js";
import { WebsiteScraper } from "./website-scraper.js";
import type { EnrichmentInput, EnrichmentResult } from "./types.js";

export interface PersistedEnrichment {
  business: Pick<Business, "id" | "name" | "websiteUrl">;
  result: EnrichmentResult | null;
  /** Number of contact rows actually written this run. */
  inserted: number;
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

  for (let i = 0; i < batch.length; i++) {
    const b = rows[i]!;
    const r = batch[i]!;
    if (r.error) {
      out.push({ business: b, result: null, inserted: 0, error: r.error });
      continue;
    }
    const result = r.result!;
    let inserted = 0;

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
    }

    processedIds.push(b.id);
    out.push({ business: b, result, inserted, error: null });
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

  return out;
}
