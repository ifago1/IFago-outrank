/**
 * Build a fresh runSendTick config from a merged env+DB-settings snapshot.
 * Called per tick by the worker / per invocation by send-tick CLI so any
 * dashboard-saved setting takes effect on the very next tick — no
 * service restart needed.
 */
import { type Db } from "@outreach/db";
import { createMailer, type Mailer } from "@outreach/mailer";
import {
  AnthropicBodyWriter,
  AnthropicPersonalizer,
} from "@outreach/ai-personalization";
import {
  DEFAULT_SEND_WINDOW,
  type RunTickConfig,
} from "@outreach/sequencer";
import { resolveRuntimeSettings } from "@outreach/config";

export interface BuildRuntimeConfigInput {
  db: Db;
  /** Required, comes from .env (not editable in dashboard). */
  unsubscribeSecret: string;
  /**
   * Override config-builder fallbacks per call. Useful for `send-tick
   * --dry-run` which swaps the mailer for a MockMailer.
   */
  mailerOverride?: Mailer;
  dryRun?: boolean;
  batchSize?: number;
}

export async function buildRuntimeConfig(
  input: BuildRuntimeConfigInput,
): Promise<RunTickConfig> {
  const cfg = await resolveRuntimeSettings(input.db);

  const mailer = input.mailerOverride ?? buildMailer(cfg);
  const personalizer = cfg.ANTHROPIC_API_KEY
    ? new AnthropicPersonalizer({
        apiKey: cfg.ANTHROPIC_API_KEY,
        ...(cfg.AI_MODEL ? { model: cfg.AI_MODEL } : {}),
      })
    : undefined;
  // Body writer reuses the same Anthropic key but defaults to a cheaper
  // Haiku model (per-send call, runs many times per day). Override via
  // AI_BODY_MODEL.
  const bodyWriter = cfg.ANTHROPIC_API_KEY
    ? new AnthropicBodyWriter({
        apiKey: cfg.ANTHROPIC_API_KEY,
        ...(cfg.AI_BODY_MODEL ? { model: cfg.AI_BODY_MODEL } : {}),
      })
    : undefined;

  const window = {
    startHour: cfg.SEND_WINDOW_START
      ? Number(cfg.SEND_WINDOW_START)
      : DEFAULT_SEND_WINDOW.startHour,
    endHour: cfg.SEND_WINDOW_END
      ? Number(cfg.SEND_WINDOW_END)
      : DEFAULT_SEND_WINDOW.endHour,
    weekdays: cfg.SEND_WEEKDAYS
      ? cfg.SEND_WEEKDAYS.split(",").map((s) => Number(s.trim()))
      : DEFAULT_SEND_WINDOW.weekdays,
  };

  const warmup =
    cfg.WARMUP_DAYS && cfg.WARMUP_FLOOR
      ? { days: Number(cfg.WARMUP_DAYS), floor: Number(cfg.WARMUP_FLOOR) }
      : undefined;

  const bounceCircuit = cfg.BOUNCE_THRESHOLD
    ? {
        threshold: Number(cfg.BOUNCE_THRESHOLD),
        ...(cfg.BOUNCE_WINDOW
          ? { windowSize: Number(cfg.BOUNCE_WINDOW) }
          : {}),
        ...(cfg.BOUNCE_MIN_SENT
          ? { minSent: Number(cfg.BOUNCE_MIN_SENT) }
          : {}),
      }
    : undefined;

  const thompsonSampling =
    cfg.VARIANT_SELECTION === "thompson" || cfg.THOMPSON_SAMPLING === "true";

  const smartWarmup =
    cfg.SMART_WARMUP === "true"
      ? {
          ...(cfg.SMART_WARMUP_WINDOW
            ? { windowSize: Number(cfg.SMART_WARMUP_WINDOW) }
            : {}),
          ...(cfg.SMART_WARMUP_MIN_SENT
            ? { minSent: Number(cfg.SMART_WARMUP_MIN_SENT) }
            : {}),
        }
      : undefined;

  return {
    db: input.db,
    mailer,
    fromEmail: cfg.FROM_EMAIL ?? "noreply@example.com",
    fromName: cfg.FROM_NAME ?? "Outreach",
    ...(cfg.REPLY_TO_EMAIL ? { replyTo: cfg.REPLY_TO_EMAIL } : {}),
    publicBaseUrl: cfg.PUBLIC_BASE_URL ?? "http://localhost:3000",
    unsubscribeSecret: input.unsubscribeSecret,
    dailyLimit: cfg.DAILY_SEND_LIMIT
      ? Number(cfg.DAILY_SEND_LIMIT)
      : 50,
    window,
    batchSize: input.batchSize ?? (cfg.TICK_BATCH_SIZE ? Number(cfg.TICK_BATCH_SIZE) : 50),
    ...(warmup ? { warmup } : {}),
    ...(bounceCircuit ? { bounceCircuit } : {}),
    ...(smartWarmup ? { smartWarmup } : {}),
    ...(input.dryRun ? { dryRun: input.dryRun } : {}),
    ...(thompsonSampling ? { thompsonSampling: true } : {}),
    ...(cfg.EMAIL_SIGNATURE ? { signature: cfg.EMAIL_SIGNATURE } : {}),
    personalizer,
    bodyWriter,
  };
}

function buildMailer(cfg: Record<string, string | undefined>): Mailer {
  const provider = (cfg["MAILER_PROVIDER"] as "postmark" | "smtp") ?? "postmark";
  if (provider === "smtp") {
    return createMailer({
      provider: "smtp",
      smtp: {
        host: cfg["SMTP_HOST"] ?? "",
        port: cfg["SMTP_PORT"] ? Number(cfg["SMTP_PORT"]) : 587,
        user: cfg["SMTP_USER"] ?? "",
        pass: cfg["SMTP_PASS"] ?? "",
        ...(cfg["SMTP_SECURE"] !== undefined
          ? { secure: cfg["SMTP_SECURE"] === "true" }
          : {}),
        ...(cfg["SMTP_MAX_CONNECTIONS"]
          ? { maxConnections: Number(cfg["SMTP_MAX_CONNECTIONS"]) }
          : {}),
        ...(cfg["SMTP_RATE_LIMIT"]
          ? { rateLimit: Number(cfg["SMTP_RATE_LIMIT"]) }
          : {}),
        ...(cfg["SMTP_RATE_DELTA_MS"]
          ? { rateDelta: Number(cfg["SMTP_RATE_DELTA_MS"]) }
          : {}),
        from: cfg["FROM_EMAIL"] ?? "noreply@example.com",
        fromName: cfg["FROM_NAME"] ?? "Outreach",
        ...(cfg["REPLY_TO_EMAIL"] ? { replyTo: cfg["REPLY_TO_EMAIL"] } : {}),
      },
    });
  }
  return createMailer({
    provider: "postmark",
    postmark: {
      serverToken: cfg["POSTMARK_SERVER_TOKEN"] ?? "",
      from: cfg["FROM_EMAIL"] ?? "noreply@example.com",
      fromName: cfg["FROM_NAME"] ?? "Outreach",
      ...(cfg["REPLY_TO_EMAIL"] ? { replyTo: cfg["REPLY_TO_EMAIL"] } : {}),
      defaultTag: "outreach",
    },
  });
}
