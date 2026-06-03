import type { PhoneDayStats } from "./page";

/**
 * Vandaag-strook bovenaan /phone. Drijft activiteit zonder een
 * dashboard te maken. Berekening server-side in page.tsx, hier
 * alleen de presentatie.
 */
export function DayStats({ stats }: { stats: PhoneDayStats }) {
  const items: { label: string; value: number; tone: string }[] = [
    { label: "gebeld vandaag", value: stats.calls, tone: "#7ab8ff" },
    { label: "voicemail", value: stats.voicemails, tone: "#ffcc66" },
    { label: "interesse", value: stats.interested, tone: "#7be0a6" },
    { label: "afgewezen", value: stats.notInterested, tone: "#ff8888" },
    { label: "mails ingepland", value: stats.mailsScheduled, tone: "#c79bff" },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: "0.6rem",
        flexWrap: "wrap",
        marginBottom: "0.9rem",
      }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            background: "#0f1218",
            border: "1px solid #20252e",
            borderRadius: "6px",
            padding: "0.45rem 0.75rem",
            minWidth: "110px",
            display: "flex",
            flexDirection: "column",
            gap: "0.1rem",
          }}
        >
          <span
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              color: it.tone,
              fontFamily: "monospace",
            }}
          >
            {it.value}
          </span>
          <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
