import {
  getDb,
  getSettings,
  isSecretKey,
  type SettingKey,
} from "@outreach/db";
import { envSnapshot } from "@outreach/config";
import { PageHeader } from "../_ui";
import { SettingsForm } from "./settings-form";
import { TestEmailForm } from "./test-email-form";

export const dynamic = "force-dynamic";

/**
 * Definition of every editable field, grouped into form sections. The
 * dashboard renders these top-to-bottom; the form action whitelists
 * against db's SETTING_KEYS so accidental rename here can't poison
 * unknown keys into the table.
 */
export interface FieldDef {
  key: SettingKey;
  label: string;
  type: "text" | "email" | "url" | "number" | "password" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
}

interface Section {
  title: string;
  description?: string;
  fields: FieldDef[];
}

const SECTIONS: Section[] = [
  {
    title: "Mailer",
    description:
      "Postmark gebruikt een HTTP API + bounce-webhook (eenvoudiger). SMTP is voor eigen mailservers.",
    fields: [
      {
        key: "MAILER_PROVIDER",
        label: "Provider",
        type: "select",
        options: [
          { value: "postmark", label: "Postmark (HTTP API)" },
          { value: "smtp", label: "SMTP" },
        ],
      },
    ],
  },
  {
    title: "Postmark",
    description: "Alleen invullen als provider = Postmark.",
    fields: [
      {
        key: "POSTMARK_SERVER_TOKEN",
        label: "Server token",
        type: "password",
        hint: "Server-API token, vind je in Postmark → Servers → API tokens.",
      },
      {
        key: "POSTMARK_INBOUND_WEBHOOK_SECRET",
        label: "Inbound webhook secret",
        type: "password",
        hint: "Plak deze als Authorization Bearer header op de Postmark webhook URL.",
      },
    ],
  },
  {
    title: "SMTP",
    description: "Alleen invullen als provider = SMTP.",
    fields: [
      { key: "SMTP_HOST", label: "Host", type: "text", placeholder: "smtp.fastmail.com" },
      { key: "SMTP_PORT", label: "Port", type: "number", placeholder: "587" },
      { key: "SMTP_USER", label: "Username", type: "text" },
      { key: "SMTP_PASS", label: "Password", type: "password" },
      {
        key: "SMTP_SECURE",
        label: "TLS-mode",
        type: "select",
        options: [
          { value: "false", label: "STARTTLS (port 587)" },
          { value: "true", label: "Implicit TLS (port 465)" },
        ],
      },
      { key: "SMTP_MAX_CONNECTIONS", label: "Max parallel verbindingen", type: "number", placeholder: "5" },
      { key: "SMTP_RATE_LIMIT", label: "Rate limit (mails)", type: "number", hint: "Mails per RATE_DELTA_MS." },
      { key: "SMTP_RATE_DELTA_MS", label: "Rate delta (ms)", type: "number", placeholder: "1000" },
    ],
  },
  {
    title: "Afzender",
    fields: [
      { key: "FROM_EMAIL", label: "From email", type: "email", placeholder: "noreply@jouw-domein.nl", hint: "Moet een verified sender zijn bij je provider." },
      { key: "FROM_NAME", label: "From naam", type: "text" },
      { key: "REPLY_TO_EMAIL", label: "Reply-To email", type: "email", hint: "Optioneel — replies komen hier binnen." },
      { key: "PUBLIC_BASE_URL", label: "Public base URL", type: "url", placeholder: "https://outreach.jouw-domein.nl", hint: "Gebruikt in unsubscribe-links." },
    ],
  },
  {
    title: "Google APIs",
    description:
      "Voor lead discovery + radius-zoekopdrachten. Eén Google Cloud key voor beide werkt — vul 'm in bij Places API en laat Geocoding leeg, dan wordt de Places-key automatisch hergebruikt. Wil je aparte keys per API (voor cost-tracking of strakkere IAM-restrictions): vul beide velden in.",
    fields: [
      {
        key: "GOOGLE_PLACES_API_KEY",
        label: "Places API (New) — key",
        type: "password",
        hint: "Verplicht. Genereer in Google Cloud Console; restrict tot 'Places API (New)'.",
      },
      {
        key: "GOOGLE_GEOCODING_API_KEY",
        label: "Geocoding API — key",
        type: "password",
        hint: "Optioneel. Laat leeg om dezelfde key als Places te gebruiken. Vul in als je een aparte key hebt voor cost-tracking of als je de Places-key strikt tot Places API hebt beperkt.",
      },
    ],
  },
  {
    title: "Overige externe APIs",
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", type: "password", hint: "Optioneel — voor AI-personalisatie." },
      { key: "AI_MODEL", label: "AI model", type: "text", placeholder: "claude-opus-4-7", hint: "claude-haiku-4-5 is ~5x goedkoper voor één-zin output." },
      { key: "HUNTER_API_KEY", label: "Hunter.io API key", type: "password", hint: "Optioneel — voor betere email-enrichment." },
      { key: "PSI_API_KEY", label: "PageSpeed Insights API key (optioneel)", type: "password", hint: "Mag dezelfde Google-key zijn — laat leeg als je die hergebruikt." },
    ],
  },
  {
    title: "Verzendlimieten",
    description:
      "Mails worden alleen verzonden binnen het venster, met daglimiet. Warmup-ramp bouwt de daglimiet langzaam op zodat je sender reputation niet beschadigt.",
    fields: [
      { key: "DAILY_SEND_LIMIT", label: "Daglimiet (max mails/dag)", type: "number", placeholder: "50" },
      { key: "SEND_WINDOW_START", label: "Venster start (uur)", type: "number", placeholder: "9" },
      { key: "SEND_WINDOW_END", label: "Venster eind (uur)", type: "number", placeholder: "16" },
      { key: "SEND_WEEKDAYS", label: "Weekdagen (1=ma … 7=zo, csv)", type: "text", placeholder: "2,3,4" },
      {
        key: "SEND_TIMEZONE",
        label: "Tijdzone",
        type: "text",
        placeholder: "Europe/Amsterdam",
        hint: "IANA-naam waarin de start/eind-uren én weekdagen worden geïnterpreteerd. Leeg = Europe/Amsterdam (default). Containers draaien doorgaans in UTC; zonder deze setting schuift een 9-16 venster naar 11-18 lokaal in zomertijd.",
      },
      { key: "WARMUP_DAYS", label: "Warmup dagen (0 = uit)", type: "number", placeholder: "14" },
      { key: "WARMUP_FLOOR", label: "Warmup ondergrens (dag-1 cap)", type: "number", placeholder: "5" },
    ],
  },
  {
    title: "Bounce-circuit",
    description:
      "Halt het sturen automatisch als de bounce-rate stijgt — bescherming tegen reputation-schade na een slechte enrichment-batch.",
    fields: [
      { key: "BOUNCE_THRESHOLD", label: "Threshold (0..1, bv. 0.05)", type: "text", placeholder: "0.05" },
      { key: "BOUNCE_WINDOW", label: "Sample window (laatste N sends)", type: "number", placeholder: "50" },
      { key: "BOUNCE_MIN_SENT", label: "Min sample size (negeer onder N)", type: "number", placeholder: "20" },
    ],
  },
  {
    title: "Worker",
    fields: [
      { key: "TICK_BATCH_SIZE", label: "Leads per tick", type: "number", placeholder: "50" },
    ],
  },
];

export default async function SettingsPage() {
  const dbSettings = await getSettings(getDb());
  const env = envSnapshot();

  // Build the initial form values: DB-set value wins; secrets are
  // never sent down — the form replaces them with a placeholder so
  // the user can keep them as-is or overwrite.
  const initialValues: Partial<Record<SettingKey, string>> = {};
  const dbHasKey = new Set<SettingKey>();
  for (const [k, v] of dbSettings.entries()) {
    dbHasKey.add(k);
    if (isSecretKey(k)) continue; // never send secrets to the client
    initialValues[k] = v;
  }
  // For non-secret fields without a DB value, prefill the env fallback.
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      if (initialValues[f.key] !== undefined) continue;
      if (dbHasKey.has(f.key)) continue;
      const envVal = env[f.key];
      if (envVal !== undefined) initialValues[f.key] = envVal;
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Live-editbaar. Workers en webhooks lezen elke tick / request opnieuw — geen restart nodig."
      />
      <SettingsForm
        sections={SECTIONS}
        initialValues={initialValues}
        dbHasKey={[...dbHasKey]}
      />
      <TestEmailForm defaultTo={initialValues.REPLY_TO_EMAIL ?? initialValues.FROM_EMAIL ?? ""} />
    </>
  );
}
