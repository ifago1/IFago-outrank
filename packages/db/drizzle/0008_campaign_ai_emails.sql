-- Per-campagne AI-mailgeneratie toggle. Wanneer aan: subject + body
-- worden door Claude per send geschreven o.b.v. business + audit-detail
-- (incl. AI-summary van de website-content) + reviews + step. Wanneer
-- uit: de campaign blijft de statische sequence-templates gebruiken.
-- Globale AI_GENERATE_EMAILS in settings moet ook aan + ANTHROPIC_API_KEY
-- moet gezet zijn — campagne-flag is per-campagne opt-in.

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "ai_generate_emails" boolean NOT NULL DEFAULT false;
