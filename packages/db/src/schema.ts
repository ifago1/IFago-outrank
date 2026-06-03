import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    city: text("city"),
    country: text("country"),
    phone: text("phone"),
    websiteUrl: text("website_url"),
    websiteQuality: text("website_quality"),
    googleRating: numeric("google_rating", { precision: 3, scale: 2 }),
    reviewsCount: integer("reviews_count"),
    rawPlacesData: jsonb("raw_places_data"),
    personalObservation: text("personal_observation"),
    personalObservationSource: text("personal_observation_source"),
    auditDetail: jsonb("audit_detail"),
    auditedAt: timestamp("audited_at", { withTimezone: true }),
    /**
     * Phone-call pipeline. Null = nog niet gebeld. Anders een van
     * called / voicemail / callback / interested / not_interested /
     * wrong_number. UI op /phone past het zicht én eventueel de
     * lead-pipeline aan (DNC bij not_interested + wrong_number).
     */
    phoneStatus: text("phone_status"),
    phoneCalledAt: timestamp("phone_called_at", { withTimezone: true }),
    phoneNotes: text("phone_notes"),
    /**
     * Wanneer deze lead weer in de Open-bel-bucket mag verschijnen.
     * Cadence: voicemail → +3 werkdagen, callback → user-defined
     * datum, called (generic) → +7 dagen. Null = nooit gebeld of
     * helemaal afgehandeld.
     */
    phoneNextAttemptAt: timestamp("phone_next_attempt_at", { withTimezone: true }),
    /** Hoeveel bel-pogingen er al zijn gelogd. Default 0. */
    phoneAttempts: integer("phone_attempts").notNull().default(0),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    placeIdUnique: uniqueIndex("businesses_place_id_unique").on(table.placeId),
  }),
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    source: text("source"),
    isVerified: boolean("is_verified").notNull().default(false),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    businessEmailUnique: uniqueIndex("contacts_business_email_unique").on(
      table.businessId,
      table.email,
    ),
  }),
);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  niche: text("niche"),
  status: text("status").notNull().default("draft"),
  /**
   * Auto-assign: leads matchen op de filters hieronder worden
   * automatisch aan deze campagne toegevoegd (mits ze een contact
   * hebben). Default uit zodat bestaande campagnes opt-in zijn.
   */
  autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(false),
  /** Single keyword, case-insensitive substring tegen Google Places-categorie. */
  autoAssignNiche: text("auto_assign_niche"),
  /** Case-insensitive exact tegen `businesses.city`. */
  autoAssignCity: text("auto_assign_city"),
  /** Bucket: good / decent / outdated / none. */
  autoAssignWebsiteQuality: text("auto_assign_website_quality"),
  /** Inclusieve ondergrens op businesses.audit_detail.htmlScore (0-100). */
  autoAssignMinScore: integer("auto_assign_min_score"),
  /** Inclusieve bovengrens op businesses.audit_detail.htmlScore (0-100). */
  autoAssignMaxScore: integer("auto_assign_max_score"),
  /** Cap op het totaal-aantal leads in deze campagne via auto-assign. */
  autoAssignMaxLeads: integer("auto_assign_max_leads"),
  /**
   * Per-campagne AI-mailgeneratie: wanneer aan en globale
   * AI_GENERATE_EMAILS staat ook aan, schrijft Claude per send subject
   * + body o.b.v. business + audit (incl. website-content-samenvatting)
   * + reviews. Bij failure terugval op sequence-template.
   */
  aiGenerateEmails: boolean("ai_generate_emails").notNull().default(false),
  /**
   * Wanneer aan: leads die telefonisch "interesse" hebben aangegeven
   * worden automatisch in deze campagne gezet. De first-step prompt
   * krijgt de bel-notitie als context (zodat AI er concreet aan kan
   * refereren). Slechts één campagne mag dit aan hebben — UI zorgt
   * voor uniciteit.
   */
  warmFollowupTarget: boolean("warm_followup_target").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  delayDays: integer("delay_days").notNull().default(0),
  subjectTemplate: text("subject_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
});

export const sequenceStepVariants = pgTable("sequence_step_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  stepId: uuid("step_id")
    .notNull()
    .references(() => sequenceSteps.id, { onDelete: "cascade" }),
  /** Human-readable label, e.g. "A", "B", "short-subject". */
  label: text("label").notNull(),
  /** Selection weight (1-100). Variants with higher weight are picked more often. */
  weight: integer("weight").notNull().default(1),
  subjectTemplate: text("subject_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
});

