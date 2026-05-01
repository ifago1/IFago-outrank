/**
 * End-to-end integration test for runSendTick. Runs against a real
 * Postgres so we exercise the SQL we actually generate (CTE behavior,
 * unique constraints, default values, the JOIN tree).
 *
 * SKIPS when TEST_DATABASE_URL is unset — local devs can opt in by
 * exporting it. CI sets it via the postgres service container in
 * .github/workflows/ci.yml.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  businesses,
  campaignLeads,
  campaigns,
  contacts,
  emailsSent,
  sequenceStepVariants,
  sequenceSteps,
  unsubscribes,
  type Db,
} from "@outreach/db";
import { MockMailer } from "@outreach/mailer";
import { runSendTick } from "./run-tick.js";

const TEST_URL = process.env["TEST_DATABASE_URL"];
const describeIfDb = TEST_URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: Db;

const NOW = new Date("2026-05-06T10:00:00"); // Wed 10:00 — inside default window
const WINDOW = { startHour: 9, endHour: 16, weekdays: [2, 3, 4] };

describeIfDb("runSendTick (integration)", () => {
  beforeAll(async () => {
    client = postgres(TEST_URL!, { max: 1 });
    db = drizzle(client) as unknown as Db;
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = path.resolve(
      __dirname,
      "../../db/drizzle",
    );
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder,
    });
  });

  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // Truncate everything between tests for isolation. Order matters
    // because of FK relationships, but TRUNCATE ... CASCADE handles it.
    await db.execute(sql`TRUNCATE
      ${unsubscribes},
      ${emailsSent},
      ${sequenceStepVariants},
      ${sequenceSteps},
      ${campaignLeads},
      ${campaigns},
      ${contacts},
      ${businesses}
      RESTART IDENTITY CASCADE`);
  });

  // Helper: create one campaign with N steps and one queued lead
  async function seedHappyPath(): Promise<{
    leadId: string;
    contactEmail: string;
  }> {
    const [biz] = await db
      .insert(businesses)
      .values({
        placeId: "test-place-1",
        name: "Kapsalon de Knipster",
        category: "kapper",
        city: "Utrecht",
        country: "Nederland",
        websiteUrl: null,
        websiteQuality: "none",
        googleRating: "4.7",
        reviewsCount: 86,
      })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({
        businessId: biz!.id,
        email: "piet@kapsalon.nl",
        firstName: "Piet",
        source: "manual",
        isVerified: true,
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        name: "Test Campaign",
        niche: "kapper",
        status: "active",
      })
      .returning();
    await db.insert(sequenceSteps).values([
      {
        campaignId: campaign!.id,
        stepOrder: 1,
        delayDays: 0,
        subjectTemplate: "Vraag over {{business_name}}",
        bodyTemplate: "Hi {{first_name}}, {{personal_observation}}",
      },
      {
        campaignId: campaign!.id,
        stepOrder: 2,
        delayDays: 4,
        subjectTemplate: "Re: Vraag over {{business_name}}",
        bodyTemplate: "Hi {{first_name}}, korte reminder",
      },
    ]);
    const [lead] = await db
      .insert(campaignLeads)
      .values({
        campaignId: campaign!.id,
        contactId: contact!.id,
        status: "queued",
        currentStep: 0,
        nextSendAt: NOW,
      })
      .returning();
    return { leadId: lead!.id, contactEmail: contact!.email };
  }

  function buildConfig(mailer: MockMailer) {
    return {
      db,
      mailer,
      now: NOW,
      fromEmail: "me@agency.nl",
      fromName: "Mij",
      publicBaseUrl: "https://x.test",
      unsubscribeSecret: "x".repeat(20),
      dailyLimit: 50,
      window: WINDOW,
      batchSize: 50,
    };
  }

  it("happy path: sends step 1, persists emails_sent + advances lead to 'sent'", async () => {
    const { leadId, contactEmail } = await seedHappyPath();
    const mailer = new MockMailer();

    const result = await runSendTick(buildConfig(mailer));

    expect(result.evaluated).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(contactEmail);
    expect(mailer.sent[0]?.subject).toBe("Vraag over Kapsalon de Knipster");
    expect(mailer.sent[0]?.text).toContain("Hi Piet");

    const sends = await db.select().from(emailsSent);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.stepOrder).toBe(1);
    expect(sends[0]?.messageId).toBe("mock-1@local");

    const updated = await db.select().from(campaignLeads);
    expect(updated[0]?.status).toBe("sent");
    expect(updated[0]?.currentStep).toBe(1);
    expect(updated[0]?.nextSendAt).not.toBeNull();
    // Step 2 has delayDays=4, so nextSendAt should be ~4 days later
    const nextSend = updated[0]?.nextSendAt
      ? new Date(updated[0]!.nextSendAt as unknown as string)
      : null;
    const diffDays = nextSend
      ? (nextSend.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000)
      : 0;
    expect(diffDays).toBeCloseTo(4, 1);
    expect(leadId).toBe(updated[0]?.id);
  });

  it("skips + marks unsubscribed when contact email is in unsubscribes", async () => {
    const { contactEmail } = await seedHappyPath();
    await db.insert(unsubscribes).values({
      email: contactEmail,
      reason: "test",
    });

    const mailer = new MockMailer();
    const result = await runSendTick(buildConfig(mailer));

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]?.reason).toBe("unsubscribed");
    expect(mailer.sent).toHaveLength(0);

    const lead = (await db.select().from(campaignLeads))[0];
    expect(lead?.status).toBe("unsubscribed");
    expect(lead?.nextSendAt).toBeNull();
  });

  it("picks a variant when defined and records variant_id on the send", async () => {
    await seedHappyPath();
    const [step1] = await db
      .select()
      .from(sequenceSteps)
      .where(sql`${sequenceSteps.stepOrder} = 1`);
    const [variantA] = await db
      .insert(sequenceStepVariants)
      .values({
        stepId: step1!.id,
        label: "A",
        weight: 1,
        subjectTemplate: "VARIANT A: {{business_name}}",
        bodyTemplate: "A body — {{first_name}}",
      })
      .returning();
    await db.insert(sequenceStepVariants).values({
      stepId: step1!.id,
      label: "B",
      weight: 0, // weight 0 -> A always wins given our deterministic random
      subjectTemplate: "VARIANT B: {{business_name}}",
      bodyTemplate: "B body — {{first_name}}",
    });

    const mailer = new MockMailer();
    const result = await runSendTick({
      ...buildConfig(mailer),
      random: () => 0, // deterministic — picks the first weighted item
    });

    expect(result.sent).toBe(1);
    expect(mailer.sent[0]?.subject).toContain("VARIANT A");

    const sends = await db.select().from(emailsSent);
    expect(sends[0]?.variantId).toBe(variantA!.id);
  });

  it("marks the lead 'completed' after sending the final step", async () => {
    const { leadId } = await seedHappyPath();
    // Manually advance to right before the last step
    await db
      .update(campaignLeads)
      .set({ currentStep: 1, nextSendAt: NOW })
      .where(sql`${campaignLeads.id} = ${leadId}`);

    const mailer = new MockMailer();
    const result = await runSendTick(buildConfig(mailer));

    expect(result.sent).toBe(1);
    const lead = (await db.select().from(campaignLeads))[0];
    expect(lead?.status).toBe("completed");
    expect(lead?.currentStep).toBe(2);
    expect(lead?.nextSendAt).toBeNull();
  });

  it("does not send when current time is outside the configured window", async () => {
    await seedHappyPath();
    const mailer = new MockMailer();
    const offHours = new Date("2026-05-06T22:00:00"); // wed 22:00

    const result = await runSendTick({
      ...buildConfig(mailer),
      now: offHours,
    });

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]?.reason).toBe("outside_send_window");
    expect(mailer.sent).toHaveLength(0);

    // Lead is *not* terminated — soft-defer; will be picked up next tick
    const lead = (await db.select().from(campaignLeads))[0];
    expect(lead?.status).toBe("queued");
    expect(lead?.nextSendAt).not.toBeNull();
  });

  it("dry-run mode: evaluates everything but does not write to DB or call mailer", async () => {
    await seedHappyPath();
    const mailer = new MockMailer();

    const result = await runSendTick({
      ...buildConfig(mailer),
      dryRun: true,
    });

    expect(result.sent).toBe(1);
    expect(result.outcomes[0]?.reason).toBe("dry_run");
    expect(mailer.sent).toHaveLength(0);

    expect(await db.select().from(emailsSent)).toHaveLength(0);
    const lead = (await db.select().from(campaignLeads))[0];
    expect(lead?.status).toBe("queued");
    expect(lead?.currentStep).toBe(0);
  });
});
