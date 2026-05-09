import Anthropic from "@anthropic-ai/sdk";

export type ReplyClassification =
  | "positive"
  | "question"
  | "negative"
  | "out_of_office"
  | "referral"
  | "unknown";

export interface TriageInput {
  /** Subject of the inbound reply (often "Re: ..."). */
  subject: string | null;
  /** Plain-text body of the reply, capped to ~3000 chars before sending. */
  body: string;
  /** Subject of the original outbound mail, for context. */
  originalSubject?: string | null;
}

export interface TriageResult {
  classification: ReplyClassification;
  /** Single-sentence Dutch summary of the reply for at-a-glance triage. */
  summary: string;
  /** "ai" | "heuristic" — caller can log which path was taken. */
  source: "ai" | "heuristic";
  /** Token usage when source === "ai". */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

const SYSTEM_PROMPT = `Je classificeert antwoorden op cold-mails voor een Nederlandse outreach-tool. Per binnenkomende reply bepaal je twee dingen:

1. Een classificatie (één label uit de vaste set hieronder)
2. Een korte Nederlandse samenvatting van wat de afzender bedoelt — maximaal 1 zin, ≤ 25 woorden, neutraal en feitelijk.

==============
CLASSIFICATIES
==============

- "positive"        → afzender toont oprechte interesse: wil meer info, wil afspraak, vraagt om voorstel of pricing, "klinkt goed", "wanneer kunnen we bellen", etc.
- "question"        → afzender heeft een specifieke vraag of opheldering nodig vóór 'ie kan beslissen, maar staat niet duidelijk negatief.
- "negative"        → afzender wijst af, vraagt om uitschrijving, "geen interesse", "stop met mailen", "haal me van je lijst", boos.
- "out_of_office"   → automatisch antwoord wegens vakantie, afwezigheid, OOO. Geen menselijk oordeel over het aanbod.
- "referral"        → afzender verwijst door naar een collega of ander mailadres ("mail Jan voor dit", "wij doen dit niet, contact onze marketing"). Niet zelf geïnteresseerd.
- "unknown"         → geen van bovenstaande past. Bv. te kort, off-topic spam, niet leesbaar, of dubbelzinnig.

==============
HARDE REGELS
==============

- Antwoord ALLEEN met geldige JSON die voldoet aan het schema {classification, summary}.
- Geen markdown, geen \`\`\`json\`\`\` fences, geen extra tekst.
- "summary" is één zin in het Nederlands, ≤ 25 woorden, beschrijvend (geen advies geven).
- Bij twijfel tussen "positive" en "question": kies "question" tenzij ze expliciet vragen om een afspraak/voorstel.
- Bij beleefde-maar-afwijzende antwoorden ("interessant maar nu niet") → "negative".
- Auto-replies herken je aan termen als "out of office", "afwezigheid", "vakantie", "automatisch".

==============
VOORBEELDEN
==============

Reply: "Bedankt voor je bericht, klinkt interessant. Kun je een voorstel sturen?"
{"classification":"positive","summary":"Vraagt om een voorstel"}

Reply: "Wat zou dit ongeveer kosten voor een kapsalon van onze grootte?"
{"classification":"question","summary":"Vraagt naar pricing voor zijn bedrijf"}

Reply: "Geen interesse, schrijf me uit van jullie lijst."
{"classification":"negative","summary":"Wil uitgeschreven worden"}

Reply: "Ik ben afwezig tot 12 mei. Stuur urgente zaken naar mijn collega."
{"classification":"out_of_office","summary":"Afwezig tot 12 mei"}

Reply: "Wij doen dit niet zelf, mail onze marketingafdeling op marketing@bedrijf.nl."
{"classification":"referral","summary":"Verwijst door naar marketing@bedrijf.nl"}

Reply: "ok"
{"classification":"unknown","summary":"Te kort om te interpreteren"}

Reply: "Hoi Marc, lijkt me leuk om te bespreken — heb je donderdag tijd voor een korte call?"
{"classification":"positive","summary":"Wil donderdag een call plannen"}
`;

export interface ReplyTriageOptions {
  apiKey: string;
  /** Default: claude-haiku-4-5 — a classification task; Haiku is the right
   *  speed/cost tradeoff. Override to claude-opus-4-7 for hard edge cases. */
  model?: string;
  fetchImpl?: typeof fetch;
}

export class ReplyTriage {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: ReplyTriageOptions) {
    if (!opts.apiKey) throw new Error("ReplyTriage requires an apiKey");
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
    });
    this.model = opts.model ?? "claude-haiku-4-5";
  }

  async classify(input: TriageInput): Promise<TriageResult> {
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
    const raw = textBlock?.text ?? "";
    const parsed = parseTriageJson(raw);
    if (!parsed) {
      // Model returned malformed JSON. Fall back to heuristic so the
      // worker doesn't lose the whole batch on one bad reply.
      return heuristicTriage(input);
    }
    return {
      classification: parsed.classification,
      summary: truncate(parsed.summary, 200),
      source: "ai",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    };
  }
}

/**
 * Pure heuristic fallback used when no Anthropic API key is configured
 * or the model returns malformed output. Cheap, deterministic, never
 * fails — just less precise than the AI path.
 */
export function heuristicTriage(input: TriageInput): TriageResult {
  const text = `${input.subject ?? ""} ${input.body}`.toLowerCase();
  let classification: ReplyClassification = "unknown";

  if (
    /out of office|afwezig|vakantie|automatisch.*antwoord/.test(text)
  ) {
    classification = "out_of_office";
  } else if (
    /uitschrijven|geen interesse|stop met mailen|haal.*me.*van/.test(text)
  ) {
    classification = "negative";
  } else if (
    /mail.*aan|mail.*naar|verwijs.*naar|contact.*op.*met/.test(text) &&
    /@/.test(text)
  ) {
    classification = "referral";
  } else if (
    /interesse|graag|voorstel|pricing|prijs|afspraak|call|bel|bellen/.test(text)
  ) {
    classification = "positive";
  } else if (/\?/.test(input.body)) {
    classification = "question";
  }

  return {
    classification,
    summary: truncate(input.body.replace(/\s+/g, " ").trim(), 140),
    source: "heuristic",
  };
}

export function buildUserPrompt(input: TriageInput): string {
  const parts: string[] = [];
  if (input.originalSubject) {
    parts.push(`Onderwerp van mijn oorspronkelijke mail: "${input.originalSubject}"`);
  }
  if (input.subject) parts.push(`Reply-subject: "${input.subject}"`);
  parts.push("Reply-body:");
  parts.push(truncate(input.body.replace(/\r/g, ""), 3000));
  return parts.join("\n");
}

function parseTriageJson(
  raw: string,
): { classification: ReplyClassification; summary: string } | null {
  // The model is instructed to return bare JSON, but tolerate minor noise.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const obj = JSON.parse(cleaned) as unknown;
    if (
      obj &&
      typeof obj === "object" &&
      "classification" in obj &&
      "summary" in obj
    ) {
      const cls = (obj as { classification: unknown }).classification;
      const summary = (obj as { summary: unknown }).summary;
      if (
        typeof cls === "string" &&
        typeof summary === "string" &&
        isReplyClassification(cls)
      ) {
        return { classification: cls, summary };
      }
    }
  } catch {
    // fall through to null
  }
  return null;
}

function isReplyClassification(s: string): s is ReplyClassification {
  return (
    s === "positive" ||
    s === "question" ||
    s === "negative" ||
    s === "out_of_office" ||
    s === "referral" ||
    s === "unknown"
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
