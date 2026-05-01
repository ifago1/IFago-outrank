import type {
  PlaceResult,
  PlacesError,
  SearchOptions,
} from "./types.js";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

/**
 * Field mask sent via the X-Goog-FieldMask header. Charged-per-field by
 * Google, so keep this list minimal — exactly what we persist.
 */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  // Up to 5 reviews per place. Powers AI personalization in the sequencer
  // (without this the LLM has only rating + count to work with).
  "places.reviews",
].join(",");

export interface PlacesClientOptions {
  apiKey: string;
  /**
   * Override fetch implementation. Lets tests inject a stub.
   */
  fetchImpl?: typeof fetch;
  /**
   * Optional language for displayed text fields. Default: "nl".
   */
  defaultLanguage?: string;
  /**
   * Optional region biasing. Default: "NL".
   */
  defaultRegion?: string;
}

export class PlacesClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultLanguage: string;
  private readonly defaultRegion: string;

  constructor(opts: PlacesClientOptions) {
    if (!opts.apiKey) {
      throw new Error("PlacesClient requires an apiKey");
    }
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultLanguage = opts.defaultLanguage ?? "nl";
    this.defaultRegion = opts.defaultRegion ?? "NL";
  }

  /**
   * Text Search against the Places API (New). Returns up to `pageSize`
   * results (max 20) per request. For larger result sets use
   * {@link searchBusinessesAllPages}.
   */
  async searchBusinesses(opts: SearchOptions): Promise<PlaceResult[]> {
    const { results } = await this.searchOnePage(opts);
    return results;
  }

  /**
   * Walk Google's pageToken pagination until exhausted or `maxPages` is
   * reached. The Places API caps at 60 results across pages (3 pages of
   * up to 20). Each page is a separate billable request.
   */
  async searchBusinessesAllPages(
    opts: SearchOptions & { maxPages?: number },
  ): Promise<PlaceResult[]> {
    const maxPages = Math.max(1, Math.min(opts.maxPages ?? 3, 3));
    const all: PlaceResult[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const { results, nextPageToken } = await this.searchOnePage({
        ...opts,
        ...(pageToken ? { pageToken } : {}),
      });
      all.push(...results);
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }
    return all;
  }

  private async searchOnePage(
    opts: SearchOptions & { pageToken?: string },
  ): Promise<{ results: PlaceResult[]; nextPageToken: string | undefined }> {
    if (!opts.query.trim()) {
      throw new Error("query must be a non-empty string");
    }

    const body: Record<string, unknown> = {
      textQuery: opts.query,
      languageCode: opts.languageCode ?? this.defaultLanguage,
      regionCode: opts.regionCode ?? this.defaultRegion,
      pageSize: clampPageSize(opts.pageSize),
    };

    if (opts.locationBias) {
      body["locationBias"] = {
        circle: {
          center: opts.locationBias.center,
          radius: opts.locationBias.radiusMeters,
        },
      };
    }
    if (opts.pageToken) body["pageToken"] = opts.pageToken;

    // Field mask must include nextPageToken when paginating, otherwise
    // Google strips it from the response.
    const fieldMask = opts.pageToken
      ? `${FIELD_MASK},nextPageToken`
      : `${FIELD_MASK},nextPageToken`;

    const res = await this.fetchImpl(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(
        `Places searchText failed (${res.status}): ${text.slice(0, 500)}`,
      ) as PlacesError;
      err.status = res.status;
      err.body = text;
      throw err;
    }

    const json = (await res.json()) as {
      places?: RawPlace[];
      nextPageToken?: string;
    };
    const results = (json.places ?? []).map(normalizePlace);
    return { results, nextPageToken: json.nextPageToken };
  }
}

function clampPageSize(n: number | undefined): number {
  if (!n || Number.isNaN(n)) return 20;
  return Math.min(20, Math.max(1, Math.trunc(n)));
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{
    types?: string[];
    longText?: string;
    shortText?: string;
  }>;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
}

export function normalizePlace(raw: RawPlace): PlaceResult {
  const id = raw.id ?? "";
  const placeId = id.startsWith("places/") ? id.slice("places/".length) : id;

  const city = pickAddressComponent(raw.addressComponents, [
    "locality",
    "postal_town",
    "administrative_area_level_2",
  ]);
  const country = pickAddressComponent(raw.addressComponents, ["country"]);

  return {
    id,
    placeId,
    displayName: raw.displayName?.text ?? "",
    primaryType: raw.primaryType ?? null,
    primaryTypeDisplay: raw.primaryTypeDisplayName?.text ?? null,
    formattedAddress: raw.formattedAddress ?? null,
    city,
    country,
    phone:
      raw.internationalPhoneNumber ?? raw.nationalPhoneNumber ?? null,
    websiteUrl: raw.websiteUri ?? null,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    userRatingCount:
      typeof raw.userRatingCount === "number" ? raw.userRatingCount : null,
    raw: raw as unknown as Record<string, unknown>,
  };
}

function pickAddressComponent(
  components: RawPlace["addressComponents"],
  preferredTypes: string[],
): string | null {
  if (!components) return null;
  for (const type of preferredTypes) {
    const hit = components.find((c) => c.types?.includes(type));
    if (hit?.longText) return hit.longText;
  }
  return null;
}
