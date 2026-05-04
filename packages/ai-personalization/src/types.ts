/**
 * Inputs the AI uses to write a one-line "personal observation" about a
 * business. The same shape is used by the heuristic fallback in the
 * sequencer.
 */
export interface ObservationInput {
  businessName: string;
  city: string | null | undefined;
  niche: string | null | undefined;
  rating: number | null | undefined;
  reviewsCount: number | null | undefined;
  /**
   * Up to 5 short Google review snippets (50-200 chars each). Optional.
   * The model uses these to find something specific to mention.
   */
  reviewSnippets?: string[];
  /**
   * A short text snippet from the business's website (e.g. <h1>, <meta
   * description>, or first paragraph). Optional.
   */
  websiteSnippet?: string;
}

export interface ObservationResult {
  text: string;
  /** Token usage so callers can track spend. */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  /** Did the call go to the LLM or did we fall back to the heuristic? */
  source: "ai" | "heuristic" | "cached";
}
