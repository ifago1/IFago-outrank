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
