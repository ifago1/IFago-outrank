import { describe, expect, it, vi } from "vitest";
import { Geocoder } from "./client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Geocoder", () => {
  it("requires an API key", () => {
    expect(() => new Geocoder({ apiKey: "" })).toThrow(/apiKey/);
  });

  it("resolves a city to lat/lng with the right query params", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: "OK",
        results: [
          {
            formatted_address: "Utrecht, Nederland",
            place_id: "ChIJxyz",
            geometry: { location: { lat: 52.0907, lng: 5.1214 } },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const g = new Geocoder({ apiKey: "k", fetchImpl });
    const result = await g.geocode("Utrecht");
    expect(result).toEqual({
      latitude: 52.0907,
      longitude: 5.1214,
      formattedAddress: "Utrecht, Nederland",
      placeId: "ChIJxyz",
    });
    const url = new URL(
      ((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0]?.[0] ?? "") as string,
    );
    expect(url.searchParams.get("address")).toBe("Utrecht");
    expect(url.searchParams.get("key")).toBe("k");
    expect(url.searchParams.get("region")).toBe("nl");
  });

  it("returns null on ZERO_RESULTS", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: "ZERO_RESULTS", results: [] }),
    ) as unknown as typeof fetch;
    const g = new Geocoder({ apiKey: "k", fetchImpl });
    expect(await g.geocode("Atlantis")).toBeNull();
  });

  it("throws on REQUEST_DENIED with the API's error_message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: "REQUEST_DENIED",
        error_message: "API key is invalid",
        results: [],
      }),
    ) as unknown as typeof fetch;
    const g = new Geocoder({ apiKey: "k", fetchImpl });
    await expect(g.geocode("Utrecht")).rejects.toThrow(
      /REQUEST_DENIED.*API key is invalid/,
    );
  });

  it("rejects empty input without making a network call", async () => {
    const fetchImpl = vi.fn();
    const g = new Geocoder({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(g.geocode("  ")).rejects.toThrow(/non-empty/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
