CREATE UNIQUE INDEX IF NOT EXISTS "contacts_business_email_unique"
  ON "contacts" ("business_id", "email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_leads_campaign_contact_unique"
  ON "campaign_leads" ("campaign_id", "contact_id");
