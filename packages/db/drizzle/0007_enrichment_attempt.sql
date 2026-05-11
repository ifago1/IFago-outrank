ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "enrichment_attempted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "businesses_enrichment_attempted_at_idx"
  ON "businesses" ("enrichment_attempted_at");
