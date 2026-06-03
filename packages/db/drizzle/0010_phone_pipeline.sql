-- Phone-pipeline schema-uitbreidingen + lead-events timeline.
--
-- 1) businesses.phone_next_attempt_at + phone_attempts: cadence-state
--    voor automatic-reshow van voicemail/called/callback leads. Telt
--    ook hoeveel pogingen we al hebben gedaan zodat we eventueel
--    kunnen opgeven na N keer.
-- 2) campaigns.warm_followup_target_id: per-campagne flag dat deze
--    campagne de "warm na telefonisch interesse"-flow ontvangt. Bij
--    NULL geen automatische toewijzing.
-- 3) lead_events: append-only timeline van alles dat met een business
--    gebeurt — mail-send/open/reply/bounce, telefoon-status, audit,
--    unsubscribe. Drijft de detail-pagina-timeline en latere
--    analytics.
--
-- IF NOT EXISTS overal voor portability.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "phone_next_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "phone_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "businesses_phone_next_attempt_idx"
  ON "businesses" ("phone_next_attempt_at")
  WHERE "phone_next_attempt_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "warm_followup_target" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "source" text NOT NULL,
  "payload" jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_business_idx"
  ON "lead_events" ("business_id", "occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_type_idx"
  ON "lead_events" ("type", "occurred_at" DESC);
