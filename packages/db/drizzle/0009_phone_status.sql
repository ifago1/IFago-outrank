-- Phone call tracking per lead: status van het laatste belmoment +
-- timestamp + notities. Drijft de Bellen-tab pipeline: bv. wrong-number
-- en not-interested verdwijnen, voicemail/callback blijven open,
-- interested wordt apart gehoogd.
--
-- IF NOT EXISTS voor portability — als deze migratie ooit deels door
-- een afgevoerde branch is gerund komen we niet vast te zitten.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "phone_status" text;
--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "phone_called_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "phone_notes" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "businesses_phone_status_idx"
  ON "businesses" ("phone_status")
  WHERE "phone_status" IS NOT NULL;
