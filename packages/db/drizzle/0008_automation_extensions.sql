-- Auto-assign rules op campagnes + reply-triage opslag op leads.

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
  ADD COLUMN IF NOT EXISTS "auto_assign_max_leads" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_auto_assign_enabled_idx"
  ON "campaigns" ("auto_assign_enabled")
  WHERE "auto_assign_enabled" = true;
--> statement-breakpoint
ALTER TABLE "campaign_leads"
  ADD COLUMN IF NOT EXISTS "reply_classification" text;
--> statement-breakpoint
ALTER TABLE "campaign_leads"
  ADD COLUMN IF NOT EXISTS "reply_summary" text;
--> statement-breakpoint
ALTER TABLE "campaign_leads"
  ADD COLUMN IF NOT EXISTS "reply_text" text;
