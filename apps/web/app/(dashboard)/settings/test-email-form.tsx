"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { sendTestEmail } from "./actions";
import type { SendTestEmailResult } from "./types";

export function TestEmailForm({ defaultTo }: { defaultTo?: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SendTestEmailResult | null>(null);
  const [to, setTo] = useState(defaultTo ?? "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await sendTestEmail(data);
      setResult(r);
    });
  }

  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Test mail verzenden</h2>
      <p style={descStyle}>
        Stuur een test-mail met de huidige Mailer + Afzender instellingen.
        Sla eerst je wijzigingen op — de test leest dezelfde DB-settings als
        de worker straks zal gebruiken.
      </p>
      <form onSubmit={onSubmit} style={rowStyle}>
        <input
          name="to"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="ontvanger@voorbeeld.nl"
          required
          style={inputStyle}
        />
        <button type="submit" disabled={pending} style={btnStyle}>
          {pending ? "Verzenden…" : "Stuur test-mail"}
        </button>
      </form>
      {result ? (
        <div style={{ marginTop: "0.75rem" }}>
          <span
            style={{
              ...pillStyle,
              ...(result.ok ? toneOk : toneBad),
            }}
          >
            {result.message}
          </span>
          {result.messageId ? (
            <code style={messageIdStyle}>messageId: {result.messageId}</code>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const sectionStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "#0f1218",
};

const h2Style: CSSProperties = {
  fontSize: "1.1rem",
  margin: "0 0 0.4rem 0",
};

const descStyle: CSSProperties = {
  margin: "0 0 0.75rem 0",
  fontSize: "0.85rem",
  opacity: 0.7,
  lineHeight: 1.5,
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const inputStyle: CSSProperties = {
  flex: "1 1 280px",
  padding: "0.5rem 0.65rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.9rem",
  fontFamily: "inherit",
};

const btnStyle: CSSProperties = {
  padding: "0.5rem 1.1rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.9rem",
  fontWeight: 500,
  cursor: "pointer",
};

const pillStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.4rem 0.85rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
  marginRight: "0.5rem",
};

const toneOk: CSSProperties = { background: "#143524", color: "#7be0a6" };
const toneBad: CSSProperties = { background: "#3a1414", color: "#ff8888" };

const messageIdStyle: CSSProperties = {
  display: "inline-block",
  fontSize: "0.75rem",
  opacity: 0.6,
  fontFamily: "monospace",
};
