ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "audit_detail" jsonb;
--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "audited_at" timestamp with time zone;
