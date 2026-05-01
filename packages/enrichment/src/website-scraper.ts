import type { FoundEmail } from "./types.js";
import { isSyntaxValid } from "./email-validator.js";

const CANDIDATE_PATHS = [
  "/",
  "/contact",
  "/contact.html",
  "/contact/",
  "/over-ons",
  "/about",
  "/about-us",
  "/colofon",
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Lowercase emails that we never want to use for outreach (icons, sentry,
 * dummy values commonly seen in static templates).
 */
const SKIP_PATTERNS = [
  /sentry\.io$/i,
  /example\.(com|org|net)$/i,
  /@.*\.(png|jpg|jpeg|gif|svg)$/i,
  /^you@/i,
  /^name@/i,
];

export interface WebsiteScraperOptions {
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default: 8000. */
  timeoutMs?: number;
  /** Max bytes of HTML to inspect per page. Default: 500KB. */
  maxBytes?: number;
  /** User-agent string. */
  userAgent?: string;
}

export class WebsiteScraper {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;

  constructor(opts: WebsiteScraperOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.maxBytes = opts.maxBytes ?? 500_000;
    this.userAgent =
      opts.userAgent ??
      "Mozilla/5.0 (compatible; OutreachBot/0.1; +https://example.com/bot)";
  }

  /**
   * Scrape known contact pages on `baseUrl` and return de-duplicated emails
   * found in the HTML (mailto: links and plain-text addresses).
   */
  async findEmails(baseUrl: string): Promise<FoundEmail[]> {
    const base = normalizeBase(baseUrl);
    if (!base) return [];

    const seen = new Set<string>();
    const results: FoundEmail[] = [];

    for (const path of CANDIDATE_PATHS) {
      const url = new URL(path, base).toString();
      const html = await this.fetchText(url).catch(() => null);
      if (!html) continue;

      for (const email of extractEmails(html)) {
        if (seen.has(email)) continue;
        seen.add(email);
        results.push({ email, source: "website" });
      }
    }

    return results;
  }

  private async fetchText(url: string): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": this.userAgent, Accept: "text/html,*/*" },
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
      const text = await res.text();
      return text.length > this.maxBytes ? text.slice(0, this.maxBytes) : text;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeBase(input: string): string | null {
  try {
    const u = new URL(input.startsWith("http") ? input : `https://${input}`);
    u.pathname = "/";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function extractEmails(html: string): string[] {
  // Decode obfuscation BEFORE running the regex so "piet (at) kapsalon
  // (dot) nl" still gets matched by EMAIL_RE.
  const decoded = decodeObfuscated(html);

  const mailtoMatches = Array.from(
    decoded.matchAll(/mailto:([^"'\s?>]+)/gi),
  ).map((m) => m[1]?.trim().toLowerCase() ?? "");

  const inlineMatches = Array.from(decoded.matchAll(EMAIL_RE)).map((m) =>
    m[0].toLowerCase(),
  );

  const all = [...mailtoMatches, ...inlineMatches].filter(Boolean);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const e of all) {
    if (!isSyntaxValid(e)) continue;
    if (SKIP_PATTERNS.some((re) => re.test(e))) continue;
    if (!seen.has(e)) {
      seen.add(e);
      unique.push(e);
    }
  }
  return unique;
}

/**
 * Reverse common email obfuscation: (at), [at], "x at y", (dot), [dot].
 * Applied to the whole HTML string before regex extraction.
 */
function decodeObfuscated(s: string): string {
  return s
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\(dot\)\s*/gi, ".")
    .replace(/\s*\[dot\]\s*/gi, ".");
}
