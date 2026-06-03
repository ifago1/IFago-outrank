/**
 * PageSpeed Insights API client. Runs Google's hosted Lighthouse against
 * a URL and returns the four category scores (0-1). Pure HTTP call — no
 * headless browser dependency in the codebase.
 *
 * The same Google API key as Places/Geocoding works here; you must
 * enable "PageSpeed Insights API" in the GCP project. PSI is free for
 * the standard quota (~25k req/day per project).
 *
 * Docs: https://developers.google.com/speed/docs/insights/v5/get-started
 */

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export type PsiStrategy = "mobile" | "desktop";
export type PsiCategory =
  | "performance"
  | "accessibility"
  | "best-practices"
  | "seo";

export interface PsiResult {
  strategy: PsiStrategy;
  /**
   * Each category score is 0-100 (rounded from the API's 0-1 float). null
   * when PSI couldn't compute a score (often the case for accessibility on
   * dynamic pages — scoring is missing rather than 0).
   */
  scores: Record<PsiCategory, number | null>;
  /** Final URL after PSI's own redirect resolution. */
  finalUrl: string;
  /** PSI emulator user-agent string used. */
  userAgent: string;
}

export interface PsiClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Per-request timeout (ms). PSI is slow — default 60s. */
  timeoutMs?: number;
}

interface RawPsi {
  id?: string;
  lighthouseResult?: {
    finalUrl?: string;
    userAgent?: string;
    categories?: Partial<
      Record<PsiCategory, { score: number | null | undefined }>
    >;
  };
  error?: { message?: string; code?: number };
}

export class PsiClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: PsiClientOptions) {
    if (!opts.apiKey) throw new Error("PsiClient requires an apiKey");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async audit(
    url: string,
    opts: { strategy?: PsiStrategy } = {},
  ): Promise<PsiResult> {
    if (!url.trim()) throw new Error("url must be a non-empty string");
    const strategy = opts.strategy ?? "mobile";

    const target = new URL(PSI_URL);
    target.searchParams.set("url", url);
    target.searchParams.set("key", this.apiKey);
    target.searchParams.set("strategy", strategy);
    for (const c of [
      "performance",
      "accessibility",
      "best-practices",
      "seo",
    ] as const) {
      target.searchParams.append("category", c);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(target.toString(), {
        method: "GET",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PSI failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as RawPsi;
    if (json.error) {
      throw new Error(
        `PSI API error ${json.error.code ?? "?"}: ${json.error.message ?? "no detail"}`,
      );
    }
    const lh = json.lighthouseResult ?? {};
    const cats = lh.categories ?? {};
    const score = (k: PsiCategory): number | null => {
      const raw = cats[k]?.score;
      return typeof raw === "number" ? Math.round(raw * 100) : null;
    };
    return {
      strategy,
      finalUrl: lh.finalUrl ?? url,
      userAgent: lh.userAgent ?? "",
      scores: {
        performance: score("performance"),
        accessibility: score("accessibility"),
        "best-practices": score("best-practices"),
        seo: score("seo"),
      },
    };
  }
}
