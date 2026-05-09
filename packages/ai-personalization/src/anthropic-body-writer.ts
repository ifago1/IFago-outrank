import Anthropic from "@anthropic-ai/sdk";

/**
 * Per-lead AI-generated email body. Used when a campaign opts into
 * `ai_personalize_full_body` — every send gets a fresh subject + body
 * tailored to that lead, with the campaign's templates passed as tone
 * reference. Falls back to the templated render on any error so a
 * single AI hiccup never blocks a tick.
 */

export interface BodyWriterInput {
  businessName: string;
  city: string | null | undefined;
  niche: string | null | undefined;
  rating: number | null | undefined;
  reviewsCount: number | null | undefined;
  /** "outdated" | "decent" | "good" | "none" — derived from website audit. */
  websiteQuality: string | null | undefined;
  /** Cached personal observation (one-line snippet) if we already have one. */
  observation?: string | null;
  /** Step number this email is for (1, 2, 3, ...). */
  stepOrder: number;
  /** The step's subject template — used as tone reference. */
  subjectTemplate: string;
  /** The step's body template — used as tone reference. */
  bodyTemplate: string;
  /** Sender's name, for sign-off. */
  senderName: string;
  /** Optional review snippets (max 3, each ≤ 200 chars). */
  reviewSnippets?: string[];
}

export interface BodyWriterResult {
  subject: string;
  body: string;
  source: "ai" | "fallback";
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

const SYSTEM_PROMPT = `Je schrijft cold-mail teksten voor een Nederlandse webdesign agency. Per lead schrijf je één e-mail met een subject + body, volledig in het Nederlands, op een persoonlijke en professionele toon.

==============
HARDE VEREISTEN
==============

Output-formaat:
- Antwoord ALLEEN met geldige JSON: {"subject":"<subject>","body":"<body>"}.
- Geen markdown, geen \`\`\`json\`\`\` fences, geen extra tekst eromheen.
- Body mag \\n bevatten voor regelovergangen. Geen HTML.

Toon en stijl:
- Nederlands, informeel-zakelijk. Geen Engels, geen anglicismen, geen "amazing!" "fantastic!" "absoluut top".
- Vriendelijk, oprecht, beknopt. Maximaal ~120 woorden in de body. Geen emoji.
- Geen verkooppraat of gebakken lucht. Geen "ongelofelijk", "fantastisch", "kansen pakken", "naar het volgende niveau".
- Schrijf alsof je een collega-ondernemer mailt — concreet, behulpzaam, niet pushy.

Inhoud:
- Open met iets specifieks over hun bedrijf — gebruik de "Personal observation" als hint, of als die ontbreekt iets uit reviews/rating/locatie.
- Sluit aan bij de stap-volgnummer (step 1 = eerste mail, step 2/3 = vriendelijke follow-up, niet hetzelfde verhaal opnieuw).
- Body mag verwijzen naar wat je voor hun website zou kunnen doen, maar: één punt, niet drie. Geen lijstjes.
- Sluit af met "Groet, <sender_name>" op een aparte regel.
- Geen unsubscribe-link toevoegen — die wordt door de mailer gegenereerd.

Subject:
- Kort. ≤ 8 woorden. Persoonlijk maar niet click-bait. Geen emoji, geen ALL CAPS.
- Voor step ≥ 2: prefix met "Re: " als het een follow-up is, met dezelfde of een variant van de step-1 subject.

Personal observation:
- Wanneer er een "Personal observation" in de input staat — gebruik 'm letterlijk of parafraseer 'm, plaats 'm in de eerste 2 zinnen.
- Wanneer 'ie ontbreekt — verzin er geen. Schrijf dan een opener die alleen leunt op rating + plaats + niche, zonder details te bedenken.

Tone-reference templates:
- De input bevat het sjabloon dat de operator als richtlijn heeft gemaakt. Gebruik 'm als TOON-referentie (lengte, formaliteit, structuur), niet als sjabloon dat je moet invullen.
- Volg het patroon: zelfde sign-off, zelfde aanspreekvorm, zelfde lengte-orde. Maar de woorden moeten ECHT NIEUW zijn — niet gewoon variabelen invullen.

==============
VOORBEELD
==============

Input:
Bedrijf: Kapsalon de Knipster
Niche: kapper
Stad: Utrecht
Rating: 4.7 (132 reviews)
Website-kwaliteit: outdated
Personal observation: opvallend hoe vaak Petra terugkomt in de reviews
Step: 1
Sender: Marc van iFago
Subject template: Snelle vraag over {{business_name}}
Body template: Hoi {{first_name}},\\n\\n{{personal_observation}}.\\n\\nMet vriendelijke groet,\\n{{sender_name}}

Output:
{"subject":"Even meedenken over Kapsalon de Knipster","body":"Hoi,\\n\\nOpvallend hoe vaak Petra terugkomt in de reviews — dat soort persoonlijke aandacht is precies wat een goede website zou moeten uitstralen. Op jullie huidige site komt dat nog niet helemaal door.\\n\\nIk werk met lokale ondernemers in Utrecht aan websites die wél meteen het gevoel oproepen dat een goed kappersbezoek geeft. Geen lange offertes vooraf — zou je het waarderen als ik je een paar suggesties stuur?\\n\\nGroet,\\nMarc van iFago"}
`;

export interface AnthropicBodyWriterOptions {
  apiKey: string;
  /**
   * Default: claude-haiku-4-5. Per-send AI generation runs many times
   * per day; Haiku gives the best speed/cost tradeoff. Override to
   * claude-opus-4-7 for higher-quality drafts on smaller volumes.
   */
  model?: string;
  fetchImpl?: typeof fetch;
}

export class AnthropicBodyWriter {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicBodyWriterOptions) {
    if (!opts.apiKey) throw new Error("AnthropicBodyWriter requires apiKey");
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
    });
    this.model = opts.model ?? "claude-haiku-4-5";
  }

  async generate(input: BodyWriterInput): Promise<BodyWriterResult> {
    const userPrompt = buildUserPrompt(input);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 800,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Cacheable: the system prompt is static across all sends.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const raw = textBlock?.text ?? "";
    const parsed = parseBodyJson(raw);
    if (!parsed) {
      // The model returned malformed JSON. Don't fail the send —
      // signal a fallback so the caller can use the templated path.
      return {
        subject: "",
        body: "",
        source: "fallback",
      };
    }
    return {
      subject: parsed.subject,
      body: parsed.body,
      source: "ai",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    };
  }
}

