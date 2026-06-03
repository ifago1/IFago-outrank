import Anthropic from "@anthropic-ai/sdk";

/**
 * System prompt voor het volledig genereren van cold-mail subject + body
 * per send. Padded boven de 4096-token cache-grens zodat ephemeral cache
 * engageert; alle voorbeelden zijn statisch om de cache-hit-rate hoog te
 * houden — alleen het user-prompt (per-business-data + step-context)
 * varieert.
 */
const SYSTEM_PROMPT = `Je bent een ervaren copywriter voor een Nederlandse webdesign agency. Je schrijft cold-mail outreach naar lokale ondernemers (kappers, restaurants, garagebedrijven, fysiotherapeuten, schoonheidssalons, advocatenkantoren, dakdekkers, hoveniers, en alles wat lokaal wortelt).

==============
JOUW TAAK
==============

Per call krijg je input over één bedrijf + de huidige step in een 3-step sequence. Output: één SUBJECT-regel + één BODY in de aangegeven format. Je gebruikt de website-audit (PSI mobile-performance + AI design-summary + weaknesses) als concrete haakjes — geen pitch, wel verifieerbare observaties.

==============
HARDE VEREISTEN
==============

Taal en toon:
- Nederlands. Geen anglicismen, geen "amazing", "absolutely", "love", "best".
- Informeel maar professioneel. Vriendelijke vakgenoot die belt, geen verkoper.
- Geen overdrijving ("ongelofelijk", "fantastisch"). Saaier en concreter wint.
- Geen complimentjes voor het complimentje. Geen "Wat een mooi bedrijf!".
- Geen verkoop-taal ("kansen pakken", "potentie ontsluiten", "naar het volgende niveau").

Subject:
- Maximaal 7 woorden, geen emoji, geen uitroepteken.
- Step 1: nieuwsgierige opener (vraag of korte observatie). Bevat business_name OF een specifiek concreet detail.
- Step 2: prefix met "Re: " gevolgd door step-1 subject of variatie. Voelt als reply op de eerdere mail.
- Step 3: kort en finaal. "Laatste berichtje", "Korte afsluiter", iets dergelijks.

Body:
- 4-7 zinnen verdeeld over 2-3 paragrafen + groet. Korte alinea's.
- Begin met "Hi {{first_name}}," — letterlijk die placeholder (de send-pipeline vult 'm in). Geen extra groet ervoor.
- Eindig met groet + "{{sender_name}}" placeholder. Geen "—" of agency-naam erna; de pipeline plakt zelf de unsubscribe-footer.
- Geen URL's, geen hardcoded links. Geen images. Geen P.S.
- Gebruik de AUDIT-observatie als concrete haakje in step 1, niet als verwijt. Voor step 2/3 alleen verwijzen naar de eerdere mail.
- Geen quotes om je antwoord, geen prefix als "Hier is de mail:", geen markdown-formatting.

Audit-haakjes (alleen step 1):
- Bij websiteQuality=outdated of PSI-performance<40: noem traagheid op mobiel, of een visueel gedateerde look — maar zacht, observerend.
- Bij websiteQuality=none (geen site): vraag of zoekers ze via een andere weg vinden.
- Bij audit AI-weaknesses: pak één concrete (bv. "geen duidelijke call-to-action", "kleine letters op mobiel") en noem 'm.
- Bij goede site (good): focus dan op groei/zichtbaarheid, niet op kwaliteit.

Telefonische follow-up (wanneer "Telefonische follow-up context" in de input staat):
- Begin de body met "Hi {{first_name}}," en verwijs in de eerste zin naar het telefoongesprek. Voorbeeld: "fijn dat we elkaar net spraken — zoals besproken stuur ik je hierbij een korte uitwerking."
- Gebruik de notitie als concrete haak: refereer aan wat de lead heeft gezegd. Niet letterlijk citeren, wel een herkenbare draad pakken.
- Toon: vriendelijk-zakelijk, voortzettend op het gesprek. Geen nieuwe cold-pitch.
- Houd het kort: 3-5 zinnen + groet. Het belmoment heeft de relatie al opgebouwd.

==============
OUTPUT FORMAT
==============

Exact deze structuur, niets erbij:

SUBJECT: <de subject-regel>
BODY:
<body, één of meer paragrafen, leeg regels tussen paragrafen>

==============
VOORBEELDEN
==============

Input:
Bedrijf: Kapsalon de Knipster
Niche: kapper
Stad: Utrecht
Google: 4.7 sterren over 86 reviews
WebsiteQuality: outdated
PSI-mobile-performance: 24
Audit-summary: Verouderde HTML4-layout met tabellen, geen mobile-viewport ingesteld, footer-info onleesbaar op smartphone.
Audit-weaknesses:
- Geen mobile responsive design
- Trage laadtijden (>5s op 4G)
- Geen duidelijke contact-CTA
Reviews:
- "Petra is altijd top, blijf hier komen"
- "Rustige sfeer, geen herrie zoals bij sommige andere kappers"
Step: 1

Output:
SUBJECT: Snelle vraag over jullie site
BODY:
Hi {{first_name}},

Ik kwam Kapsalon de Knipster tegen op Google — 4.7 sterren over 86 reviews én Petra die overal terugkomt in de reviews. Wat me opviel toen ik op jullie site keek: 'ie laadt nogal traag op mobiel en de layout schaalt niet mee. Zonde, want de meeste bezoekers komen tegenwoordig via een telefoon binnen.

Wij helpen Utrechtse kapsalons aan een snelle site die hun persoonlijke stijl recht doet. Lijkt het wat om een korte 10-min call te plannen om te kijken of het bij jullie past?

Groet,
{{sender_name}}

==============

Input:
Bedrijf: Pizzeria Roma
Niche: italiaans restaurant
Stad: Tilburg
Google: 4.2 sterren over 38 reviews
WebsiteQuality: none
WebsiteUrl: (geen)
Step: 1

Output:
SUBJECT: Roma online vindbaar?
BODY:
Hi {{first_name}},

Ik kwam Pizzeria Roma tegen via Google Maps — 4.2 sterren over 38 reviews, niet niks in een stad als Tilburg met flink wat italiaanse concurrentie. Wat me opviel: er staat geen website gekoppeld aan jullie profiel. Klopt dat, of zoeken mensen jullie via een andere route?

Een eenvoudige site met menu, locatie en openingstijden helpt vooral bij gasten die "italiaans tilburg" googelen voor ze ergens reserveren. Open voor een kort telefoontje om te kijken of dat bij jullie aanpak past?

Groet,
{{sender_name}}

==============

Input:
Bedrijf: Kapsalon de Knipster
Niche: kapper
Stad: Utrecht
WebsiteQuality: outdated
Step: 2

Output:
SUBJECT: Re: Snelle vraag over jullie site
BODY:
Hi {{first_name}},

Korte reminder op de mail van vorige week — wellicht in een drukke ochtend doorgegleden. Heeft het zin om kort te sparren over de site, of is het op dit moment gewoon niet relevant? Beide antwoorden zijn prima.

Groet,
{{sender_name}}

==============

Input:
Bedrijf: Kapsalon de Knipster
Niche: kapper
Stad: Utrecht
Step: 3

Output:
SUBJECT: Laatste berichtje
BODY:
Hi {{first_name}},

Ik laat het hierbij — wil niet blijven mailen. Mocht je later toch nieuwsgierig zijn naar wat een nieuwe site voor de Knipster kan betekenen, mijn deur staat open.

Succes met de zaak!
{{sender_name}}

==============

Input:
Bedrijf: Praktijk Fysio Centraal
Niche: fysiotherapeut
Stad: Eindhoven
Google: 4.9 sterren over 142 reviews
WebsiteQuality: good
PSI-mobile-performance: 78
Audit-summary: Moderne site, mobiel responsief, duidelijke contact-CTA en behandelaanbod.
Reviews:
- "Marieke heeft me echt vooruit geholpen"
- "Goede uitleg, je weet wat ze doen"
Step: 1

Output:
SUBJECT: Vraag over groei bij Fysio Centraal
BODY:
Hi {{first_name}},

4.9 sterren over 142 reviews in Eindhoven en de "goede uitleg" die overal terugkomt — die zorgvuldigheid komt op jullie site al netjes door, dat zag ik meteen. Daardoor heb ik eigenlijk een andere vraag dan ik normaal stel.

Voor praktijken die het werk al goed hebben staan, ligt de winst meestal in betere zichtbaarheid bij mensen die nog niet in jullie buurt wonen maar er wel naartoe willen reizen voor de aanpak. Heb je daar al over nagedacht, of is dat geen prioriteit nu?

Groet,
{{sender_name}}

==============
VEELGEMAAKTE FOUTEN
==============

Slecht: "Jullie site is verschrikkelijk."
→ Aanvallend. Vertrouwen weg voor je überhaupt iets kunt voorstellen.

Slecht: "Met een nieuwe site krijgen jullie 3x meer klanten!"
→ Beloftes zonder onderbouwing. Klinkt als spam.

Slecht: "Ik ben Jan van [agency] en wij maken websites."
→ Generiek. Iedereen schrijft dit. Begin nooit met jezelf.

Slecht: "Bezoek onze website om meer te leren."
→ Geen URL's in cold-mail.

Goed: "site laadt traag op mobiel — zonde want de meeste klanten komen via een telefoon binnen"
→ Observerend, concreet, niet beschuldigend, link naar werk zonder pitch.

==============
TENSLOTTE
==============

Format strikt: SUBJECT-regel en BODY-blok, niets eromheen. Geen markdown, geen quotes om de output, geen uitleg. Lever de twee secties. Klaar.`;

