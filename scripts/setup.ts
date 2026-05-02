#!/usr/bin/env tsx
/**
 * Interactive .env generator. Prompts for the values you must supply,
 * auto-generates the secrets you shouldn't have to think about, and
 * writes a fully validated .env atomically.
 *
 * Run from the repo root:
 *   pnpm setup
 *
 * Idempotent: if .env already exists you're offered keep / overwrite /
 * abort. Re-running on a partially-filled .env preserves values you've
 * already set.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomBytes } from "node:crypto";

type DefaultFn = (answers: Record<string, string>) => string;

interface Question {
  key: string;
  prompt: string;
  default?: string | DefaultFn;
  required?: boolean;
  /** Hide input in the terminal (for passwords). */
  secret?: boolean;
  /** Only ask when the predicate matches the so-far answers. */
  when?: (answers: Record<string, string>) => boolean;
  /** Optional value validator — return null on OK, string error otherwise. */
  validate?: (v: string) => string | null;
  /** Free-form context shown above the prompt (one-time, not part of the question). */
  hint?: string;
}

const ENV_PATH = path.resolve(process.cwd(), ".env");
const TEMPLATE_PATH = path.resolve(process.cwd(), ".env.example");

const QUESTIONS: Question[] = [
  // ---- Database ----
  {
    key: "POSTGRES_PASSWORD",
    prompt: "Postgres password",
    default: (() => randomSecret(24)) as DefaultFn,
    required: true,
    secret: true,
    hint: "Used by both Postgres and the app to authenticate. Auto-generated.",
  },
  {
    key: "DATABASE_URL",
    prompt: "DATABASE_URL",
    default: (a) =>
      `postgres://outreach:${a["POSTGRES_PASSWORD"] ?? "outreach"}@postgres:5432/outreach`,
    required: true,
    hint:
      "Inside docker-compose, hostname is `postgres`. For external Postgres (Neon/Supabase), paste the full URL.",
  },
  {
    key: "REDIS_URL",
    prompt: "REDIS_URL",
    default: "redis://redis:6379",
    required: true,
  },

  // ---- Domain ----
  {
    key: "DOMAIN",
    prompt: "Public domain (e.g. outreach.agency.nl)",
    required: true,
    validate: (v) =>
      /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v) ? null : "Use a bare hostname, no protocol",
    hint: "DNS A-record for this name must point at the VPS before HTTPS will work.",
  },
  {
    key: "ACME_EMAIL",
    prompt: "Email for Let's Encrypt notices",
    required: true,
    validate: (v) => (v.includes("@") ? null : "Must be an email address"),
  },
  {
    key: "PUBLIC_BASE_URL",
    prompt: "PUBLIC_BASE_URL",
    default: (a) => `https://${a["DOMAIN"] ?? "localhost"}`,
    required: true,
    hint: "Used in unsubscribe links inside outgoing mails.",
  },

  // ---- Mail provider ----
  {
    key: "MAILER_PROVIDER",
    prompt: "Mail provider (postmark or smtp)",
    default: "postmark",
    required: true,
    validate: (v) =>
      v === "postmark" || v === "smtp" ? null : "Must be 'postmark' or 'smtp'",
  },

  // ---- Postmark branch ----
  {
    key: "POSTMARK_SERVER_TOKEN",
    prompt: "Postmark server token",
    required: true,
    secret: true,
    when: (a) => a["MAILER_PROVIDER"] === "postmark",
  },
  {
    key: "POSTMARK_INBOUND_WEBHOOK_SECRET",
    prompt: "Postmark inbound webhook secret",
    default: (() => randomSecret(24)) as DefaultFn,
    required: true,
    secret: true,
    when: (a) => a["MAILER_PROVIDER"] === "postmark",
    hint:
      "Configure this exact value as the URL secret on Postmark's Webhook page; we accept it via Authorization: Bearer or ?secret=.",
  },

  // ---- SMTP branch ----
  {
    key: "SMTP_HOST",
    prompt: "SMTP host (e.g. smtp.fastmail.com)",
    required: true,
    when: (a) => a["MAILER_PROVIDER"] === "smtp",
  },
  {
    key: "SMTP_PORT",
    prompt: "SMTP port (587 = STARTTLS, 465 = TLS)",
    default: "587",
    required: true,
    when: (a) => a["MAILER_PROVIDER"] === "smtp",
    validate: (v) => (/^\d+$/.test(v) ? null : "Must be a port number"),
  },
  {
    key: "SMTP_USER",
    prompt: "SMTP username",
    required: true,
    when: (a) => a["MAILER_PROVIDER"] === "smtp",
  },
  {
    key: "SMTP_PASS",
    prompt: "SMTP password",
    required: true,
    secret: true,
    when: (a) => a["MAILER_PROVIDER"] === "smtp",
  },
  {
    key: "SMTP_SECURE",
    prompt: "SMTP_SECURE (true for port 465, false for 587)",
    default: (a) => (a["SMTP_PORT"] === "465" ? "true" : "false"),
    when: (a) => a["MAILER_PROVIDER"] === "smtp",
  },

  // ---- Sender identity ----
  {
    key: "FROM_EMAIL",
    prompt: "From address (your sending email)",
    required: true,
    validate: (v) => (v.includes("@") ? null : "Must be an email address"),
  },
  {
    key: "FROM_NAME",
    prompt: "From name (your name as it appears in the inbox)",
    required: true,
  },
  {
    key: "REPLY_TO_EMAIL",
    prompt: "Reply-To address (optional, press enter to skip)",
    default: (a) => a["FROM_EMAIL"] ?? "",
  },

  // ---- Secrets ----
  {
    key: "UNSUBSCRIBE_SECRET",
    prompt: "UNSUBSCRIBE_SECRET",
    default: (() => randomSecret(32)) as DefaultFn,
    required: true,
    secret: true,
    hint: "Auto-generated. Don't share — anyone with this can craft fake unsubscribe links.",
  },

  // ---- Dashboard auth ----
  {
    key: "DASHBOARD_AUTH_USER",
    prompt: "Dashboard username (leave blank to disable HTTP basic auth)",
    default: "admin",
  },
  {
    key: "DASHBOARD_AUTH_PASS",
    prompt: "Dashboard password",
    default: (() => randomSecret(16)) as DefaultFn,
    secret: true,
    when: (a) => Boolean(a["DASHBOARD_AUTH_USER"]),
    hint: "Auto-generated. Save this — you'll need it to log into the dashboard.",
  },

  // ---- External APIs ----
  {
    key: "GOOGLE_PLACES_API_KEY",
    prompt: "Google Places API key (also enables Geocoding + PSI)",
    required: true,
    secret: true,
  },
  {
    key: "ANTHROPIC_API_KEY",
    prompt: "Anthropic API key (optional — leave blank for heuristic-only)",
    secret: true,
  },
  {
    key: "AI_MODEL",
    prompt: "Claude model (default claude-opus-4-7; haiku-4-5 = ~5x cheaper)",
    default: "claude-opus-4-7",
    when: (a) => Boolean(a["ANTHROPIC_API_KEY"]),
  },
  {
    key: "HUNTER_API_KEY",
    prompt: "Hunter.io API key (optional — improves enrichment)",
    secret: true,
  },

  // ---- Sending hygiene ----
  {
    key: "DAILY_SEND_LIMIT",
    prompt: "DAILY_SEND_LIMIT (max mails/day)",
    default: "50",
  },
  {
    key: "WARMUP_DAYS",
    prompt:
      "WARMUP_DAYS (days to ramp from floor → daily limit; blank = no warmup)",
    default: "14",
  },
  {
    key: "WARMUP_FLOOR",
    prompt: "WARMUP_FLOOR (day-0 cap)",
    default: "5",
    when: (a) => Boolean(a["WARMUP_DAYS"]),
  },
  {
    key: "BOUNCE_THRESHOLD",
    prompt:
      "BOUNCE_THRESHOLD (halt sending if recent bounce-rate > this; e.g. 0.05; blank = off)",
    default: "0.05",
  },
];

