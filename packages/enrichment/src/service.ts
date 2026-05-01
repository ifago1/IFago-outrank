import { HunterClient } from "./hunter.js";
import { WebsiteScraper } from "./website-scraper.js";
import { validateEmail, type ValidationResult } from "./email-validator.js";
import type {
  EnrichmentInput,
  EnrichmentResult,
  FoundEmail,
} from "./types.js";

export interface EnrichmentServiceOptions {
  scraper?: WebsiteScraper;
  hunter?: HunterClient | undefined;
  /** Runs MX validation on every candidate. Default true. */
  validate?: boolean;
}

export class EnrichmentService {
  private readonly scraper: WebsiteScraper;
  private readonly hunter: HunterClient | undefined;
  private readonly validate: boolean;

  constructor(opts: EnrichmentServiceOptions = {}) {
    this.scraper = opts.scraper ?? new WebsiteScraper();
    this.hunter = opts.hunter;
    this.validate = opts.validate ?? true;
  }

  /**
   * Run all available enrichment sources for one business and return the
   * deduplicated, validated set of contact emails.
   *
   * Order of sources (highest signal first):
   *  1. mailto:/inline emails on the business's own website
   *  2. Hunter domain-search (if API key + domain known)
   */
  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const warnings: string[] = [];
    const found: FoundEmail[] = [];

    if (input.websiteUrl) {
      try {
        const scraped = await this.scraper.findEmails(input.websiteUrl);
        found.push(...scraped);
      } catch (err) {
        warnings.push(`scraper: ${stringifyErr(err)}`);
      }
    }

    const domain = input.domain ?? deriveDomain(input.websiteUrl);
    if (this.hunter && domain) {
      try {
        const hunter = await this.hunter.findByDomain(domain);
        found.push(...hunter);
      } catch (err) {
        warnings.push(`hunter: ${stringifyErr(err)}`);
      }
    } else if (!this.hunter && domain) {
      warnings.push("hunter: skipped (no API key configured)");
    }

    const dedup = dedupeByEmail(found);

    let validated = dedup;
    if (this.validate) {
      const checks = await Promise.all(
        dedup.map(async (f) => ({
          found: f,
          v: await validateEmail(f.email),
        })),
      );
      validated = checks
        .filter((c) => c.v.isDeliverable)
        .map((c) => c.found);
      const dropped = checks.length - validated.length;
      if (dropped > 0) {
        warnings.push(`validator: dropped ${dropped} undeliverable address(es)`);
      }
    }

    return { emails: validated, warnings };
  }
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function dedupeByEmail(items: FoundEmail[]): FoundEmail[] {
  const seen = new Map<string, FoundEmail>();
  for (const item of items) {
    const key = item.email.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    // Prefer the entry with the most info — Hunter typically beats scraper.
    const score = (f: FoundEmail) =>
      (f.firstName ? 2 : 0) +
      (f.position ? 1 : 0) +
      (typeof f.confidence === "number" ? 1 : 0);
    if (score(item) > score(existing)) seen.set(key, item);
  }
  return [...seen.values()];
}

function deriveDomain(websiteUrl: string | undefined): string | undefined {
  if (!websiteUrl) return undefined;
  try {
    const u = new URL(
      websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`,
    );
    return u.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export type { ValidationResult };
