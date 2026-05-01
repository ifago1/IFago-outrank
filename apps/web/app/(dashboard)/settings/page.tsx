import { PageHeader, Pill, Table } from "../_ui";

export const dynamic = "force-dynamic";

interface EnvCheck {
  name: string;
  required: boolean;
  description: string;
}

const ENV_VARS: EnvCheck[] = [
  { name: "DATABASE_URL", required: true, description: "Postgres connection" },
  { name: "GOOGLE_PLACES_API_KEY", required: true, description: "Lead discovery" },
  { name: "POSTMARK_SERVER_TOKEN", required: true, description: "Mail verzenden" },
  { name: "POSTMARK_INBOUND_WEBHOOK_SECRET", required: true, description: "Reply/bounce webhook auth" },
  { name: "FROM_EMAIL", required: true, description: "Afzender" },
  { name: "FROM_NAME", required: true, description: "Afzender (display name)" },
  { name: "REPLY_TO_EMAIL", required: false, description: "Reply-To header (optioneel)" },
  { name: "PUBLIC_BASE_URL", required: true, description: "Voor unsub-links in mails" },
  { name: "UNSUBSCRIBE_SECRET", required: true, description: "HMAC voor unsub-tokens" },
  { name: "HUNTER_API_KEY", required: false, description: "E-mail finder (optioneel)" },
  { name: "DAILY_SEND_LIMIT", required: false, description: "Default 50" },
  { name: "SEND_WINDOW_START", required: false, description: "Hour 0-23, default 9" },
  { name: "SEND_WINDOW_END", required: false, description: "Hour 1-24, default 16" },
  { name: "SEND_WEEKDAYS", required: false, description: "ISO weekdays csv, default 2,3,4" },
];

export default function SettingsPage() {
  const rows = ENV_VARS.map((e) => {
    const v = process.env[e.name];
    const set = !!v;
    const tone = set ? "ok" : e.required ? "bad" : "warn";
    return [
      <code key="n">{e.name}</code>,
      <Pill key="s" tone={tone}>
        {set ? "set" : e.required ? "missing" : "unset"}
      </Pill>,
      e.required ? "yes" : "no",
      e.description,
    ];
  });

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Read-only env-check. Aanpassen doe je in .env / je host."
      />
      <Table
        columns={["Env var", "Status", "Required", "Wat"]}
        rows={rows}
      />
      <p
        style={{
          marginTop: "1.5rem",
          fontSize: "0.85rem",
          opacity: 0.7,
          maxWidth: "600px",
          lineHeight: 1.6,
        }}
      >
        Tip: stel <code>DAILY_SEND_LIMIT</code> in week 1 op <code>20</code> en
        bouw langzaam op. Houd <code>SEND_WINDOW_*</code> binnen kantooruren
        voor de hoogste reply rate.
      </p>
    </>
  );
}
