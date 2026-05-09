"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { updateAutoAssign } from "../actions";
import type { CampaignActionResult } from "../types";

export interface AutoAssignView {
  enabled: boolean;
  niche: string | null;
  city: string | null;
  websiteQuality: string | null;
  minScore: number | null;
  maxScore: number | null;
  maxLeads: number | null;
  aiPersonalizeFullBody: boolean;
}

export function AutoAssignForm({
  campaignId,
  initial,
}: {
  campaignId: string;
  initial: AutoAssignView;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CampaignActionResult | null>(null);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [niche, setNiche] = useState(initial.niche ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [websiteQuality, setWebsiteQuality] = useState(
    initial.websiteQuality ?? "",
  );
  const [minScore, setMinScore] = useState(
    initial.minScore != null ? String(initial.minScore) : "",
  );
  const [maxScore, setMaxScore] = useState(
    initial.maxScore != null ? String(initial.maxScore) : "",
  );
  const [maxLeads, setMaxLeads] = useState(
    initial.maxLeads != null ? String(initial.maxLeads) : "",
  );
  const [aiPersonalizeFullBody, setAiPersonalizeFullBody] = useState(
    initial.aiPersonalizeFullBody,
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateAutoAssign(campaignId, form);
      setResult(r);
    });
  };

  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Auto-assign rules</h2>
      <p style={descStyle}>
        Wanneer aangezet plaatst de enrichment-pipeline elke nieuwe contact
        automatisch in deze campagne als de business matcht. Lege velden
        gelden als wildcard. <strong>Status moet "active" zijn</strong> —
        gepauzeerde campagnes verzamelen geen auto-leads.
      </p>

      <form onSubmit={onSubmit} style={formStyle}>
        <label style={toggleLabelStyle}>
          <input
            type="checkbox"
            name="autoAssignEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Auto-assign aan</span>
        </label>

        <div style={gridStyle}>
          <Field label="Niche (category match)" hint="Bijv. 'kapper'. Leeg = elke niche.">
            <input
              type="text"
              name="autoAssignNiche"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="kapper"
              disabled={!enabled}
              style={inputStyle}
            />
          </Field>

          <Field label="Stad" hint="Match op businesses.city. Leeg = elke stad.">
            <input
              type="text"
              name="autoAssignCity"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Maastricht"
              disabled={!enabled}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Website-quality bucket"
            hint="Filter op de audit-score. Leeg = alle scores."
          >
            <select
              name="autoAssignWebsiteQuality"
              value={websiteQuality}
              onChange={(e) => setWebsiteQuality(e.target.value)}
              disabled={!enabled}
              style={inputStyle}
            >
              <option value="">— alle —</option>
              <option value="none">Geen website</option>
              <option value="outdated">Outdated</option>
              <option value="decent">Decent</option>
              <option value="good">Good</option>
            </select>
          </Field>

          <Field
            label="Max leads (cap)"
            hint="Stop met auto-toevoegen na N leads. Leeg = ongelimiteerd."
          >
            <input
              type="number"
              name="autoAssignMaxLeads"
              value={maxLeads}
              onChange={(e) => setMaxLeads(e.target.value)}
              placeholder="100"
              min="0"
              disabled={!enabled}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Min score (0-100)"
            hint="Filter op website-score uit audit_detail.htmlScore. Bijv. 0 = ondergrens 'outdated'. Leeg = geen ondergrens."
          >
            <input
              type="number"
              name="autoAssignMinScore"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="0"
              min="0"
              max="100"
              disabled={!enabled}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Max score (0-100)"
            hint="Bijv. 50 = alleen sites met outdated/decent score. Leeg = geen bovengrens."
          >
            <input
              type="number"
              name="autoAssignMaxScore"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              placeholder="50"
              min="0"
              max="100"
              disabled={!enabled}
              style={inputStyle}
            />
          </Field>
        </div>

        <div
          style={{
            marginTop: "0.5rem",
            paddingTop: "1rem",
            borderTop: "1px solid #20252e",
          }}
        >
          <label style={toggleLabelStyle}>
            <input
              type="checkbox"
              name="aiPersonalizeFullBody"
              checked={aiPersonalizeFullBody}
              onChange={(e) => setAiPersonalizeFullBody(e.target.checked)}
            />
            <span>AI-gegenereerde mail per lead</span>
          </label>
          <p
            style={{
              ...hintStyle,
              marginTop: "0.5rem",
              maxWidth: "44rem",
            }}
          >
            Wanneer aan, wordt elke verstuurde mail in deze campagne live
            geschreven door Claude — uniek per lead, met de step-templates
            als toon-referentie. Werkt het beste als je de templates kort
            houdt (toon, niet inhoud). Vereist <code>ANTHROPIC_API_KEY</code>{" "}
            in Settings. Bij AI-fout valt 'ie automatisch terug op de
            template-render — sends gaan dus altijd door.
          </p>
        </div>

        <div style={actionsStyle}>
          <button type="submit" disabled={pending} style={buttonStyle}>
            {pending ? "Opslaan..." : "Opslaan"}
          </button>
          {result ? (
            <span
              style={{
                ...statusStyle,
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint ? <span style={hintStyle}>{hint}</span> : null}
    </label>
  );
}

const sectionStyle: CSSProperties = {
  marginBottom: "2rem",
  padding: "1.25rem 1.5rem",
  border: "1px solid #20252e",
  borderRadius: "8px",
  background: "#0f1218",
};

const h2Style: CSSProperties = {
  margin: "0 0 0.25rem",
  fontSize: "1.1rem",
};

const descStyle: CSSProperties = {
  margin: "0 0 1rem",
  opacity: 0.7,
  fontSize: "0.9rem",
};

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const toggleLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  fontWeight: 500,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "1rem",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
};

const labelStyle: CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 500,
  opacity: 0.85,
};

const hintStyle: CSSProperties = {
  fontSize: "0.75rem",
  opacity: 0.55,
};

const inputStyle: CSSProperties = {
  background: "#1c2129",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  padding: "0.5rem 0.65rem",
  color: "#e6e8ee",
  fontSize: "0.9rem",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
};

const buttonStyle: CSSProperties = {
  background: "#7be0a6",
  color: "#0f1218",
  border: 0,
  borderRadius: "6px",
  padding: "0.55rem 1.1rem",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "0.9rem",
};

const statusStyle: CSSProperties = {
  fontSize: "0.85rem",
};
