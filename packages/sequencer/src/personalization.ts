/**
 * Heuristic "personal observation" lines for templates.
 *
 * For now this is rule-based: ratings + reviews + niche. The plan calls out
 * Anthropic API as an option to upgrade this to LLM-generated lines using the
 * raw Google reviews; that's a follow-up.
 */

export interface ObservationInput {
  businessName: string;
  rating: number | null | undefined;
  reviewsCount: number | null | undefined;
  city: string | null | undefined;
  niche: string | null | undefined;
}

export function buildPersonalObservation(input: ObservationInput): string {
  const r = input.rating ?? null;
  const n = input.reviewsCount ?? null;
  const city = input.city ?? null;

  if (r !== null && n !== null && r >= 4.5 && n >= 25) {
    return `${r.toFixed(1)} sterren over ${n} reviews — duidelijk een tevreden klantenkring${city ? ` in ${city}` : ""}.`;
  }
  if (r !== null && n !== null && n >= 5) {
    return `${r.toFixed(1)} sterren met ${n} reviews${city ? ` in ${city}` : ""}, dat zegt iets over hoe je werk gewaardeerd wordt.`;
  }
  if (city) {
    return `lokaal actief in ${city}${input.niche ? ` als ${input.niche}` : ""}.`;
  }
  return "een herkenbare lokale onderneming.";
}
