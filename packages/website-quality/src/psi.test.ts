import { describe, expect, it, vi } from "vitest";
import { PsiClient } from "./psi.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("PsiClient", () => {
  it("requires an API key", () => {
    expect(() => new PsiClient({ apiKey: "" })).toThrow(/apiKey/);
  });

  it("rejects empty input without an HTTP call", async () => {
    const fetchImpl = vi.fn();
    const client = new PsiClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.audit("  ")).rejects.toThrow(/non-empty/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends url, key, strategy + all four categories", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        lighthouseResult: {
          finalUrl: "https://kapsalon.nl/",
          userAgent: "Chrome/x",
          categories: {
            performance: { score: 0.92 },
            accessibility: { score: 0.81 },
            "best-practices": { score: 0.96 },
            seo: { score: 1 },
          },
        },
      }),
    ) as unknown as typeof fetch;

    const client = new PsiClient({ apiKey: "k", fetchImpl });
    const r = await client.audit("https://kapsalon.nl/", { strategy: "desktop" });

    expect(r).toEqual({
      strategy: "desktop",
      finalUrl: "https://kapsalon.nl/",
      userAgent: "Chrome/x",
      scores: {
        performance: 92,
        accessibility: 81,
        "best-practices": 96,
        seo: 100,
      },
    });

    const url = new URL(
      ((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] ?? "") as string,
    );
    expect(url.searchParams.get("url")).toBe("https://kapsalon.nl/");
    expect(url.searchParams.get("key")).toBe("k");
    expect(url.searchParams.get("strategy")).toBe("desktop");
    expect(url.searchParams.getAll("category")).toEqual([
      "performance",
      "accessibility",
      "best-practices",
      "seo",
    ]);
  });

  it("returns null for missing category scores instead of 0", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        lighthouseResult: {
          finalUrl: "https://kapsalon.nl/",
          categories: {
            performance: { score: 0.5 },
            accessibility: { score: null },
            // best-practices + seo absent entirely
          },
        },
      }),
    ) as unknown as typeof fetch;

    const client = new PsiClient({ apiKey: "k", fetchImpl });
    const r = await client.audit("https://kapsalon.nl/");
    expect(r.scores.performance).toBe(50);
    expect(r.scores.accessibility).toBeNull();
    expect(r.scores["best-practices"]).toBeNull();
    expect(r.scores.seo).toBeNull();
  });

  it("throws on non-2xx PSI responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("quota exceeded", { status: 429 }),
    ) as unknown as typeof fetch;
    const client = new PsiClient({ apiKey: "k", fetchImpl });
    await expect(client.audit("https://kapsalon.nl/")).rejects.toThrow(/429/);
  });

  it("surfaces PSI's own error envelope when status=200 + error body", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 500, message: "internal" } }),
    ) as unknown as typeof fetch;
    const client = new PsiClient({ apiKey: "k", fetchImpl });
    await expect(client.audit("https://kapsalon.nl/")).rejects.toThrow(
      /500.*internal/,
    );
  });
});
