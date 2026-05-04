import { describe, expect, it, vi } from "vitest";
import { HunterClient } from "./hunter.js";

describe("HunterClient", () => {
  it("requires an API key", () => {
    expect(() => new HunterClient({ apiKey: "" })).toThrow(/apiKey/);
  });

  it("calls Hunter with the right query and maps the response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            domain: "kapsalon.nl",
            emails: [
              {
                value: "Piet@Kapsalon.NL",
                first_name: "Piet",
                last_name: "de Boer",
                position: "Eigenaar",
                confidence: 92,
                type: "personal",
              },
              { value: null }, // dropped
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const client = new HunterClient({ apiKey: "k", fetchImpl, limit: 5 });
    const emails = await client.findByDomain("kapsalon.nl");

    const url = new URL(
      ((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] ??
        "") as string,
    );
    expect(url.origin + url.pathname).toBe(
      "https://api.hunter.io/v2/domain-search",
    );
    expect(url.searchParams.get("domain")).toBe("kapsalon.nl");
    expect(url.searchParams.get("api_key")).toBe("k");
    expect(url.searchParams.get("limit")).toBe("5");

    expect(emails).toEqual([
      {
        email: "piet@kapsalon.nl",
        source: "hunter",
        firstName: "Piet",
        lastName: "de Boer",
        position: "Eigenaar",
        confidence: 92,
      },
    ]);
  });

  it("throws on non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch;
    const client = new HunterClient({ apiKey: "k", fetchImpl });
    await expect(client.findByDomain("kapsalon.nl")).rejects.toThrow(/429/);
  });
});
