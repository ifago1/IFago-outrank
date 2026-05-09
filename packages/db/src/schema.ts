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
    enrichmentAttemptedAt: timestamp("enrichment_attempted_at", {
      withTimezone: true,
    }),
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
   * Auto-assign rules: when enabled, freshly-enriched contacts whose
   * business matches niche / city / website-quality are automatically
   * appended as campaign-leads. NULL fields act as wildcards.
   */
  autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(false),
  autoAssignNiche: text("auto_assign_niche"),
  autoAssignCity: text("auto_assign_city"),
  autoAssignWebsiteQuality: text("auto_assign_website_quality"),
  /**
   * Numeric score range over `businesses.audit_detail->>'htmlScore'`
   * (0-100). NULL = no lower / upper bound. Bucket + range can be
   * combined: e.g. bucket="outdated" AND maxScore=40 narrows to the
   * worst end of outdated.
   */
  autoAssignMinScore: integer("auto_assign_min_score"),
  autoAssignMaxScore: integer("auto_assign_max_score"),
  /** Cap on how many leads this campaign may auto-collect. NULL = unbounded. */
  autoAssignMaxLeads: integer("auto_assign_max_leads"),
  /**
   * When true, every send for this campaign gets a fresh AI-written
   * subject + body — the step's templates are passed to the model as
   * tone reference, the actual mail is regenerated per (lead, step).
   * Falls back to the templated render if the AI call fails.
   */
  aiPersonalizeFullBody: boolean("ai_personalize_full_body")
    .notNull()
    .default(false),
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
    /** AI-classified reply category: positive / question / negative / oof / referral / unknown. */
    replyClassification: text("reply_classification"),
    /** Short AI-generated summary of the reply for at-a-glance triage. */
    replySummary: text("reply_summary"),
    /** Raw plaintext body of the reply, capped to ~10kB by the worker. */
    replyText: text("reply_text"),
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
