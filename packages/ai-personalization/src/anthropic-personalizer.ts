import Anthropic from "@anthropic-ai/sdk";
import type { ObservationInput, ObservationResult } from "./types.js";

/**
 * System prompt for the personal-observation generator.
 * Kept stable + reused so prompt caching can hit. Long enough that on Sonnet
 * (>= 2048-token cache minimum) the cache will engage; on Opus (>= 4096) it
 * may not, but `cache_control` is harmless either way.
 */
const SYSTEM_PROMPT = `Je bent een copywriter voor een Nederlandse webdesign agency. Je schrijft één korte, oprechte zin voor cold-mail openers naar lokale ondernemers (kappers, restaurants, garagebedrijven, fysiotherapeuten, etc.).

Vereisten:
- Nederlands, informeel maar respectvol (geen Engels)
- Maximaal 25 woorden, 1 zin, geen punt aan het eind (de mail-template voegt die toe)
- Begin niet met de bedrijfsnaam, een groet, of een leeg compliment ("indrukwekkend!" of "wauw!")
- Gebruik concrete details: een specifiek aspect uit reviews, niche-context, of stadshuis-detail
- Geen emoji, geen uitroeptekens, geen overdrijving
- Schrijf één compacte observatie waaruit blijkt dat je hun bedrijf écht hebt bekeken

Format: alleen de zin terug — geen quotes, geen prefix, geen uitleg.

Voorbeelden:

Input: "Kapsalon de Knipster, kapper in Utrecht, 4.7 sterren over 86 reviews. Reviews noemen vaak: 'rustige sfeer', 'Petra is top', 'altijd een lekkere koffie'."
Output: opvallend hoe vaak Petra én de rustige sfeer in de reviews terugkomen — dat soort persoonlijke ervaring is precies wat een goede website kan doorvertalen

Input: "Pizzeria Roma, italiaans restaurant in Tilburg, 4.2 sterren over 38 reviews."
Output: een lokale italiaan met al een aardige basis aan tevreden bezoekers — vooral in Tilburg waar de concurrentie best heftig is

Input: "Garage Veenendaal, autobedrijf, geen rating bekend."
Output: jullie hebben veel concrete vakkennis die online vaak onderbelicht blijft, en juist daar haken zoekende klanten op af`;

export interface AnthropicPersonalizerOptions {
  apiKey: string;
  /** Default: claude-opus-4-7. Override to e.g. claude-haiku-4-5 for cost. */
  model?: string;
  /** Override fetch (Anthropic SDK uses globalThis.fetch by default). */
  fetchImpl?: typeof fetch;
}

export class AnthropicPersonalizer {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicPersonalizerOptions) {
    if (!opts.apiKey) {
      throw new Error("AnthropicPersonalizer requires an apiKey");
    }
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
    });
    this.model = opts.model ?? "claude-opus-4-7";
  }

  async generate(input: ObservationInput): Promise<ObservationResult> {
    const userPrompt = buildUserPrompt(input);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 200,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Cacheable: the system prompt never changes between calls.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const text = (textBlock?.text ?? "").trim().replace(/[.。]$/u, "");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      source: "ai",
    };
  }
}

export function buildUserPrompt(input: ObservationInput): string {
  const parts: string[] = [];
  parts.push(`Bedrijf: ${input.businessName}`);
  if (input.niche) parts.push(`Niche: ${input.niche}`);
  if (input.city) parts.push(`Stad: ${input.city}`);
  if (
    typeof input.rating === "number" &&
    typeof input.reviewsCount === "number"
  ) {
    parts.push(
      `Google: ${input.rating.toFixed(1)} sterren over ${input.reviewsCount} reviews`,
    );
  }
  if (input.reviewSnippets && input.reviewSnippets.length > 0) {
    const trimmed = input.reviewSnippets
      .slice(0, 5)
      .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 200))
      .filter(Boolean)
      .map((s) => `- "${s}"`)
      .join("\n");
    parts.push(`Reviews:\n${trimmed}`);
  }
  if (input.websiteSnippet) {
    parts.push(
      `Website-snippet: "${input.websiteSnippet.replace(/\s+/g, " ").trim().slice(0, 400)}"`,
    );
  }
  return parts.join("\n");
}
