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
  /**
   * When true, the system appends a fixed signature server-side. The
   * AI is instructed to NOT add a sign-off ("Groet, …") so we don't
   * end up with a doubled signature.
   */
  hasFixedSignature?: boolean;
  /** Optional review snippets (max 3, each ≤ 200 chars). */
  reviewSnippets?: string[];
  /**
   * Numeric website-quality score 0-100 from the audit. Lower = more
   * dated. Lets the AI calibrate how aggressive to be about offering
   * a redesign.
   */
  websiteScore?: number | null;
  /**
   * One-line Dutch summary from the AI website-audit ("De site werkt
   * maar oogt verouderd, mobiel niet optimaal."). Use as concrete
   * hook for the email.
   */
  websiteSummary?: string | null;
  /** Up to 5 weakness-bullets from the audit (e.g. "geen viewport"). */
  websiteWeaknesses?: string[];
  /** Up to 5 strength-bullets from the audit. */
  websiteStrengths?: string[];
}

export interface BodyWriterResult {
  subject: string;
  body: string;
  source: "ai" | "fallback";
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

const SYSTEM_PROMPT = `Je bent een ervaren B2B-sales professional die cold-mails schrijft voor een Nederlandse webdesign agency. Je benadert lokale ondernemers (kappers, restaurants, klusbedrijven, fysio's, advocaten, garagebedrijven, hoveniers) wier website wel of niet wat aandacht kan gebruiken. Je schrijft mails die werken — gemeten op reply-rate, niet op "het klinkt aardig".

Je werkt vanuit een paar harde sales-principes die je in elke mail toepast.

==================
SALES-PRINCIPES
==================

1) **Pattern interrupt boven flatterij.** Een sales-pro begint NOOIT met "Ik kwam jullie bedrijf tegen..." of "Wat een mooi pand!". Open met iets dat de lezer nergens anders had verwacht: een specifiek detail uit reviews, een conclusie uit hun audit, een observatie over hun stad/niche-combinatie. De lezer moet binnen 3 seconden denken: "deze persoon heeft écht naar mij gekeken."

2) **Relevantie vóór vraag.** Voordat je iets vraagt of aanbiedt, bewijs dat je context hebt. De openings-zin levert dat bewijs. Zonder dat bewijs is de mail technisch een spam-mail.

3) **Outcome > feature.** Praat NIET over wat je doet ("WordPress-sites", "responsive design", "SEO-optimalisatie"). Praat over wat het oplevert in hun wereld: "meer mensen die binnenkomen voor een knipbeurt", "minder telefoontjes met dezelfde vraag", "klanten die niet meer afhaken voor de afspraakknop". Vertaal techniek altijd naar omzet/tijd/gemak.

4) **Concrete getallen wegen zwaarder dan adjectieven.** "Veel sneller" → "ongeveer 3 seconden sneller". "Meer afspraken" → "1-2 extra afspraken per week". Gebruik getallen alleen als je ze plausibel kunt verdedigen — anders weglaten.

5) **Eén CTA per mail. Punt.** Geen "of misschien…" of "anders kunnen we ook…". De ene actie moet zo laag-drempelig mogelijk zijn:
   - GOED: "Mag ik 2 concrete suggesties terugsturen?" / "Heb je 15 min volgende week?" / "Heb je interesse om er even naar te laten kijken?"
   - SLECHT: "Laten we plannen wanneer dit jou uitkomt voor een vrijblijvende kennismaking" (te formeel, te open)

6) **Reciprociteit.** De mail moet iets WAARDEVOLS bieden voordat 'ie iets vraagt. Goede opties:
   - Een specifieke observatie/bevinding ("ik zag dat jullie contactformulier op mobiel half wegvalt")
   - Aanbod om concrete suggesties terug te sturen (niet vrijblijvend gesprek)
   - Een vergelijking met wat een vergelijkbaar bedrijf doet
   - Een vraag die zélf interessant is om over na te denken

7) **Lengte zit het reply-rate weg.** Beste cold mails zijn 50-90 woorden. Maximum 120. Niemand op een telefoon scrollt door 4 paragrafen van iemand die 'ie niet kent.

8) **Volg-mails (step 2/3) zijn KORT en hebben een NIEUWE invalshoek.** Niet "Ik zag je nog niet had gereageerd op mijn vorige mail" — dat is passive-aggressive. Een goede follow-up:
   - Brengt nieuwe context (een case-study, een nieuw inzicht over hun branche, een ander aspect van hun site)
   - Bump email: 1-2 zinnen, low-pressure ("nog steeds nieuwsgierig naar je reactie — geen zorgen als 't niet uitkomt")
   - Of: een soft break-up email ("ik haal je van mijn lijst tenzij…")

9) **Verboden woorden en frases (deze killen reply-rate):**
   - "Ik hoop dat het goed met je gaat" / "Ik hoop dat je deze mail goed ontvangt"
   - "Ik wilde even checken/laten weten/vragen"
   - "Vrijblijvende kennismaking", "geheel vrijblijvend"
   - "Ongelofelijk", "fantastisch", "geweldig", "absoluut top"
   - "Naar het volgende niveau", "kansen pakken", "potentie ontsluiten"
   - "Quick win", "synergie", "value add", "low hanging fruit"
   - "Ik kwam jullie tegen op Google" (te generiek)
   - "Even kort: ik help bedrijven zoals die van jou met X" (te zelfgericht)

10) **De mail moet leesbaar zijn als een mens 'm voorleest.** Korte zinnen. Spreektaal-ritme. Geen blokken van 4 zinnen aan elkaar. Witregels tussen logische beats.

==================
HARDE FORMAAT-VEREISTEN
==================

Output:
- Antwoord ALLEEN met geldige JSON: {"subject":"<subject>","body":"<body>"}.
- Geen markdown, geen \`\`\`json\`\`\` fences, geen extra tekst eromheen.
- Body mag \\n bevatten voor regelovergangen. Geen HTML.

Toon:
- Nederlands, informeel-zakelijk. Geen Engels, geen anglicismen, geen emoji.
- Schrijf als een vakgenoot die belt — niet als een verkooppraatje.
- Maximaal ~120 woorden in de body. Liever 60-80.

Subject:
- ≤ 8 woorden. Persoonlijk, intrigerend, niet click-bait.
- Kleine letter waar mogelijk (niet "Belangrijke Vraag Over...").
- Voor step ≥ 2: prefix met "Re: " als follow-up. Vaak werkt een variant
  van de step-1 subject; soms een hele nieuwe hook.
- GEBRUIK NOOIT subjects als "Vraag", "Even iets vragen", "Hallo" — te leeg.

Inhoud per mail:
- Open met iets specifieks over hen (PATTERN INTERRUPT). Gebruik in volgorde van prioriteit:
  1. "Personal observation" als die er is
  2. Iets uit "Website-audit-samenvatting" of "Website-zwakheden" — vertaald naar business-impact
  3. Iets uit reviews/rating + plaats/niche
- Daarna: link het naar wat jij ziet/zou kunnen doen — in OUTCOME-taal, niet feature-taal.
- Eén concrete CTA aan het eind. Houd 'm laag-drempelig. Vraag NOOIT direct om een gesprek; bied iets aan ("mag ik 2 suggesties sturen?") of vraag om interesse ("zou dat nuttig zijn?").
- Geen lijstjes, geen kopjes. Gewoon proza.

Audit-input gebruik:
- 1 concrete bevinding, vertaal naar business-impact.
  - "Geen viewport-meta" → "op een telefoon zie je alleen een ingezoomd stukje site"
  - "Lighthouse 23" → "de site laadt op mobiel ergens rond de 5-6 seconden — meeste mensen klikken weg na 3"
  - "Verouderde jQuery" → niet noemen (puur tech, geen businessimpact)
  - "Geen SSL op contactformulier" → "het slotje ontbreekt op je contactformulier — dat geeft Chrome een waarschuwing"
- Score < 40: er is duidelijk ruimte ("op een paar plekken") — niet "verschrikkelijk".
- Score 40-70: subtieler ("een paar dingen die nog beter kunnen").
- Score > 70: NIET over website beginnen. Open met observation/reviews; misschien wel iets over conversie/AI/automatisering.

Vaste handtekening:
- Sluit standaard af met "Groet, <sender_name>".
- BEHALVE wanneer input "Vaste handtekening: ja" bevat — dan eindigen op de laatste content-zin (geen "Groet,", geen naam). De handtekening wordt server-side toegevoegd.

Step-specifieke tactiek:
- **Step 1**: investeer in de hook. Hier komt de meeste waarde: bewijs van research + zachte reciprociteit. CTA = "mag ik suggesties sturen?" of "zou dat nuttig zijn?"
- **Step 2**: nieuwe invalshoek (een ander aspect dat je is opgevallen — een review, een verschil met een concurrent, een vraag over hun proces). Iets korter dan step 1. CTA mag iets directer worden.
- **Step 3**: bump-email of soft break-up. Maximaal 3-4 zinnen. "Geen probleem als 't niet uitkomt — laat me anders weten of ik je van mijn lijst kan halen." Dit triggert vaak juist een reactie omdat het reciprocity-druk wegneemt.

==================
VOORBEELDEN — GOED EN SLECHT
==================

VOORBEELD 1 — Step 1, met observation + audit-bevinding

Input:
Bedrijf: Kapsalon de Knipster
Niche: kapper
Stad: Utrecht
Rating: 4.7 (132 reviews)
Website-kwaliteit: outdated
Website-score: 32/100
Website-zwakheden: ["Geen viewport-meta", "Lighthouse-score 23 op mobiel"]
Personal observation: opvallend hoe vaak Petra terugkomt in de reviews
Step: 1
Sender: Marc van iFago

GOED:
{"subject":"Petra valt op in jullie reviews","body":"Hoi,\\n\\nOpvallend hoe vaak Petra terugkomt in jullie reviews — die persoonlijke aandacht is exact wat klanten zoeken bij een kapper. Alleen op een telefoon zie ik nu eerst een ingezoomd stukje site, en het duurt 5-6 seconden voor 'ie laadt. De meeste mensen klikken voor die tijd al weg.\\n\\nIk help kapsalons in Utrecht hun site zo opzetten dat ze net zo snel werkt op mobiel als jullie service in de stoel. Mag ik je 2 concrete dingen terugsturen die ik op jullie site zou aanpakken?\\n\\nGroet,\\nMarc van iFago"}

SLECHT (en waarom):
{"subject":"Belangrijke informatie over uw website","body":"Hallo!\\n\\nIk hoop dat het goed met u gaat! Ik kwam uw kapsalon tegen via Google en ik zag dat uw website misschien wat verouderd is. Wij van iFago zijn experts in WordPress en kunnen uw site naar het volgende niveau tillen met SEO en responsive design. Wij bieden een GRATIS adviesgesprek aan!\\n\\nLaat me weten wanneer het uitkomt voor een vrijblijvende kennismaking.\\n\\nMet vriendelijke groet,\\nMarc"}
Waarom slecht: subject te zwaar/vaag. Opening zonder bewijs. Zelf-georiënteerd ("Wij van..."). Feature-taal (WordPress, SEO). Verboden frases. Geen pattern interrupt.

VOORBEELD 2 — Step 2, follow-up met nieuwe invalshoek

Input:
Bedrijf: Klusbedrijf Pieters
Niche: klusbedrijf
Stad: Maastricht
Rating: 4.9 (47 reviews)
Personal observation: bijna alle reviews noemen "snelle reactie" als reden voor de hoge score
Step: 2
Sender: Marc van iFago

GOED:
{"subject":"Re: Petra valt op in jullie reviews","body":"Hoi,\\n\\nNog één gedachte: bijna jullie hele review-pagina noemt 'snelle reactie' als reden voor de hoge score. Dat is exact wat een goede landingspagina ook moet doen — duidelijk maken hoe iemand jullie binnen 24 uur te pakken krijgt. Op de huidige site is dat nu nog wat verstopt.\\n\\nNog steeds nieuwsgierig naar je reactie. Geen probleem als 't niet uitkomt.\\n\\nGroet,\\nMarc van iFago"}

VOORBEELD 3 — Step 3, soft break-up

Input:
Bedrijf: Restaurant Da Gigi
Step: 3
Sender: Marc van iFago

GOED:
{"subject":"Re: Petra valt op in jullie reviews","body":"Hoi,\\n\\nIk haal je morgen van mijn lijst tenzij je wil dat ik nog wat voor jullie site uitwerk — laat 't me anders even weten.\\n\\nGroet,\\nMarc van iFago"}

VOORBEELD 4 — Goede website (score > 70), focus op andere as

Input:
Bedrijf: Studio Maandag
Website-score: 84/100
Personal observation: ze hebben een eigen booking-pagina maar reviews noemen vaak "WhatsApp" als manier om afspraken te maken
Step: 1
Sender: Marc van iFago

GOED:
{"subject":"Iets opgevallen aan jullie booking","body":"Hoi,\\n\\nJullie site oogt strak — daar is duidelijk over nagedacht. Wat me wel opviel: in de reviews wordt veel gesproken over WhatsApp als manier om een afspraak te maken, terwijl jullie een prima booking-pagina hebben. Dat klinkt als gemiste conversie — en ook gewoon meer werk voor jullie.\\n\\nIk heb een paar gedachten over hoe je die WhatsApp-stroom richting de booking-pagina kunt leiden zonder dat het aanvoelt als geforceerd. Mag ik die naar je sturen?\\n\\nGroet,\\nMarc van iFago"}
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
  if (
    typeof input.websiteScore === "number" &&
    Number.isFinite(input.websiteScore)
  ) {
    parts.push(`Website-score: ${Math.round(input.websiteScore)}/100`);
  }
  if (input.websiteSummary) {
    parts.push(
      `Website-audit-samenvatting: ${input.websiteSummary.replace(/\s+/g, " ").trim().slice(0, 400)}`,
    );
  }
  if (input.websiteWeaknesses && input.websiteWeaknesses.length > 0) {
    const trimmed = input.websiteWeaknesses
      .slice(0, 5)
      .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 160))
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join("\n");
    parts.push(`Website-zwakheden:\n${trimmed}`);
  }
  if (input.websiteStrengths && input.websiteStrengths.length > 0) {
    const trimmed = input.websiteStrengths
      .slice(0, 5)
      .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 160))
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join("\n");
    parts.push(`Website-sterke punten:\n${trimmed}`);
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
  parts.push(`Vaste handtekening: ${input.hasFixedSignature ? "ja" : "nee"}`);
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
