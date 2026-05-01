import type { AuditFetchResult, AuditSignal } from "./types.js";

function safeHost(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Pure heuristics over a fetched page. Each returns a signal *only* when it
 * fires. Weights are calibrated so a single "soft" signal lands in "decent",
 * but two strong ones push you to "outdated".
 */

export function checkHttpOnly(f: AuditFetchResult): AuditSignal | null {
  if (!f.isHttps) {
    return {
      key: "http_only",
      weight: -35,
      label: "Geen HTTPS",
    };
  }
  if (!f.httpsWorks) {
    return {
      key: "http_only",
      weight: -25,
      label: "HTTPS faalt (mogelijk verlopen certificaat)",
    };
  }
  return null;
}

export function checkRedirectOffDomain(
  f: AuditFetchResult,
  originalUrl: string,
): AuditSignal | null {
  if (!f.redirected) return null;
  const orig = safeHost(originalUrl);
  const final = safeHost(f.finalUrl);
  if (!orig || !final) return null;
  if (orig === final) return null;
  // ignore www <-> apex
  if (orig.replace(/^www\./, "") === final.replace(/^www\./, "")) return null;
  return {
    key: "redirects_to_other_domain",
    weight: -10,
    label: `Redirect naar andere host (${final})`,
  };
}

export function checkViewportMeta(html: string): AuditSignal | null {
  if (/<meta[^>]+name=["']?viewport["']?/i.test(html)) return null;
  return {
    key: "missing_viewport_meta",
    weight: -25,
    label: "Geen viewport meta-tag (waarschijnlijk niet mobiel-vriendelijk)",
  };
}

const TABLE_LAYOUT_RE = /<table[^>]*>/gi;

export function checkTableLayout(html: string): AuditSignal | null {
  // Modern sites use 0-1 small tables (e.g. for a price list). Layout-by-table
  // typically yields 5+, often nested.
  const count = (html.match(TABLE_LAYOUT_RE) ?? []).length;
  const hasNested = /<table[\s\S]*?<table/i.test(html);
  if (count >= 4 || hasNested) {
    return {
      key: "table_layout",
      weight: -20,
      label: `Tabel-layout (${count} <table> elementen${hasNested ? ", genest" : ""})`,
    };
  }
  return null;
}

export function checkHeavyInlineStyles(html: string): AuditSignal | null {
  const inlineCount = (html.match(/style\s*=/gi) ?? []).length;
  if (inlineCount >= 25) {
    return {
      key: "heavy_inline_styles",
      weight: -10,
      label: `Veel inline styles (${inlineCount} style="" attributes)`,
    };
  }
  return null;
}

export function checkOldJquery(html: string): AuditSignal | null {
  const m = html.match(/jquery[-.](\d+)\.(\d+)(?:\.\d+)?(?:\.min)?\.js/i);
  if (m && Number(m[1]) <= 1) {
    return {
      key: "old_jquery",
      weight: -15,
      label: `Verouderde jQuery (${m[1]}.${m[2]})`,
    };
  }
  return null;
}

export function checkFlash(html: string): AuditSignal | null {
  if (
    /application\/x-shockwave-flash/i.test(html) ||
    /<embed[^>]+\.swf/i.test(html)
  ) {
    return {
      key: "flash_object",
      weight: -25,
      label: "Flash content (Adobe Flash is end-of-life sinds 2020)",
    };
  }
  return null;
}

export function checkIeOnlyMeta(html: string): AuditSignal | null {
  // X-UA-Compatible was an IE compatibility hack
  if (/<meta[^>]+http-equiv=["']?x-ua-compatible/i.test(html)) {
    return {
      key: "ie_only_meta",
      weight: -5,
      label: "Internet Explorer compatibility meta-tag",
    };
  }
  return null;
}

export function checkFavicon(html: string): AuditSignal | null {
  if (/<link[^>]+rel=["']?(?:shortcut )?icon/i.test(html)) return null;
  return {
    key: "no_favicon",
    weight: -3,
    label: "Geen favicon",
  };
}

export function checkDoctype(html: string): AuditSignal | null {
  if (/^\s*<!doctype\s+html/i.test(html)) return null;
  return {
    key: "no_doctype",
    weight: -10,
    label: "Geen <!DOCTYPE html> (legacy quirks-mode rendering)",
  };
}

export function checkTinyHtml(html: string): AuditSignal | null {
  // Pure-Wix/Squarespace landing pages can be huge; truly empty pages are tiny.
  if (html.length < 1500) {
    return {
      key: "tiny_html",
      weight: -10,
      label: `Erg weinig HTML (${html.length} bytes)`,
    };
  }
  return null;
}

export function checkStaleCopyrightYear(
  html: string,
  now: Date = new Date(),
): AuditSignal | null {
  // Look for "© 2018", "Copyright 2019", etc. and compare to current year.
  const year = now.getFullYear();
  const matches = Array.from(
    html.matchAll(/(?:©|copyright|copr\.)\s*(\d{4})/gi),
  );
  if (matches.length === 0) return null;
  const years = matches
    .map((m) => Number(m[1]))
    .filter((y) => y >= 2000 && y <= year + 1);
  if (years.length === 0) return null;
  const newest = Math.max(...years);
  const ageYears = year - newest;
  if (ageYears >= 3) {
    return {
      key: "stale_copyright_year",
      weight: -10,
      label: `Oudste/laatste copyright is ${newest} (${ageYears} jaar geleden)`,
    };
  }
  return null;
}
