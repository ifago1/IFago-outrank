/** Shared types between the leads server actions and the client UI. */

export interface AssignLeadsResult {
  ok: boolean;
  message: string;
  /** Aantal contacts dat daadwerkelijk in de campagne is gezet (na dedupe). */
  assigned?: number;
  /** Aantal contacts dat al in de campagne zat — onChangedoNothing. */
  skipped?: number;
  /** Businesses zonder enige verifieerbare contact (geen email gevonden / DNC / niet verified). */
  skippedNoContact?: number;
}

export interface ContactActionResult {
  ok: boolean;
  message: string;
}

export interface AiAuditActionResult {
  ok: boolean;
  message: string;
  /** Door Claude toegekende score 1-10 (na succes). */
  score?: number;
  /** Eén-zin samenvatting (na succes). */
  summary?: string;
}

export interface BulkEnrichResult {
  ok: boolean;
  message: string;
  /** Hoeveel businesses daadwerkelijk geprocessed (had website). */
  processed: number;
  /** Hoeveel daarvan leverden ≥1 email op. */
  withEmails: number;
  /** Aantal NIEUWE contacts dat is ingevoegd (na dedupe op uniqueIndex). */
  newContacts: number;
  /** Businesses zonder website-URL — overgeslagen. */
  skippedNoWebsite: number;
  /** Enrichment-call faalde (timeout, network etc). */
  failed: number;
}
