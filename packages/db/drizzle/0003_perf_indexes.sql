-- Hot path: runSendTick.fetchDueLeads filters on (status, next_send_at).
-- Without this index, sequential scan once you have >50k leads.
CREATE INDEX IF NOT EXISTS "campaign_leads_due"
  ON "campaign_leads" ("status", "next_send_at")
  WHERE "status" IN ('queued', 'sent');
--> statement-breakpoint
-- Bounce / reply matcher hits emails_sent.message_id often — string lookup.
CREATE INDEX IF NOT EXISTS "emails_sent_message_id"
  ON "emails_sent" ("message_id")
  WHERE "message_id" IS NOT NULL;
--> statement-breakpoint
-- /stats per-campaign queries filter by campaign_id often. The PK already
-- covers it for simple lookups; this composite helps the per-step joins.
CREATE INDEX IF NOT EXISTS "emails_sent_campaign_lead_step"
  ON "emails_sent" ("campaign_lead_id", "step_order");
--> statement-breakpoint
-- /inbox sorts by last_event_at desc — composite with the status filter.
CREATE INDEX IF NOT EXISTS "campaign_leads_inbox"
  ON "campaign_leads" ("last_event_at" DESC)
  WHERE "status" IN ('replied', 'bounced');
