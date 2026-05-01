import { describe, expect, it, vi } from "vitest";
import { WebsiteScraper, extractEmails } from "./website-scraper.js";

describe("extractEmails", () => {
  it("finds mailto: addresses", () => {
    const html = '<a href="mailto:piet@kapsalon.nl">mail</a>';
    expect(extractEmails(html)).toEqual(["piet@kapsalon.nl"]);
  });

  it("finds inline plain-text addresses", () => {
    const html = "<p>Vragen? piet@kapsalon.nl of bel ons.</p>";
    expect(extractEmails(html)).toEqual(["piet@kapsalon.nl"]);
  });

  it("decodes (at) / [at] obfuscation", () => {
    expect(extractEmails("piet (at) kapsalon (dot) nl")).toEqual([
      "piet@kapsalon.nl",
    ]);
  });

  it("filters Sentry, example.com, and image-suffix noise", () => {
    const html = `
      <script src="https://o12345.ingest.sentry.io/1234"></script>
      <img alt="logo@example.com" />
      <a href="mailto:you@example.com">stub</a>
      <a href="mailto:piet@kapsalon.nl">real</a>
    `;
    expect(extractEmails(html)).toEqual(["piet@kapsalon.nl"]);
  });

  it("dedupes case-insensitively", () => {
    const html = "Piet@Kapsalon.NL piet@kapsalon.nl";
    expect(extractEmails(html)).toEqual(["piet@kapsalon.nl"]);
  });
});

describe("WebsiteScraper", () => {
  it("returns the union of emails across candidate pages", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.endsWith("/")) {
        return new Response("<html>info@kapsalon.nl</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (u.endsWith("/contact")) {
        return new Response('<a href="mailto:piet@kapsalon.nl">x</a>', {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const scraper = new WebsiteScraper({ fetchImpl });
    const emails = await scraper.findEmails("https://kapsalon.nl");
    const list = emails.map((e) => e.email).sort();
    expect(list).toEqual(["info@kapsalon.nl", "piet@kapsalon.nl"]);
    expect(emails.every((e) => e.source === "website")).toBe(true);
  });

  it("ignores non-HTML responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{"email":"piet@kapsalon.nl"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const scraper = new WebsiteScraper({ fetchImpl });
    expect(await scraper.findEmails("https://kapsalon.nl")).toEqual([]);
  });
});
