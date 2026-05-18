import { leadEvents, type Db } from "./index.js";

/**
 * Soorten events die we per business loggen. Houd dit synchroon met
 * de comment op de leadEvents-schema en met de UI-rendering op
 * /leads/<id>.
 */
export type LeadEventType =
  | "mail_sent"
  | "mail_opened"
  | "mail_replied"
  | "mail_bounced"
  | "phone_status"
  | "unsubscribed"
  | "audit_completed"
  | "auto_assigned";

export type LeadEventSource = "mail" | "phone" | "system" | "audit";

export interface LogLeadEventInput {
  businessId: string;
  type: LeadEventType;
  source: LeadEventSource;
  payload?: Record<string, unknown>;
  /** Override de timestamp. Default: now. */
  occurredAt?: Date;
}

/**
 * Append-only insert in lead_events. Fire-and-forget bedoeld:
 * caller hoeft de Promise niet te awaiten in de hot-path. Werp
 * geen exceptions terug — een log-fail mag de business-actie niet
 * stuk maken.
 */
export async function logLeadEvent(
  db: Db,
  input: LogLeadEventInput,
): Promise<void> {
  try {
    await db.insert(leadEvents).values({
      businessId: input.businessId,
      type: input.type,
      source: input.source,
      ...(input.payload ? { payload: input.payload } : {}),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
  } catch (err) {
    console.error(
      "[lead-events] failed to log event (continuing):",
      err instanceof Error ? err.message : err,
    );
  }
}
