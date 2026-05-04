import { describe, expect, it, vi } from "vitest";
import { PlacesClient, normalizePlace } from "./client.js";

const SAMPLE_RESPONSE = {
  places: [
    {
      id: "places/ChIJabc123",
      displayName: { text: "Kapsalon de Knipster" },
      primaryType: "hair_salon",
      primaryTypeDisplayName: { text: "Kapper" },
      formattedAddress: "Voorstraat 1, 3512 AA Utrecht, Nederland",
      addressComponents: [
        { types: ["locality", "political"], longText: "Utrecht", shortText: "Utrecht" },
        { types: ["country", "political"], longText: "Nederland", shortText: "NL" },
      ],
      internationalPhoneNumber: "+31 30 123 4567",
      nationalPhoneNumber: "030 123 4567",
      websiteUri: "https://kapsalondeknipster.nl",
      rating: 4.6,
      userRatingCount: 84,
    },
    {
      id: "places/ChIJxyz789",
      displayName: { text: "Salon Zonder Site" },
      primaryType: "hair_salon",
      formattedAddress: "Hoofdstraat 5, 3512 AA Utrecht, Nederland",
      addressComponents: [
        { types: ["locality"], longText: "Utrecht" },
        { types: ["country"], longText: "Nederland" },
      ],
      // no website, no phone -- exactly the kind of lead we want
      rating: 4.1,
      userRatingCount: 12,
    },
  ],
};

function mockFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("PlacesClient", () => {
  it("requires an API key", () => {
    expect(() => new PlacesClient({ apiKey: "" })).toThrow(/apiKey/);
  });

  it("rejects empty queries without calling the API", async () => {
    const fetchImpl = vi.fn();
    const client = new PlacesClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.searchBusinesses({ query: "  " })).rejects.toThrow(
      /non-empty/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the correct headers, body and field mask", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ places: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const client = new PlacesClient({ apiKey: "test-key", fetchImpl });
    await client.searchBusinesses({
      query: "kapper",
      locationBias: {
        center: { latitude: 52.0907, longitude: 5.1214 },
        radiusMeters: 5000,
      },
      pageSize: 10,
    });

    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect(call?.[0]).toBe("https://places.googleapis.com/v1/places:searchText");

    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toContain("places.id");
    expect(headers["X-Goog-FieldMask"]).toContain("places.websiteUri");
    expect(headers["Content-Type"]).toBe("application/json");

    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed["textQuery"]).toBe("kapper");
    expect(parsed["languageCode"]).toBe("nl");
    expect(parsed["regionCode"]).toBe("NL");
    expect(parsed["pageSize"]).toBe(10);
    expect(parsed["locationBias"]).toEqual({
      circle: {
        center: { latitude: 52.0907, longitude: 5.1214 },
        radius: 5000,
      },
    });
  });

  it("clamps pageSize to the API maximum of 20", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ places: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const client = new PlacesClient({ apiKey: "k", fetchImpl });
    await client.searchBusinesses({ query: "kapper", pageSize: 999 });

    const init = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[1] as RequestInit;
    const parsed = JSON.parse(init.body as string) as { pageSize: number };
    expect(parsed.pageSize).toBe(20);
  });

  it("maps API responses to normalized PlaceResult objects", async () => {
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: mockFetchOk(SAMPLE_RESPONSE),
    });

    const results = await client.searchBusinesses({ query: "kapper" });
    expect(results).toHaveLength(2);

    const [first, second] = results;
    expect(first?.placeId).toBe("ChIJabc123");
    expect(first?.id).toBe("places/ChIJabc123");
    expect(first?.displayName).toBe("Kapsalon de Knipster");
    expect(first?.city).toBe("Utrecht");
    expect(first?.country).toBe("Nederland");
    expect(first?.phone).toBe("+31 30 123 4567");
    expect(first?.websiteUrl).toBe("https://kapsalondeknipster.nl");
    expect(first?.rating).toBe(4.6);
    expect(first?.userRatingCount).toBe(84);

    // exactly the lead type we care about: no website
    expect(second?.websiteUrl).toBeNull();
    expect(second?.phone).toBeNull();
  });

  it("throws a PlacesError with status + body on non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("PERMISSION_DENIED", { status: 403 }),
    ) as unknown as typeof fetch;

    const client = new PlacesClient({ apiKey: "k", fetchImpl });
    await expect(
      client.searchBusinesses({ query: "kapper" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("403"),
      status: 403,
      body: "PERMISSION_DENIED",
    });
  });
});

describe("normalizePlace", () => {
  it("preserves the raw payload for storage", () => {
    const raw = SAMPLE_RESPONSE.places[0]!;
    const normalized = normalizePlace(raw);
    expect(normalized.raw).toBe(raw);
  });

  it("falls back gracefully when fields are missing", () => {
    const normalized = normalizePlace({ id: "places/abc" });
    expect(normalized.placeId).toBe("abc");
    expect(normalized.displayName).toBe("");
    expect(normalized.city).toBeNull();
    expect(normalized.country).toBeNull();
    expect(normalized.websiteUrl).toBeNull();
  });

  it("prefers locality, then postal_town, then admin_area_level_2", () => {
    const normalized = normalizePlace({
      id: "places/abc",
      addressComponents: [
        { types: ["administrative_area_level_2"], longText: "Provincie" },
        { types: ["postal_town"], longText: "Stad-X" },
      ],
    });
    expect(normalized.city).toBe("Stad-X");
  });
});