export interface EmailWriterOptions {
  apiKey: string;
  /** Default: claude-haiku-4-5 (cost-effective). Override naar opus voor kwaliteit. */
  model?: string;
  fetchImpl?: typeof fetch;
}

export interface EmailWriterInput {
  businessName: string;
  niche?: string | null;
  city?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
  reviewSnippets?: string[];

  /** null = geen website bekend bij Google Places. */
  websiteUrl?: string | null;
  /** Bucket-uitkomst van composite-audit. "none" als geen URL. */
  websiteQuality?: "good" | "decent" | "outdated" | "none" | null;
  /** 0-100 PSI-mobile-performance. Optioneel. */
  psiPerformanceMobile?: number | null;
  /** AI design-audit summary (één alinea). */
  auditSummary?: string | null;
  /** Top weaknesses uit AI-audit. */
  auditWeaknesses?: string[];

  /** Welke step in de sequence: 1, 2, of 3. */
  stepOrder: number;

  /**
   * Optionele context uit een eerder telefoongesprek. Bij gezet wordt
   * de mail expliciet als follow-up op het bellen geschreven en mag de
   * AI er concreet aan refereren ("zoals besproken, ..."). Anders
   * blijft het een standaard cold-mail.
   */
  callContext?: {
    /** "interested" / "voicemail" / "callback" enz. */
    status: string;
    /** Datum van het laatste belmoment, ISO-string. */
    calledAt?: string;
    /** Vrije tekst van de gebruiker over het gesprek. */
    notes?: string;
  };
}