export function buildUserPrompt(input: BodyWriterInput): string {
  const parts: string[] = [];
  parts.push(`Bedrijf: ${input.businessName}`);
  if (input.niche) parts.push(`Niche: ${input.niche}`);
  if (input.city) parts.push(`Stad: ${input.city}`);
  if (
    typeof input.rating === "number" &&
    typeof input.reviewsCount === "number"
  ) {
    parts.push(
      `Rating: ${input.rating.toFixed(1)} (${input.reviewsCount} reviews)`,
    );
  }
  if (input.websiteQuality) {
    parts.push(`Website-kwaliteit: ${input.websiteQuality}`);
  }
  if (input.observation) {
    parts.push(`Personal observation: ${input.observation}`);
  }
  if (input.reviewSnippets && input.reviewSnippets.length > 0) {
    const trimmed = input.reviewSnippets
      .slice(0, 3)
      .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 200))
      .filter(Boolean)
      .map((s) => `- "${s}"`)
      .join("\n");
    parts.push(`Reviews:\n${trimmed}`);
  }
  parts.push(`Step: ${input.stepOrder}`);
  parts.push(`Sender: ${input.senderName}`);
  parts.push(`Subject template: ${input.subjectTemplate}`);
  parts.push(`Body template: ${input.bodyTemplate.replace(/\n/g, "\\n")}`);
  return parts.join("\n");
}

function parseBodyJson(
  raw: string,
): { subject: string; body: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const obj = JSON.parse(cleaned) as unknown;
    if (
      obj &&
      typeof obj === "object" &&
      "subject" in obj &&
      "body" in obj
    ) {
      const subject = (obj as { subject: unknown }).subject;
      const body = (obj as { body: unknown }).body;
      if (
        typeof subject === "string" &&
        typeof body === "string" &&
        subject.trim().length > 0 &&
        body.trim().length > 0
      ) {
        return { subject: subject.trim(), body: body.trim() };
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}
