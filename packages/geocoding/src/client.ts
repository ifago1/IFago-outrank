/**
 * Thin wrapper around Google's Geocoding API. We only need the
 * "address → lat/lng" path; reverse geocoding isn't used here.
 *
 * Reuses the same Google API key as packages/places — make sure
 * "Geocoding API" is enabled in the same GCP project.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Google's formatted address, e.g. "Utrecht, Netherlands". */
  formattedAddress: string;
  /** Place ID for the geocoded location. */
  placeId: string;
}

export interface GeocoderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Default region bias, e.g. "nl". */
  defaultRegion?: string;
  /** Default language code, e.g. "nl". */
  defaultLanguage?: string;
}

interface RawGeocodeResponse {
  status:
    | "OK"
    | "ZERO_RESULTS"
    | "OVER_DAILY_LIMIT"
    | "OVER_QUERY_LIMIT"
    | "REQUEST_DENIED"
    | "INVALID_REQUEST"
    | "UNKNOWN_ERROR";
  error_message?: string;
  results: Array<{
    formatted_address: string;
    place_id: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
}

export class Geocoder {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultRegion: string;
  private readonly defaultLanguage: string;

  constructor(opts: GeocoderOptions) {
    if (!opts.apiKey) throw new Error("Geocoder requires an apiKey");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultRegion = opts.defaultRegion ?? "nl";
    this.defaultLanguage = opts.defaultLanguage ?? "nl";
  }

  /**
   * Resolve a free-form address (city name, postal code, full street
   * address, ...) to lat/lng. Returns null when Google reports
   * ZERO_RESULTS so the caller can fall back to a text-only search.
   */
  async geocode(address: string): Promise<GeocodeResult | null> {
    if (!address.trim()) {
      throw new Error("address must be a non-empty string");
    }
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("address", address);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("region", this.defaultRegion);
    url.searchParams.set("language", this.defaultLanguage);

    const res = await this.fetchImpl(url.toString(), { method: "GET" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Geocoder failed (${res.status}): ${body.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as RawGeocodeResponse;

    if (json.status === "ZERO_RESULTS") return null;
    if (json.status !== "OK") {
      throw new Error(
        `Geocoder API error ${json.status}: ${json.error_message ?? "no detail"}`,
      );
    }
    const top = json.results[0];
    if (!top) return null;
    return {
      latitude: top.geometry.location.lat,
      longitude: top.geometry.location.lng,
      formattedAddress: top.formatted_address,
      placeId: top.place_id,
    };
  }
}
