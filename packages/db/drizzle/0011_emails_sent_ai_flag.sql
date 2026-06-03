-- emails_sent.ai_generated: vlag of deze mail door Claude geschreven
-- is (campaign + global flag aan), of via het sequence-template
-- gegaan is (default). Zichtbaar als badge in /sent/<id> en de
-- verzendgeschiedenis per lead.

ALTER TABLE "emails_sent"
  ADD COLUMN IF NOT EXISTS "ai_generated" boolean NOT NULL DEFAULT false;
