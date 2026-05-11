-- Defense-in-depth: prevent same email landing in campaign_leads twice
-- (across any campaign, ongeacht status). De application-layer filter
-- in @outreach/enrichment + scripts/assign-leads is de eerste verdedi-
-- gingslinie; deze trigger is de DB-level guard die opnieuw insert blokt
-- als iets de filter omzeilt (handmatige SQL, nieuwe code path, etc).

CREATE OR REPLACE FUNCTION enforce_unique_email_in_campaign_leads()
RETURNS TRIGGER AS $$
DECLARE
  v_email TEXT;
  v_existing UUID;
BEGIN
  SELECT LOWER(email) INTO v_email
  FROM contacts
  WHERE id = NEW.contact_id;

  -- Contact zonder email — laat door (theoretisch onmogelijk gegeven het
  -- NOT NULL op contacts.email, maar defensief).
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cl.id INTO v_existing
  FROM campaign_leads cl
  JOIN contacts ct ON ct.id = cl.contact_id
  WHERE LOWER(ct.email) = v_email
    AND cl.id IS DISTINCT FROM NEW.id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'campaign_lead with email % already exists (campaign_lead.id=%)',
      v_email, v_existing
      USING ERRCODE = 'unique_violation',
            HINT = 'Een email-adres mag maximaal in één campaign_lead voorkomen. Verwijder de bestaande lead eerst.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS campaign_leads_enforce_unique_email ON campaign_leads;
--> statement-breakpoint

CREATE TRIGGER campaign_leads_enforce_unique_email
BEFORE INSERT OR UPDATE OF contact_id ON campaign_leads
FOR EACH ROW
EXECUTE FUNCTION enforce_unique_email_in_campaign_leads();
