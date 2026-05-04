import Anthropic from "@anthropic-ai/sdk";

/**
 * AI-design-audit. Voert geen screenshot uit (zou Playwright/Chromium
 * nodig hebben), maar laat Claude alleen de raw HTML beoordelen op
 * design-keuzes die uit de markup blijken: structuur, typografie-
 * hints, hiërarchie, modern-vs-dated patronen. Geen vervanging voor
 * een echte vision-call, maar wel een sterk extra signaal bovenop de
 * heuristieken — en gratis te self-hosten zonder browser-binary.
 *
 * Output is een score 1-10 + één-zin samenvatting in het Nederlands.
 * Beide worden in audit_detail.ai opgeslagen en op de detailpagina
 * getoond.
 */

const SYSTEM_PROMPT = `Je bent een ervaren web designer met 15+ jaar ervaring in lokale Nederlandse MKB-websites (kappers, restaurants, autobedrijven, fysio, etc.). Je beoordeelt de visuele en UX-kwaliteit van een website **uitsluitend op basis van de geleverde HTML**.

Je krijgt: de URL en een snippet van de eerste ~6KB HTML.

Beoordeel de site op een schaal van 1-10:
- 1-3: jaren-2000 design, table-layouts, default browser-typografie, geen hiërarchie, geen mobiele optimalisatie zichtbaar. Volkomen gedateerd.
- 4-5: functioneel maar saai. Templated builder (Wix/Squarespace) zonder eigen smaak, of zelfgebouwd maar ondergedimensioneerd. Conversie-poor.
- 6-7: goed verzorgd, werkt op mobiel, duidelijke hiërarchie. Doet wat een MKB-site moet doen, geen wow-factor.
- 8-9: bovengemiddeld voor MKB. Herkenbare merkidentiteit, doordachte typografie, video/animatie, goede info-architectuur.
- 10: uitzonderlijk — vergelijkbaar met agency-werk voor grotere klanten.

GEEF EXACT DEZE OUTPUT (JSON, één regel, geen code-fences):
{"score":<1-10>,"summary":"<één Nederlandse zin van max 25 woorden>","strengths":["<korte strength 1>","..."],"weaknesses":["<korte weakness 1>","..."]}

REGELS:
- summary: één zin, NL, geen quotes, geen punt aan het eind. Beschrijvend, niet promotie-taal.
- strengths/weaknesses: max 3 items elk, korte fragmenten (3-7 woorden), Nederlands.
- Wees concreet: noem specifieke patronen die je in de HTML zag (bv. "tabellen voor layout", "Google Fonts geladen", "geen viewport meta"), niet vage termen.
- Geef NOOIT score 10 voor een lokaal MKB-bedrijfje — die schaal is voor agency-werk.
- Als je twijfelt, kies de lagere score. Conservatief is beter dan hoog inschatten.

LET OP: alleen de JSON terug, niets anders. Geen uitleg ervoor of erna.`;

export interface AiAuditInput {
  url: string;
  /** Raw HTML — wordt naar 6KB getrimd om token-budget te beperken. */
  html: string;
  businessName?: string;
}

export interface AiAuditResult {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
}

export interface AiAuditorOptions {
  apiKey: string;
  /** Default: claude-haiku-4-5 (snel + goedkoop voor scoring-taak). */
  model?: string;
  fetchImpl?: typeof fetch;
}

const MAX_HTML_BYTES = 6_000;

export class AiAuditor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AiAuditorOptions) {
    if (!opts.apiKey) throw new Error("AiAuditor requires an apiKey");
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
    });
    this.model = opts.model ?? "claude-haiku-4-5";
  }

  async audit(input: AiAuditInput): Promise<AiAuditResult> {
    const trimmed = input.html.slice(0, MAX_HTML_BYTES);
    const userPrompt = [
      `URL: ${input.url}`,
      input.businessName ? `Bedrijf: ${input.businessName}` : null,
      "",
      "HTML-snippet (eerste deel):",
      "```html",
      trimmed,
      "```",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 400,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const raw = (textBlock?.text ?? "").trim();
    const parsed = parseAiResponse(raw);

    return {
      ...parsed,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    };
  }
}

interface ParsedFields {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
}

export function parseAiResponse(raw: string): ParsedFields {
  // Strip eventuele code-fences die het model ondanks instructie alsnog set.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: zoek naar de eerste {...} JSON-blob.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`AI response is geen geldige JSON: ${cleaned.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response is geen object");
  }
  const obj = parsed as Record<string, unknown>;
  const score = clampScore(Number(obj["score"]));
  const summary = typeof obj["summary"] === "string"
    ? obj["summary"].trim().replace(/[.。]$/u, "")
    : "";
  const strengths = Array.isArray(obj["strengths"])
    ? (obj["strengths"] as unknown[]).map((s) => String(s)).slice(0, 3)
    : [];
  const weaknesses = Array.isArray(obj["weaknesses"])
    ? (obj["weaknesses"] as unknown[]).map((s) => String(s)).slice(0, 3)
    : [];
  return { score, summary, strengths, weaknesses };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}