async function main(): Promise<void> {
  await ensureRunFromRepoRoot();
  const existing = await readExistingEnv();
  if (existing && !(await confirmOverwrite(existing.size))) {
    console.log("Aborted — existing .env left untouched.");
    return;
  }

  const rl = readline.createInterface({ input, output });
  const answers: Record<string, string> = Object.fromEntries(existing ?? []);

  console.log(
    `\nOutreach setup wizard\n=====================\nFill in the prompts; pressing enter accepts the [bracketed default].\nPress Ctrl-C to abort.\n`,
  );

  try {
    for (const q of QUESTIONS) {
      if (q.when && !q.when(answers)) continue;

      const def = resolveDefault(q.default, answers);
      const existingValue = answers[q.key];
      const initial = existingValue ?? def ?? "";

      if (q.hint && !existingValue) {
        console.log(`  ${dim(q.hint)}`);
      }

      const value = await ask(rl, q.prompt, {
        default: initial,
        ...(q.secret !== undefined ? { secret: q.secret } : {}),
        ...(q.required !== undefined ? { required: q.required } : {}),
        ...(q.validate !== undefined ? { validate: q.validate } : {}),
      });
      if (value !== "") answers[q.key] = value;
    }
  } finally {
    rl.close();
  }

  await writeEnv(answers);
  console.log(
    `\n✓ Wrote ${ENV_PATH}\n  Next: docker compose -f docker-compose.prod.yml up -d --build`,
  );
  if (answers["DASHBOARD_AUTH_PASS"]) {
    console.log(
      `\n  Dashboard credentials: ${answers["DASHBOARD_AUTH_USER"] ?? "admin"} / ${answers["DASHBOARD_AUTH_PASS"]}`,
    );
    console.log("  (Saved in .env. Note this down somewhere safe.)");
  }
}

