import Anthropic from "@anthropic-ai/sdk";

/**
 * Genereert een korte 2-3 zinnen bel-opener voor een lokale Nederlandse
 * ondernemer. Bedoeld om bovenaan de phone-row te tonen zodat je niet
 * "leeg" op een gesprek staat. Niet bedoeld als script — alleen als
 * vliegende start.
 *
 * Korter prompt, geen caching nodig — wordt on-demand per business
 * één keer aangeroepen wanneer de gebruiker op "Bel-pitch" klikt.
 */
const SYSTEM_PROMPT = `Je helpt een webdesign-agent met een eerste bel-opener naar een Nederlandse lokale ondernemer.

Output:
- 2 of 3 korte zinnen in het Nederlands, geen lijstjes, geen markdown
- Begint met "Hi, met [naam van de gebruiker — laat ZX_NAAM staan, dat plakken we later]" — alleen het gedeelte erna schrijf je
- Geef een concrete reden waarom je belt op basis van de input (site-kwaliteit, audit-zwakte, niche-detail)
- Eindig met een open vraag of een korte uitnodiging om verder te praten
- Geen pitches over diensten, geen prijzen, geen anglicismen
- Toon: vriendelijke vakgenoot, geen verkoper

Voorbeeld bij outdated site:
"Hi, met ZX_NAAM. Ik bel even kort naar aanleiding van jullie website — viel me op dat 'ie mobiel best traag laadt en de look nog vrij 2018 is. Heb je 2 minuten?"

Voorbeeld bij geen site:
"Hi, met ZX_NAAM. Snel checken: ik kon geen website vinden voor jullie. Doen jullie alles via Google en mond-op-mond, of zoeken klanten ook anders? Heb je een momentje?"

Geef ALLEEN de pitch zelf — geen quotes, geen prefix, geen toelichting.`;

export interface CallPitchInput {
  businessName: string;
  niche?: string | null;
  city?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
  websiteUrl?: string | null;
  websiteQuality?: string | null;
  /** AI-audit summary (één alinea), optioneel. */
  auditSummary?: string | null;
  /** Top zwakke punten uit AI-audit. */
  auditWeaknesses?: string[];
}

export interface CallPitchOptions {
  apiKey: string;
  model?: string;
}

export class CallPitch {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: CallPitchOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? "claude-haiku-4-5-20251001";
  }

  async generate(input: CallPitchInput): Promise<{ pitch: string }> {
    const userPrompt = buildUserPrompt(input);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("Call-pitch response had no text content");
    }
    const pitch = block.text.trim();
    if (!pitch) throw new Error("Empty call-pitch response");
    return { pitch };
  }
}

function buildUserPrompt(input: CallPitchInput): string {
  const parts: string[] = [];
  parts.push(`Bedrijf: ${input.businessName}`);
  if (input.niche) parts.push(`Niche: ${input.niche}`);
  if (input.city) parts.push(`Stad: ${input.city}`);
  if (typeof input.rating === "number") {
    parts.push(
      `Google-rating: ${input.rating.toFixed(1)} (${input.reviewsCount ?? 0} reviews)`,
    );
  }
  parts.push(
    input.websiteUrl
      ? `Website: ${input.websiteUrl} — kwaliteit: ${input.websiteQuality ?? "onbekend"}`
      : "Website: geen bekend bij Google Places",
  );
  if (input.auditSummary) {
    parts.push(`Audit-samenvatting: ${input.auditSummary.slice(0, 400)}`);
  }
  if (input.auditWeaknesses && input.auditWeaknesses.length > 0) {
    parts.push(
      `Top-zwaktes uit audit:\n- ${input.auditWeaknesses.slice(0, 3).join("\n- ")}`,
    );
  }
  return parts.join("\n");
}
