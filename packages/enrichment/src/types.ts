export type EmailSource = "website" | "hunter" | "manual";

export interface FoundEmail {
  email: string;
  source: EmailSource;
  /** First/last name if the source supplied them. */
  firstName?: string;
  lastName?: string;
  /** Free-form confidence score 0-100 (Hunter provides this). */
  confidence?: number;
  /** Position / role if known (e.g. "Owner"). */
  position?: string;
}

export interface EnrichmentInput {
  /** Domain like "kapsalondeknipster.nl". Optional if no website. */
  domain?: string;
  /** Full URL to the business website if known. */
  websiteUrl?: string;
  /** Business name — used as a Hunter fallback when no domain is known. */
  businessName: string;
}

export interface EnrichmentResult {
  emails: FoundEmail[];
  /** Diagnostic info, useful in logs. */
  warnings: string[];
}