export const campaignLeads = pgTable(
  "campaign_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    currentStep: integer("current_step").notNull().default(0),
    nextSendAt: timestamp("next_send_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    campaignContactUnique: uniqueIndex(
      "campaign_leads_campaign_contact_unique",
    ).on(table.campaignId, table.contactId),
  }),
);

export const emailsSent = pgTable("emails_sent", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignLeadId: uuid("campaign_lead_id")
    .notNull()
    .references(() => campaignLeads.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  variantId: uuid("variant_id").references(() => sequenceStepVariants.id, {
    onDelete: "set null",
  }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  bounced: boolean("bounced").notNull().default(false),
  /**
   * True wanneer de inhoud door Claude geschreven is (i.p.v. via het
   * sequence-template). Zichtbaar als badge in /sent/<id> en de
   * verzendgeschiedenis per lead.
   */
  aiGenerated: boolean("ai_generated").notNull().default(false),
});

/**
 * Append-only event-stream per business. Voedt de /leads/<id>
 * timeline + later analytics. Voorbeeld-types:
 *   mail_sent         (payload: { stepOrder, subject, messageId })
 *   mail_opened       (payload: { stepOrder })
 *   mail_replied      (payload: { stepOrder, classification?, summary? })
 *   mail_bounced      (payload: { stepOrder })
 *   phone_status      (payload: { status, notes, nextAttemptAt })
 *   unsubscribed      (payload: { email })
 *   audit_completed   (payload: { bucket, htmlScore, aiScore })
 *   auto_assigned     (payload: { campaignId, reason })
 */
export const leadEvents = pgTable("lead_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  /** Event-type, zie comment hierboven. */
  type: text("type").notNull(),
  /** "mail" / "phone" / "system" / "audit" — voor groepering in UI. */
  source: text("source").notNull(),
  /** Optionele structured data. JSON-serialisable. */
  payload: jsonb("payload"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Runtime-editable settings (mailer creds, API keys, send-window,
 * warmup, etc). Values here override env vars at request/tick time.
 *
 * `is_secret` flips the dashboard form to a masked input — UI never
 * surfaces the current value to prevent shoulder-surfing leaks.
 *
 * A few config items deliberately stay in `.env` only:
 *   DATABASE_URL, REDIS_URL  — needed to even *read* this table
 *   UNSUBSCRIBE_SECRET       — changing it invalidates outstanding tokens
 *   DASHBOARD_AUTH_*         — letting the dashboard mutate its own auth
 *                              creates a lockout / privilege-escalation
 *                              footgun
 */
/**
 * Saved discovery search — define once, the scheduler runs it on its
 * configured interval and upserts new businesses into the leads pool.
 */
export const savedSearches = pgTable("saved_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  niche: text("niche").notNull(),
  city: text("city").notNull(),
  /** Optional radius in meters; without it the search is text-only. */
  radiusMeters: integer("radius_meters"),
  /** Pages of 20 results to walk; max 3. */
  maxPages: integer("max_pages").notNull().default(1),
  /** When false, the scheduler skips this search but you can still run it manually. */
  scheduleEnabled: boolean("schedule_enabled").notNull().default(true),
  /** Re-run cadence in days. Default 7 = weekly refresh. */
  scheduleIntervalDays: integer("schedule_interval_days").notNull().default(7),
  /** Set by the scheduler / manual run — last completed run, regardless of result. */
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  /** JSON blob with the most recent run's outcome (found/upserted/error). */
  lastRunResult: jsonb("last_run_result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  isSecret: boolean("is_secret").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const unsubscribes = pgTable("unsubscribes", {
  email: text("email").primaryKey(),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reason: text("reason"),
});

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type SequenceStepVariant = typeof sequenceStepVariants.$inferSelect;
export type NewSequenceStepVariant = typeof sequenceStepVariants.$inferInsert;
export type CampaignLead = typeof campaignLeads.$inferSelect;
export type EmailSent = typeof emailsSent.$inferSelect;
export type Unsubscribe = typeof unsubscribes.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type SavedSearch = typeof savedSearches.$inferSelect;
export type NewSavedSearch = typeof savedSearches.$inferInsert;
