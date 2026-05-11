-- Auto-assign op numerieke score range + per-lead AI-personalisatie van
-- de volledige mail-body (i.p.v. alleen de personal_observation).

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_min_score" integer;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "auto_assign_max_score" integer;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "ai_personalize_full_body" boolean NOT NULL DEFAULT false;
