/**
 * Quality bucket aligned with `businesses.website_quality`.
 *  - "none":     no website at all (set by the discover step, not by us)
 *  - "outdated": multiple legacy signals — likely a great outreach target
 *  - "decent":   functional and modern-ish but room for improvement
 *  - "good":     no obvious issues — these probably won't convert
 */
export type QualityBucket = "none" | "outdated" | "decent" | "good";

/** Fine-grained signals so the dashboard can show *why* something scored low. */
export type SignalKey =
  | "unreachable"
  | "http_only"
  | "redirects_to_other_domain"
  | "missing_viewport_meta"
  | "table_layout"
  | "heavy_inline_styles"
  | "old_jquery"
  | "flash_object"
  | "ie_only_meta"
  | "no_favicon"
  | "no_doctype"
  | "tiny_html"
  | "stale_copyright_year";

export interface AuditSignal {
  key: SignalKey;
  /** -100..0 — points to subtract from the perfect score. */
  weight: number;
  /** Human-friendly diagnostic, used in the dashboard. */
  label: string;
}

export interface AuditFetchResult {
  /** Final URL after following redirects. */
  finalUrl: string;
  /** HTTP status of the final response. */
  status: number;
  /** Redirected at all? */
  redirected: boolean;
  /** True if the final URL is HTTPS. */
  isHttps: boolean;
  /** True if the *initial* HTTPS request succeeded (cert validated). */
  httpsWorks: boolean;
  /** First N bytes of the body, lower-cased for case-insensitive matching. */
  htmlLower: string;
  /** Time spent in ms. */
  durationMs: number;
}

export interface WebsiteAuditResult {
  url: string;
  reachable: boolean;
  fetch?: AuditFetchResult;
  /** 0..100. 100 means we found nothing wrong. */
  score: number;
  bucket: QualityBucket;
  signals: AuditSignal[];
}
