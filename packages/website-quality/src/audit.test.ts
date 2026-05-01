import { describe, expect, it, vi } from "vitest";
import {
  bucketFromScore,
  scoreFromFetch,
  WebsiteScorer,
} from "./audit.js";
import type { AuditFetchResult } from "./types.js";

const NOW = new Date("2026-05-01T00:00:00Z");

const MODERN_HTML = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico">
  <title>Kapsalon de Knipster</title>
</head>
<body>
  <main>
    <h1>Welkom</h1>
    <p>Een mooie kapper in Utrecht. Gebruik moderne CSS Grid voor de layout.</p>
    <p>${"Lorem ipsum ".repeat(200)}</p>
    <footer>© 2026 Kapsalon de Knipster</footer>
  </main>
</body>
</html>`;

const ANCIENT_HTML = `<html>
<head>
  <title>Old salon</title>
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <script src="jquery-1.4.2.min.js"></script>
</head>
<body>
  <table width="100%"><tr><td>
    <table><tr><td>
      Welcome to our 1998 website
    </td></tr></table>
  </td></tr></table>
  <table></table>
  <table></table>
  <embed type="application/x-shockwave-flash" src="intro.swf">
  <p>© 2008 Old salon</p>
</body>
</html>`;

function fakeFetch(htmlLower: string, overrides = {}): AuditFetchResult {
  return {
    finalUrl: "https://kapsalon.nl/",
    status: 200,
    redirected: false,
    isHttps: true,
    httpsWorks: true,
    htmlLower: htmlLower.toLowerCase(),
    durationMs: 100,
    ...overrides,
  };
}

describe("scoreFromFetch", () => {
  it("scores a modern site as 'good' with no signals", () => {
    const r = scoreFromFetch(
      "https://kapsalon.nl/",
      fakeFetch(MODERN_HTML),
      NOW,
    );
    expect(r.signals).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.bucket).toBe("good");
  });

  it("scores an ancient site as 'outdated' with multiple signals", () => {
    const r = scoreFromFetch(
      "https://kapsalon.nl/",
      fakeFetch(ANCIENT_HTML),
      NOW,
    );
    const keys = r.signals.map((s) => s.key);
    expect(keys).toContain("missing_viewport_meta");
    expect(keys).toContain("table_layout");
    expect(keys).toContain("old_jquery");
    expect(keys).toContain("flash_object");
    expect(keys).toContain("ie_only_meta");
    expect(keys).toContain("no_favicon");
    expect(keys).toContain("no_doctype");
    expect(keys).toContain("stale_copyright_year");
    expect(r.bucket).toBe("outdated");
    expect(r.score).toBeLessThan(50);
  });

  it("treats HTTP 4xx/5xx as outdated/unreachable", () => {
    const r = scoreFromFetch(
      "https://kapsalon.nl/",
      fakeFetch(MODERN_HTML, { status: 503 }),
      NOW,
    );
    expect(r.bucket).toBe("outdated");
    expect(r.signals[0]?.key).toBe("unreachable");
  });
});

describe("bucketFromScore", () => {
  it("partitions correctly", () => {
    expect(bucketFromScore(0)).toBe("outdated");
    expect(bucketFromScore(40)).toBe("outdated");
    expect(bucketFromScore(50)).toBe("decent");
    expect(bucketFromScore(79)).toBe("decent");
    expect(bucketFromScore(80)).toBe("good");
    expect(bucketFromScore(100)).toBe("good");
  });
});

describe("WebsiteScorer.audit", () => {
  it("returns 'unreachable' when fetch fails entirely", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const scorer = new WebsiteScorer({ fetchImpl, now: NOW });
    const r = await scorer.audit("https://nonexistent.test/");
    expect(r.reachable).toBe(false);
    expect(r.signals[0]?.key).toBe("unreachable");
  });

  it("rejects malformed URLs without making any HTTP call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const scorer = new WebsiteScorer({ fetchImpl, now: NOW });
    const r = await scorer.audit("not a url at all");
    expect(r.reachable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rolls up an end-to-end audit on a stubbed modern site", async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      // HEAD probe and GET both succeed
      const isHead = init?.method === "HEAD";
      return new Response(isHead ? "" : MODERN_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const scorer = new WebsiteScorer({ fetchImpl, now: NOW });
    const r = await scorer.audit("https://kapsalon.nl/");
    expect(r.reachable).toBe(true);
    expect(r.bucket).toBe("good");
  });
});
