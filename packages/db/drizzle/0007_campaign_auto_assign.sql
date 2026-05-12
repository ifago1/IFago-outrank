-- Auto-assign rules per campaign: leads die matchen op niche/locatie/
-- website-kwaliteit gaan automatisch in deze campagne (mits ze een
-- contact hebben). text[] kolommen voor flexibele match-sets;
-- auto_assign_enabled default false zodat bestaande campagnes opt-in.

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "match_niches" text[];
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "match_cities" text[];
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "match_website_qualities" text[];
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "match_priority" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_auto_assign_active"
  ON "campaigns" ("auto_assign_enabled", "status")
  WHERE "auto_assign_enabled" = true AND "status" = 'active';
