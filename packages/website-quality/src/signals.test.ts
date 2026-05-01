import { describe, expect, it } from "vitest";
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
import type { AuditFetchResult } from "./types.js";

function fakeFetch(overrides: Partial<AuditFetchResult> = {}): AuditFetchResult {
  return {
    finalUrl: "https://kapsalon.nl/",
    status: 200,
    redirected: false,
    isHttps: true,
    httpsWorks: true,
    htmlLower: "",
    durationMs: 100,
    ...overrides,
  };
}

describe("checkHttpOnly", () => {
  it("flags non-https sites", () => {
    expect(checkHttpOnly(fakeFetch({ isHttps: false, finalUrl: "http://x/" }))?.key).toBe(
      "http_only",
    );
  });
  it("flags broken TLS", () => {
    expect(checkHttpOnly(fakeFetch({ httpsWorks: false }))?.key).toBe(
      "http_only",
    );
  });
  it("clears modern HTTPS", () => {
    expect(checkHttpOnly(fakeFetch())).toBeNull();
  });
});

describe("checkRedirectOffDomain", () => {
  it("ignores www <-> apex", () => {
    expect(
      checkRedirectOffDomain(
        fakeFetch({ redirected: true, finalUrl: "https://www.kapsalon.nl/" }),
        "https://kapsalon.nl/",
      ),
    ).toBeNull();
  });
  it("flags cross-host redirects (parked / sold domain)", () => {
    expect(
      checkRedirectOffDomain(
        fakeFetch({ redirected: true, finalUrl: "https://godaddy-park.example/" }),
        "https://kapsalon.nl/",
      )?.key,
    ).toBe("redirects_to_other_domain");
  });
});

describe("checkViewportMeta", () => {
  it("flags missing viewport", () => {
    expect(checkViewportMeta("<html><head></head></html>")?.key).toBe(
      "missing_viewport_meta",
    );
  });
  it("clears when present", () => {
    expect(
      checkViewportMeta(`<meta name="viewport" content="width=device-width">`),
    ).toBeNull();
  });
});

describe("checkTableLayout", () => {
  it("flags 4+ tables", () => {
    expect(checkTableLayout("<table><table><table><table>")?.key).toBe(
      "table_layout",
    );
  });
  it("flags nested tables even at low count", () => {
    expect(
      checkTableLayout("<table><tr><td><table></table></td></tr></table>")?.key,
    ).toBe("table_layout");
  });
  it("clears one isolated table (price list)", () => {
    expect(checkTableLayout("<table><tr><td>x</td></tr></table>")).toBeNull();
  });
});

describe("checkHeavyInlineStyles", () => {
  it("flags 25+ inline styles", () => {
    expect(checkHeavyInlineStyles("style=".repeat(30))?.key).toBe(
      "heavy_inline_styles",
    );
  });
});

describe("checkOldJquery", () => {
  it("flags jquery 1.x", () => {
    expect(checkOldJquery(`<script src="jquery-1.11.1.min.js">`)?.key).toBe(
      "old_jquery",
    );
  });
  it("clears jquery 3.x", () => {
    expect(checkOldJquery(`<script src="jquery-3.6.0.min.js">`)).toBeNull();
  });
});

describe("checkFlash", () => {
  it("flags Flash embeds", () => {
    expect(
      checkFlash(`<embed type="application/x-shockwave-flash" src="x.swf">`)
        ?.key,
    ).toBe("flash_object");
  });
});

describe("checkIeOnlyMeta", () => {
  it("flags X-UA-Compatible", () => {
    expect(
      checkIeOnlyMeta(`<meta http-equiv="X-UA-Compatible" content="IE=edge">`)
        ?.key,
    ).toBe("ie_only_meta");
  });
});

describe("checkFavicon", () => {
  it("flags missing favicon link", () => {
    expect(checkFavicon("<head></head>")?.key).toBe("no_favicon");
  });
  it("clears when present", () => {
    expect(checkFavicon(`<link rel="icon" href="/f.ico">`)).toBeNull();
  });
});

describe("checkDoctype", () => {
  it("flags missing doctype", () => {
    expect(checkDoctype("<html></html>")?.key).toBe("no_doctype");
  });
  it("clears <!DOCTYPE html>", () => {
    expect(checkDoctype("<!DOCTYPE html><html></html>")).toBeNull();
  });
});

describe("checkTinyHtml", () => {
  it("flags very small bodies", () => {
    expect(checkTinyHtml("<html></html>")?.key).toBe("tiny_html");
  });
});

describe("checkStaleCopyrightYear", () => {
  const now = new Date("2026-05-01T00:00:00Z");
  it("flags 2018 copyright in 2026", () => {
    const s = checkStaleCopyrightYear("© 2018 Kapsalon", now);
    expect(s?.key).toBe("stale_copyright_year");
  });
  it("ignores 2024+ copyrights", () => {
    expect(checkStaleCopyrightYear("© 2024 Kapsalon", now)).toBeNull();
  });
  it("uses the newest year when multiple ©-anchored years are present", () => {
    expect(
      checkStaleCopyrightYear("© 2010 Acme. Copyright 2025 Acme.", now),
    ).toBeNull();
  });
});
