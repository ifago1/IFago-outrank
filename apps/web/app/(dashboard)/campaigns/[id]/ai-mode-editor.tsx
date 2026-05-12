"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { updateAiMode } from "../actions";
import type { CampaignActionResult } from "../types";

export function AiModeEditor({
  campaignId,
  aiEnabled,
  globalAiEnabled,
  hasAnthropicKey,
}: {
  campaignId: string;
  aiEnabled: boolean;
  /** Toont een waarschuwing als de campagne AI aan zet maar het platform AI uit. */
  globalAiEnabled: boolean;
  hasAnthropicKey: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CampaignActionResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateAiMode(campaignId, fd);
      setResult(r);
    });
  }

  const showWarning = aiEnabled && (!globalAiEnabled || !hasAnthropicKey);

  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>E-mailgeneratie</h2>
      <p style={descStyle}>
        Standaard gebruikt de campagne de sequence-templates onderaan. Zet aan
        om Claude per send een unieke subject + body te laten schrijven o.b.v.
        de business, de Google-reviews en de website-content (samengevat uit de
        AI-audit: summary + zwakke punten). Bij elke AI-failure valt de send
        terug op de template — geen risico op vastlopen.
      </p>

      <form onSubmit={onSubmit}>
        <label style={labelStyle}>
          <input
            type="checkbox"
            name="aiEnabled"
            defaultChecked={aiEnabled}
            style={{ marginRight: "0.5rem" }}
          />
          AI schrijft elke mail apart (i.p.v. de sequence-templates)
        </label>

        {showWarning ? (
          <p style={warnStyle}>
            ⚠ Globale AI staat uit (
            {!hasAnthropicKey ? "ANTHROPIC_API_KEY niet gezet" : "AI_GENERATE_EMAILS uit"}
            ). Zet ook aan in <a href="/settings" style={linkStyle}>Settings</a> —
            anders blijft deze campagne de template gebruiken.
          </p>
        ) : null}

        <div style={footerStyle}>
          <button type="submit" disabled={pending} style={btnStyle}>
            {pending ? "Opslaan…" : "Opslaan"}
          </button>
          {result ? (
            <span
              style={{
                ...resultStyle,
                color: result.ok ? "#7be0a6" : "#ff8888",
              }}
            >
              {result.message}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const sectionStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1.25rem 1.5rem",
  background: "#0f1218",
  marginBottom: "1.5rem",
};

const h2Style: CSSProperties = { margin: "0 0 0.4rem", fontSize: "1.05rem" };

const descStyle: CSSProperties = {
  margin: "0 0 1rem",
  fontSize: "0.85rem",
  opacity: 0.7,
  lineHeight: 1.5,
};

const labelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  fontSize: "0.9rem",
  fontWeight: 500,
};

const warnStyle: CSSProperties = {
  marginTop: "0.75rem",
  fontSize: "0.8rem",
  color: "#ffcc66",
  background: "#3a2e10",
  border: "1px solid #5e4a18",
  borderRadius: "6px",
  padding: "0.5rem 0.75rem",
};

const linkStyle: CSSProperties = {
  color: "#7aa7ff",
  textDecoration: "underline",
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  marginTop: "1rem",
};

const btnStyle: CSSProperties = {
  padding: "0.55rem 1.1rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.9rem",
  fontWeight: 500,
  cursor: "pointer",
};

const resultStyle: CSSProperties = { fontSize: "0.85rem" };
