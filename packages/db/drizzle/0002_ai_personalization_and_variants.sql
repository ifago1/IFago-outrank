ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "personal_observation" text,
  ADD COLUMN IF NOT EXISTS "personal_observation_source" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_step_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "step_id" uuid NOT NULL REFERENCES "sequence_steps"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "weight" integer DEFAULT 1 NOT NULL,
  "subject_template" text NOT NULL,
  "body_template" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emails_sent"
  ADD COLUMN IF NOT EXISTS "variant_id" uuid REFERENCES "sequence_step_variants"("id") ON DELETE SET NULL;
