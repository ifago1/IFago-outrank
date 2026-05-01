import { z } from "zod";

/**
 * Single source of truth for runtime env vars. Each script/process
 * validates only the slice it needs — the schema below is a superset.
 *
 * Usage:
 *   import { loadConfig } from "@outreach/config";
 *   const cfg = loadConfig("send-tick");
 */

const url = z.string().url();
const nonEmpty = z.string().min(1);
const integer = z
  .string()
  .regex(/^\d+$/, "must be a non-negative integer")
  .transform(Number);
const hourOfDay = integer.refine((n) => n >= 0 && n <= 24, "0 <= hour <= 24");
const weekdaysCsv = z
  .string()
  .regex(/^[1-7](\s*,\s*[1-7])*$/, "comma-separated ISO weekdays 1-7");

/** Slice consumed by every database-backed CLI / process. */
const DbSlice = z.object({
  DATABASE_URL: url,
});

/** Discover (Google Places) — discover script. */
const DiscoverSlice = z.object({
  GOOGLE_PLACES_API_KEY: nonEmpty,
});

/** Mailer — send-tick + worker. */
const MailerSlice = z.object({
  POSTMARK_SERVER_TOKEN: nonEmpty,
  FROM_EMAIL: z.string().email(),
  FROM_NAME: nonEmpty,
  REPLY_TO_EMAIL: z.string().email().optional(),
  PUBLIC_BASE_URL: url,
  UNSUBSCRIBE_SECRET: z.string().min(16, "min 16 chars"),
  DAILY_SEND_LIMIT: integer.optional(),
  SEND_WINDOW_START: hourOfDay.optional(),
  SEND_WINDOW_END: hourOfDay.optional(),
  SEND_WEEKDAYS: weekdaysCsv.optional(),
  // Domain warmup — set both to enable the linear ramp.
  WARMUP_DAYS: integer.optional(),
  WARMUP_FLOOR: integer.optional(),
  // Bounce circuit breaker — set BOUNCE_THRESHOLD to enable.
  BOUNCE_THRESHOLD: z
    .string()
    .regex(/^0?\.\d+$|^[01]$/, "0..1 decimal")
    .transform(Number)
    .optional(),
  BOUNCE_WINDOW: integer.optional(),
  BOUNCE_MIN_SENT: integer.optional(),
});

/** Inbound webhook handler. */
const WebhookSlice = z.object({
  POSTMARK_INBOUND_WEBHOOK_SECRET: z.string().min(16, "min 16 chars"),
});

/** Optional AI personalization. */
const AiSlice = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
});

/** Optional enrichment. */
const EnrichmentSlice = z.object({
  HUNTER_API_KEY: z.string().optional(),
});

/** BullMQ worker / scheduler. */
const QueueSlice = z.object({
  REDIS_URL: url,
  TICK_BATCH_SIZE: integer.optional(),
});

/** Dashboard auth (optional — when both set, basic auth is enforced). */
const DashboardSlice = z.object({
  DASHBOARD_AUTH_USER: z.string().optional(),
  DASHBOARD_AUTH_PASS: z.string().optional(),
});

/** Per-process schema selection. Add to this map when you add a script. */
const PROFILES = {
  discover: DbSlice.merge(DiscoverSlice),
  enrich: DbSlice.merge(EnrichmentSlice),
  "score-websites": DbSlice,
  "seed-campaign": DbSlice,
  "assign-leads": DbSlice,
  "send-tick": DbSlice.merge(MailerSlice).merge(AiSlice),
  worker: DbSlice.merge(MailerSlice).merge(QueueSlice).merge(AiSlice),
  "schedule-ticks": QueueSlice,
  webhook: DbSlice.merge(WebhookSlice),
  web: DbSlice.merge(MailerSlice).merge(WebhookSlice).merge(DashboardSlice),
} as const;

export type Profile = keyof typeof PROFILES;

export class ConfigError extends Error {
  constructor(
    public readonly profile: Profile,
    public readonly issues: z.ZodIssue[],
  ) {
    super(
      `Invalid env for profile "${profile}":\n` +
        issues
          .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n"),
    );
    this.name = "ConfigError";
  }
}

/**
 * Validate `process.env` against the slice required by `profile`. Throws
 * a `ConfigError` listing every problem (not just the first), so a single
 * startup error message tells you everything that's wrong.
 */
export function loadConfig<P extends Profile>(
  profile: P,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<(typeof PROFILES)[P]> {
  const schema = PROFILES[profile];
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(profile, parsed.error.issues);
  }
  return parsed.data as z.infer<(typeof PROFILES)[P]>;
}

/**
 * Convenience: validate at module-load time, exit the process with a
 * helpful message on failure. Use in CLI entry points.
 */
export function loadConfigOrExit<P extends Profile>(profile: P) {
  try {
    return loadConfig(profile);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
