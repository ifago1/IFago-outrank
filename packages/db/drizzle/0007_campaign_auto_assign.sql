-- Auto-assign rules per campaign: leads matchen op niche/locatie/
-- website-kwaliteit + score-range + max-leads-cap. Idempotent met
-- IF NOT EXISTS zodat dit op DBs draait waar deze kolommen al door
-- een eerdere (afgevoerde) migratie bestaan.

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_niche" text;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_city" text;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_website_quality" text;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_min_score" integer;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_max_score" integer;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_max_leads" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_auto_assign_enabled_idx"
  ON "campaigns" ("auto_assign_enabled")
  WHERE "auto_assign_enabled" = true;