async function ensureRunFromRepoRoot(): Promise<void> {
  try {
    await fs.access(TEMPLATE_PATH);
  } catch {
    console.error(
      "Run this from the repo root (couldn't find .env.example next to me).",
    );
    process.exit(1);
  }
}

async function readExistingEnv(): Promise<Map<string, string> | null> {
  try {
    const raw = await fs.readFile(ENV_PATH, "utf8");
    const map = new Map<string, string>();
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) map.set(m[1]!, stripQuotes(m[2]!));
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

async function confirmOverwrite(existingKeys: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = (
    await rl.question(
      `\n.env already exists with ${existingKeys} key(s). Overwrite (existing values shown as defaults)? [y/N] `,
    )
  )
    .trim()
    .toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

function resolveDefault(
  d: Question["default"],
  answers: Record<string, string>,
): string | undefined {
  if (typeof d === "function") return d(answers);
  return d;
}

interface AskOpts {
  default?: string;
  secret?: boolean;
  required?: boolean;
  validate?: Question["validate"];
}

async function ask(
  rl: readline.Interface,
  prompt: string,
  opts: AskOpts,
): Promise<string> {
  const def = opts.default ?? "";
  const display = def ? (opts.secret ? "••••••" : def) : "";
  const suffix = display ? ` [${display}]` : opts.required ? " (required)" : "";

  while (true) {
    const raw = (await rl.question(`${prompt}${suffix}: `)).trim();
    const value = raw || def;
    if (!value) {
      if (!opts.required) return "";
      console.log("  ! required.");
      continue;
    }
    if (opts.validate) {
      const err = opts.validate(value);
      if (err) {
        console.log(`  ! ${err}`);
        continue;
      }
    }
    return value;
  }
}

async function writeEnv(answers: Record<string, string>): Promise<void> {
  const lines: string[] = [
    "# Generated by `pnpm setup` — edit by hand or re-run the wizard.",
    `# Generated at ${new Date().toISOString()}`,
    "",
  ];
  for (const [k, v] of Object.entries(answers)) {
    lines.push(`${k}=${quoteIfNeeded(v)}`);
  }
  const content = lines.join("\n") + "\n";

  // Atomic write: temp file + rename so a crashed wizard never leaves a
  // half-written .env.
  const tmp = `${ENV_PATH}.tmp.${process.pid}`;
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, ENV_PATH);
}

function quoteIfNeeded(v: string): string {
  // Quote when value contains whitespace, $, or quote chars.
  if (/^[A-Za-z0-9._\-/:@+=]*$/.test(v)) return v;
  return `"${v.replace(/(["\\$])/g, "\\$1")}"`;
}

function stripQuotes(v: string): string {
  const m = v.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!m) return v;
  return m[1]!.replace(/\\(["\\$])/g, "$1");
}

function randomSecret(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function dim(s: string): string {
  return process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
