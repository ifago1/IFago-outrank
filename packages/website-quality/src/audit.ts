import {
  checkDoctype,
  checkFavicon,
  checkFlash,
  checkHeavyInlineStyles,
  checkHttpOnly,
  checkIeOnlyMeta,
  checkOldJquery,
  checkRedirectOffDomain,
  checkStaleCopyrightYear,
  checkTableLayout,
  checkTinyHtml,
  checkViewportMeta,
} from "./signals.js";
import type {
  AuditFetchResult,
  AuditSignal,
  QualityBucket,
  WebsiteAuditResult,
} from "./types.js";

export interface WebsiteScorerOptions {
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default: 8000. */
  timeoutMs?: number;
  /** Max bytes of HTML to inspect. Default: 800 KB. */
  maxBytes?: number;
  userAgent?: string;
  /** Used by tests so the stale-copyright check is deterministic. */
  now?: Date;
}

export class WebsiteScorer {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;
  private readonly now: Date | undefined;

  constructor(opts: WebsiteScorerOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.maxBytes = opts.maxBytes ?? 800_000;
    this.userAgent =
      opts.userAgent ??
      "Mozilla/5.0 (compatible; OutreachBot/0.1; +https://example.com/bot)";
    this.now = opts.now;
  }

  async audit(rawUrl: string): Promise<WebsiteAuditResult> {
    const url = normalizeUrl(rawUrl);
    if (!url) {
      return {
        url: rawUrl,
        reachable: false,
        score: 0,
        bucket: "outdated",
        signals: [
          { key: "unreachable", weight: -100, label: "Ongeldige URL" },
        ],
      };
    }

    const fetched = await this.fetch(url);
    if (!fetched) {
      return {
        url,
        reachable: false,
        score: 0,
        bucket: "outdated",
        signals: [
          {
            key: "unreachable",
            weight: -100,
            label: "Site reageert niet (timeout, DNS, of 5xx)",
          },
        ],
      };
    }

    return scoreFromFetch(url, fetched, this.now);
  }

  private async fetch(url: string): Promise<AuditFetchResult | null> {
    const start = Date.now();

    // Probe HTTPS first to verify the cert. Even if the user-supplied URL
    // was http://, sites that handle TLS will redirect us anyway.
    const httpsUrl = url.replace(/^http:\/\//i, "https://");

    let httpsWorks = false;
    try {
      const head = await this.doFetch(httpsUrl, "HEAD");
      httpsWorks = head?.ok === true || (head?.status ?? 0) === 405;
    } catch {
      httpsWorks = false;
    }

    const finalRes = await this.doFetch(url, "GET");
    if (!finalRes) return null;

    const html = await safeReadText(finalRes, this.maxBytes);
    const finalUrl = finalRes.url || url;
    return {
      finalUrl,
      status: finalRes.status,
      redirected: finalUrl !== url,
      isHttps: finalUrl.startsWith("https://"),
      httpsWorks,
      htmlLower: html.toLowerCase(),
      durationMs: Date.now() - start,
    };
  }

  private async doFetch(
    url: string,
    method: "GET" | "HEAD",
  ): Promise<Response | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method,
        redirect: "follow",
        headers: { "User-Agent": this.userAgent, Accept: "text/html,*/*" },
        signal: ctrl.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeReadText(res: Response, max: number): Promise<string> {
  try {
    const text = await res.text();
    return text.length > max ? text.slice(0, max) : text;
  } catch {
    return "";
  }
}

export function scoreFromFetch(
  url: string,
  f: AuditFetchResult,
  now: Date | undefined = undefined,
): WebsiteAuditResult {
  const signals: AuditSignal[] = [];
  const push = (s: AuditSignal | null) => {
    if (s) signals.push(s);
  };

  if (f.status >= 400) {
    return {
      url,
      reachable: true,
      fetch: f,
      score: 0,
      bucket: "outdated",
      signals: [
        {
          key: "unreachable",
          weight: -100,
          label: `HTTP ${f.status}`,
        },
      ],
    };
  }

  push(checkHttpOnly(f));
  push(checkRedirectOffDomain(f, url));
  push(checkViewportMeta(f.htmlLower));
  push(checkTableLayout(f.htmlLower));
  push(checkHeavyInlineStyles(f.htmlLower));
  push(checkOldJquery(f.htmlLower));
  push(checkFlash(f.htmlLower));
  push(checkIeOnlyMeta(f.htmlLower));
  push(checkFavicon(f.htmlLower));
  push(checkDoctype(f.htmlLower));
  push(checkTinyHtml(f.htmlLower));
  push(checkStaleCopyrightYear(f.htmlLower, now));

  const penalty = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = clamp(100 + penalty, 0, 100);

  return {
    url,
    reachable: true,
    fetch: f,
    score,
    bucket: bucketFromScore(score),
    signals,
  };
}

export function bucketFromScore(score: number): QualityBucket {
  if (score <= 0) return "outdated";
  if (score < 50) return "outdated";
  if (score < 80) return "decent";
  return "good";
}

function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(
      input.startsWith("http") ? input : `https://${input}`,
    );
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
