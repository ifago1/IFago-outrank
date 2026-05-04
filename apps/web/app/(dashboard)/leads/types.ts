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
