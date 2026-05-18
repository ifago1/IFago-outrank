import type { CSSProperties } from "react";
import { Pill } from "../../_ui";

export interface TimelineEventView {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  payload: Record<string, unknown> | null;
}

export function Timeline({ events }: { events: TimelineEventView[] }) {
  if (events.length === 0) {
    return (
      <section style={sectionStyle}>
        <h2 style={h2Style}>Timeline</h2>
        <p style={{ opacity: 0.55, fontSize: "0.85rem" }}>
          Nog geen events vastgelegd. Mail-sends, replies, bounces, telefoon-
          statussen en audits verschijnen hier zodra ze gebeuren.
        </p>
      </section>
    );
  }

  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Timeline ({events.length})</h2>
      <ul style={listStyle}>
        {events.map((e) => (
          <li key={e.id} style={itemStyle}>
            <div style={dotStyle(toneFor(e))} />
            <div style={contentStyle}>
              <div style={topRowStyle}>
                <Pill tone={toneFor(e)}>{labelFor(e.type)}</Pill>
                <span style={sourceStyle}>{e.source}</span>
                <span style={dateStyle}>
                  {new Date(e.occurredAt).toLocaleString("nl-NL", {
                    timeZone: "Europe/Amsterdam",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              {renderPayload(e)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function labelFor(type: string): string {
  switch (type) {
    case "mail_sent":
      return "mail verstuurd";
    case "mail_opened":
      return "mail geopend";
    case "mail_replied":
      return "reply ontvangen";
    case "mail_bounced":
      return "bounce";
    case "phone_status":
      return "telefoon";
    case "unsubscribed":
      return "afgemeld";
    case "audit_completed":
      return "audit";
    case "auto_assigned":
      return "auto-toegewezen";
    default:
      return type;
  }
}

function toneFor(e: TimelineEventView): "ok" | "warn" | "bad" | "neutral" {
  if (e.type === "mail_replied") return "ok";
  if (e.type === "mail_bounced" || e.type === "unsubscribed") return "bad";
  if (e.type === "mail_opened") return "warn";
  if (e.type === "phone_status") {
    const status = e.payload?.["status"];
    if (status === "interested") return "ok";
    if (status === "not_interested" || status === "wrong_number") return "bad";
    return "warn";
  }
  return "neutral";
}

function renderPayload(e: TimelineEventView) {
  const p = e.payload;
  if (!p) return null;

  if (e.type === "mail_sent") {
    return (
      <div style={detailStyle}>
        Step #{String(p["stepOrder"] ?? "?")} —{" "}
        <span style={{ fontStyle: "italic" }}>
          &ldquo;{String(p["subject"] ?? "")}&rdquo;
        </span>
        {p["aiGenerated"] ? (
          <span style={{ marginLeft: "0.5rem", opacity: 0.55 }}>· AI-geschreven</span>
        ) : null}
      </div>
    );
  }
  if (e.type === "mail_replied") {
    const subject = p["subject"];
    if (typeof subject === "string" && subject) {
      return (
        <div style={detailStyle}>
          Subject: <span style={{ fontStyle: "italic" }}>{subject}</span>
        </div>
      );
    }
  }
  if (e.type === "mail_bounced") {
    const type = p["bounceType"];
    if (typeof type === "string" && type) {
      return <div style={detailStyle}>Type: {type}</div>;
    }
  }
  if (e.type === "phone_status") {
    const status = p["status"];
    const notes = p["notes"];
    const next = p["nextAttemptAt"];
    return (
      <div style={detailStyle}>
        {status ? <>Status: <strong>{String(status)}</strong></> : "Status gewist"}
        {notes ? <div style={{ marginTop: "0.2rem", fontStyle: "italic" }}>&ldquo;{String(notes)}&rdquo;</div> : null}
        {next ? (
          <div style={{ marginTop: "0.2rem", opacity: 0.65 }}>
            Volgende poging: {new Date(String(next)).toLocaleString("nl-NL", {
              timeZone: "Europe/Amsterdam",
              dateStyle: "short",
              timeStyle: "short",
            })}
          </div>
        ) : null}
      </div>
    );
  }
  if (e.type === "audit_completed") {
    return (
      <div style={detailStyle}>
        Bucket: {String(p["bucket"] ?? "?")}{" "}
        {p["htmlScore"] != null ? `· HTML-score ${String(p["htmlScore"])}` : ""}
        {p["aiScore"] != null ? ` · AI-score ${String(p["aiScore"])}` : ""}
      </div>
    );
  }
  if (e.type === "auto_assigned") {
    return (
      <div style={detailStyle}>
        Reden: {String(p["reason"] ?? "—")}
      </div>
    );
  }
  if (e.type === "unsubscribed") {
    return (
      <div style={detailStyle}>
        {String(p["email"] ?? "")} heeft zich afgemeld
      </div>
    );
  }
  return null;
}

const sectionStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "#0f1218",
};

const h2Style: CSSProperties = { fontSize: "1.05rem", margin: "0 0 0.75rem 0" };

const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  position: "relative",
};

const itemStyle: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  paddingBottom: "0.85rem",
  marginBottom: "0.85rem",
  borderBottom: "1px solid #20252e",
};

const dotStyle = (tone: "ok" | "warn" | "bad" | "neutral"): CSSProperties => ({
  width: "10px",
  height: "10px",
  borderRadius: "50%",
  marginTop: "0.35rem",
  flexShrink: 0,
  background:
    tone === "ok"
      ? "#7be0a6"
      : tone === "warn"
        ? "#ffcc66"
        : tone === "bad"
          ? "#ff8888"
          : "#c9cdd6",
});

const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const topRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  fontSize: "0.85rem",
};

const sourceStyle: CSSProperties = {
  fontSize: "0.7rem",
  opacity: 0.55,
  background: "#1c2129",
  padding: "0.05rem 0.4rem",
  borderRadius: "4px",
};

const dateStyle: CSSProperties = {
  fontSize: "0.75rem",
  opacity: 0.55,
  marginLeft: "auto",
};

const detailStyle: CSSProperties = {
  marginTop: "0.25rem",
  fontSize: "0.85rem",
  opacity: 0.85,
  lineHeight: 1.4,
};