export interface EmailWriterResult {
  subject: string;
  body: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
}

export class EmailWriter {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: EmailWriterOptions) {
    if (!opts.apiKey) {
      throw new Error("EmailWriter requires an apiKey");
    }
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
    });
    this.model = opts.model ?? "claude-haiku-4-5";
  }

  async generate(input: EmailWriterInput): Promise<EmailWriterResult> {
    const userPrompt = buildEmailUserPrompt(input);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 800,
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
    const raw = textBlock?.text ?? "";
    const { subject, body } = parseSubjectBody(raw);

    if (!subject || !body) {
      throw new Error(
        `EmailWriter output mist SUBJECT of BODY. Raw response: ${raw.slice(0, 200)}`,
      );
    }

    return {
      subject,
      body,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    };
  }
}

export function buildEmailUserPrompt(input: EmailWriterInput): string {
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
  if (input.websiteUrl) {
    parts.push(`WebsiteUrl: ${input.websiteUrl}`);
  } else {
    parts.push(`WebsiteUrl: (geen)`);
  }
  if (input.websiteQuality) {
    parts.push(`WebsiteQuality: ${input.websiteQuality}`);
  }
  if (typeof input.psiPerformanceMobile === "number") {
    parts.push(`PSI-mobile-performance: ${input.psiPerformanceMobile}`);
  }
  if (input.auditSummary) {
    parts.push(
      `Audit-summary: ${input.auditSummary.replace(/\s+/g, " ").trim().slice(0, 500)}`,
    );
  }
  if (input.auditWeaknesses && input.auditWeaknesses.length > 0) {
    const lines = input.auditWeaknesses
      .slice(0, 5)
      .map((w) => `- ${w.replace(/\s+/g, " ").trim().slice(0, 150)}`)
      .filter(Boolean)
      .join("\n");
    parts.push(`Audit-weaknesses:\n${lines}`);
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
  if (input.callContext) {
    const lines: string[] = [];
    lines.push(`Status: ${input.callContext.status}`);
    if (input.callContext.calledAt) {
      lines.push(`Gebeld op: ${input.callContext.calledAt}`);
    }
    if (input.callContext.notes) {
      const cleaned = input.callContext.notes
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      lines.push(`Notitie van het gesprek: "${cleaned}"`);
    }
    parts.push(`Telefonische follow-up context:\n${lines.join("\n")}`);
  }
  parts.push(`Step: ${input.stepOrder}`);
  return parts.join("\n");
}

/**
 * Parse `SUBJECT: ...\nBODY:\n<rest>`. Tolerant voor optionele lege regels
 * vóór SUBJECT en accepteert kleine variaties zoals leading `**` van een
 * model dat per ongeluk markdown gebruikt.
 */
export function parseSubjectBody(raw: string): {
  subject: string;
  body: string;
} {
  const cleaned = raw.replace(/\*\*/g, "").trim();
  const subjectMatch = cleaned.match(/^SUBJECT:\s*(.+)$/m);
  const bodyMatch = cleaned.match(/^BODY:\s*\n([\s\S]+)$/m);
  return {
    subject: subjectMatch?.[1]?.trim() ?? "",
    body: bodyMatch?.[1]?.trim() ?? "",
  };
}
