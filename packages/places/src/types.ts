/**
 * Subset of fields returned by Google Places API (New).
 * Reference: https://developers.google.com/maps/documentation/places/web-service
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface LocationBias {
  /**
   * Centerpoint to bias results around. Required together with `radiusMeters`.
   */
  center: LatLng;
  /**
   * Radius in meters (max 50000 per the API).
   */
  radiusMeters: number;
}

export interface SearchOptions {
  /**
   * Free-form query, e.g. "kapper" or "italiaans restaurant".
   */
  query: string;
  /**
   * Bias results to a circular area. The Places API treats this as a *bias*,
   * not a hard filter — results outside the radius can still appear.
   */
  locationBias?: LocationBias;
  /**
   * BCP-47 language code for localized fields (default: "nl").
   */
  languageCode?: string;
  /**
   * ISO-3166-1 alpha-2 region code (default: "NL").
   */
  regionCode?: string;
  /**
   * Maximum number of results (1-20, default: 20).
   */
  pageSize?: number;
}

export interface PlaceResult {
  /** Stable Google Place ID, e.g. "places/ChIJ...". */
  id: string;
  /** Plain place id without the "places/" prefix. */
  placeId: string;
  displayName: string;
  primaryType: string | null;
  primaryTypeDisplay: string | null;
  formattedAddress: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  websiteUrl: string | null;
  rating: number | null;
  userRatingCount: number | null;
  /**
   * The unmodified payload returned by the Places API, useful for forensics
   * and storing in `businesses.raw_places_data`.
   */
  raw: Record<string, unknown>;
}

export interface PlacesError extends Error {
  status: number;
  body: string;
}
