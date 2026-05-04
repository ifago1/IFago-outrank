CREATE TABLE IF NOT EXISTS "saved_searches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "niche" text NOT NULL,
  "city" text NOT NULL,
  "radius_meters" integer,
  "max_pages" integer DEFAULT 1 NOT NULL,
  "schedule_enabled" boolean DEFAULT true NOT NULL,
  "schedule_interval_days" integer DEFAULT 7 NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_run_result" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_searches_due"
  ON "saved_searches" ("schedule_enabled", "last_run_at");
