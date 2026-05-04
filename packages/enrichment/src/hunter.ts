import type { FoundEmail } from "./types.js";

const DOMAIN_SEARCH_URL = "https://api.hunter.io/v2/domain-search";

export interface HunterClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Hunter response cap; their default max is 100. */
  limit?: number;
}

interface HunterEmail {
  value: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  confidence: number | null;
  type: "personal" | "generic" | null;
}

interface HunterResponse {
  data?: {
    domain?: string;
    emails?: HunterEmail[];
  };
  errors?: Array<{ id: string; code?: number; details?: string }>;
}

export class HunterClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limit: number;

  constructor(opts: HunterClientOptions) {
    if (!opts.apiKey) throw new Error("HunterClient requires an apiKey");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.limit = opts.limit ?? 10;
  }

  /**
   * Hunter Domain Search. Returns the best emails for `domain` (which can be
   * a bare domain like `acme.com` or a full URL — the API tolerates both).
   */
  async findByDomain(domain: string): Promise<FoundEmail[]> {
    const url = new URL(DOMAIN_SEARCH_URL);
    url.searchParams.set("domain", domain);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("limit", String(this.limit));

    const res = await this.fetchImpl(url.toString(), { method: "GET" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Hunter domain-search failed (${res.status}): ${body.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as HunterResponse;
    const emails = json.data?.emails ?? [];

    return emails
      .filter((e): e is HunterEmail & { value: string } => Boolean(e.value))
      .map((e) => {
        const out: FoundEmail = {
          email: e.value.toLowerCase(),
          source: "hunter",
        };
        if (e.first_name) out.firstName = e.first_name;
        if (e.last_name) out.lastName = e.last_name;
        if (e.position) out.position = e.position;
        if (typeof e.confidence === "number") out.confidence = e.confidence;
        return out;
      });
  }
}
