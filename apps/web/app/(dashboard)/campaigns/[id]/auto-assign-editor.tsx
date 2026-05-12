"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { updateAutoAssignRules } from "../actions";
import type { CampaignActionResult } from "../types";

const ALL_QUALITIES = [
  { value: "good", label: "good (moderne site)" },
  { value: "decent", label: "decent" },
  { value: "outdated", label: "outdated (verouderd)" },
  { value: "none", label: "none (geen site)" },
] as const;

export function AutoAssignEditor({
  campaignId,
  enabled,
  niches,
  cities,
  websiteQualities,
  priority,
  preview,
}: {
  campaignId: string;
  enabled: boolean;
  niches: string[];
  cities: string[];
  websiteQualities: string[];
  priority: number;
  preview: { matching: number; alreadyAssigned: number };
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CampaignActionResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateAutoAssignRules(campaignId, fd);
      setResult(r);
    });
  }

  return (
    <section style={sectionStyle}>
      <header style={headerStyle}>
        <div>
          <h2 style={h2Style}>Auto-assign regels</h2>
          <p style={descStyle}>
            Wanneer aan, krijgen nieuwe leads die alle gezette filters matchen
            (niche + locatie + website-kwaliteit) deze campagne toegewezen. Bij
            meerdere matches wint de campagne met hoogste prioriteit, daarna
            de specificere (meer niet-lege filters).
          </p>
        </div>
        <div style={previewBoxStyle}>
          <div style={previewLabelStyle}>Zou nu matchen</div>
          <div style={previewValueStyle}>{preview.matching}</div>
          {preview.alreadyAssigned > 0 ? (
            <div style={previewSubStyle}>
              {preview.alreadyAssigned} al toegewezen
            </div>
          ) : null}
        </div>
      </header>

      <form onSubmit={onSubmit}>
        <div style={gridStyle}>
          <div style={fieldStyle}>
            <label style={labelStyle}>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={enabled}
                style={{ marginRight: "0.5rem" }}
              />
              Auto-assign aan voor deze campagne
            </label>
            <p style={hintStyle}>
              Zet pas aan als de filters hieronder kloppen. Niets ingevuld
              = catch-all, alle nieuwe leads gaan deze kant op.
            </p>
          </div>

          <div style={fieldStyle}>
            <label style={labelTextStyle}>Niches (csv)</label>
            <input
              type="text"
              name="niches"
              defaultValue={niches.join(", ")}
              placeholder="kapper, kapsalon, hair"
              style={inputStyle}
            />
            <p style={hintStyle}>
              Case-insensitive substring tegen Google Places-categorie.
              Places levert vaak Engels (&ldquo;Hair salon&rdquo;) — voeg
              dus zowel NL als EN keywords toe.
            </p>
          </div>

          <div style={fieldStyle}>
            <label style={labelTextStyle}>Steden (csv)</label>
            <input
              type="text"
              name="cities"
              defaultValue={cities.join(", ")}
              placeholder="Utrecht, Amsterdam"
              style={inputStyle}
            />
            <p style={hintStyle}>
              Case-insensitive exact match op business.city. Leeg = alle steden.
            </p>
          </div>

          <div style={fieldStyle}>
            <label style={labelTextStyle}>Website-kwaliteit</label>
            <div style={checkboxRowStyle}>
              {ALL_QUALITIES.map((q) => (
                <label key={q.value} style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    name="websiteQualities"
                    value={q.value}
                    defaultChecked={websiteQualities.includes(q.value)}
                  />
                  {q.label}
                </label>
              ))}
            </div>
            <p style={hintStyle}>
              Selecteer de buckets die deze campagne accepteert. Leeg = alle.
              &ldquo;none&rdquo; = leads zonder website.
            </p>
          </div>

          <div style={fieldStyle}>
            <label style={labelTextStyle}>Prioriteit</label>
            <input
              type="number"
              name="priority"
              defaultValue={priority}
              min={0}
              max={100}
              style={{ ...inputStyle, maxWidth: "120px" }}
            />
            <p style={hintStyle}>
              Hoger wint bij gelijke specificiteit. Default 0.
            </p>
          </div>
        </div>

        <div style={footerStyle}>
          <button type="submit" disabled={pending} style={btnStyle}>
            {pending ? "Opslaan…" : "Auto-assign regels opslaan"}
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

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1.5rem",
  marginBottom: "1rem",
};

const h2Style: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
};

const descStyle: CSSProperties = {
  margin: "0.4rem 0 0",
  fontSize: "0.85rem",
  opacity: 0.7,
  lineHeight: 1.5,
};

const previewBoxStyle: CSSProperties = {
  background: "#0a0c11",
  border: "1px solid #20252e",
  borderRadius: "6px",
  padding: "0.6rem 0.85rem",
  textAlign: "right",
  minWidth: "120px",
};

const previewLabelStyle: CSSProperties = {
  fontSize: "0.7rem",
  opacity: 0.55,
};

const previewValueStyle: CSSProperties = {
  fontSize: "1.4rem",
  fontWeight: 600,
};

const previewSubStyle: CSSProperties = {
  fontSize: "0.7rem",
  opacity: 0.55,
  marginTop: "0.15rem",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "1rem",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
};

const labelStyle: CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 500,
};

const labelTextStyle: CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 500,
};

const inputStyle: CSSProperties = {
  padding: "0.5rem 0.65rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.9rem",
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};

const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  fontSize: "0.85rem",
};

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  opacity: 0.55,
  lineHeight: 1.4,
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  marginTop: "1.25rem",
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

const resultStyle: CSSProperties = {
  fontSize: "0.85rem",
};
