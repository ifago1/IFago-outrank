CREATE TABLE IF NOT EXISTS "businesses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "place_id" text NOT NULL,
  "name" text NOT NULL,
  "category" text,
  "city" text,
  "country" text,
  "phone" text,
  "website_url" text,
  "website_quality" text,
  "google_rating" numeric(3, 2),
  "reviews_count" integer,
  "raw_places_data" jsonb,
  "discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "businesses_place_id_unique" ON "businesses" ("place_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "source" text,
  "is_verified" boolean DEFAULT false NOT NULL,
  "do_not_contact" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "niche" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "step_order" integer NOT NULL,
  "delay_days" integer DEFAULT 0 NOT NULL,
  "subject_template" text NOT NULL,
  "body_template" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'queued' NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "next_send_at" timestamp with time zone,
  "last_event_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emails_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_lead_id" uuid NOT NULL REFERENCES "campaign_leads"("id") ON DELETE CASCADE,
  "step_order" integer NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "message_id" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "opened_at" timestamp with time zone,
  "replied_at" timestamp with time zone,
  "bounced" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unsubscribes" (
  "email" text PRIMARY KEY NOT NULL,
  "unsubscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reason" text
);
