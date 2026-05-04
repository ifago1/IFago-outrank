"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { updateSequenceStep } from "../actions";
import type { CampaignActionResult } from "../types";

export interface StepView {
  id: string;
  stepOrder: number;
  delayDays: number;
  subjectTemplate: string;
  bodyTemplate: string;
}

const PREVIEW_VARS: Record<string, string> = {
  first_name: "Piet",
  business_name: "Kapsalon de Knipster",
  personal_observation:
    "opvallend hoe vaak Petra terugkomt in de reviews — dat soort persoonlijk gezicht is precies wat een site moet doorvertalen",
  sender_name: "Jan van de Webdesign Agency",
  unsubscribe_url: "https://outreach.example.com/api/unsubscribe?t=preview",
};

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Client-safe template renderer — mirrors @outreach/templates render() but
 *  without any Node deps, so we can import this in a "use client" file. */
function renderPreview(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    return vars[key] ?? match;
  });
}

function listVars(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

export function SequenceEditor({
  campaignId,
  steps,
}: {
  campaignId: string;
  steps: StepView[];
}) {
  return (
    <div>
      <h2 style={h2Style}>Sequence ({steps.length} steps)</h2>
      <p style={descStyle}>
        Bewerk subject + body per step. Variabelen tussen{" "}
        <code>{"{{...}}"}</code> worden bij verzenden vervangen door de
        echte waarden van de lead. De preview rechts toont hoe de mail er
        ongeveer uitziet voor een voorbeeld-lead.
      </p>
      {steps.map((step) => (
        <StepRow key={step.id} campaignId={campaignId} step={step} />
      ))}
    </div>
  );
}

function StepRow({
  campaignId,
  step,
}: {
  campaignId: string;
  step: StepView;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CampaignActionResult | null>(null);

  const [subject, setSubject] = useState(step.subjectTemplate);
  const [body, setBody] = useState(step.bodyTemplate);
  const [delay, setDelay] = useState(String(step.delayDays));

  const variables = useMemo(
    () => [...new Set([...listVars(subject), ...listVars(body)])],
    [subject, body],
  );

  const subjectPreview = useMemo(
    () => renderPreview(subject, PREVIEW_VARS),
    [subject],
  );
  const bodyPreview = useMemo(
    () => renderPreview(body, PREVIEW_VARS),
    [body],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateSequenceStep(campaignId, step.stepOrder, data);
      setResult(r);
    });
  }

  return (
    <form onSubmit={onSubmit} style={cardStyle}>
      <header style={headerRowStyle}>
        <strong>Step {step.stepOrder}</strong>
        <label style={inlineLabelStyle}>
          <span>Delay (dagen na vorige step)</span>
          <input
            name="delayDays"
            type="number"
            min="0"
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
            style={smallInputStyle}
          />
        </label>
      </header>

      <div style={twoColStyle}>
        <div>
          <label style={labelStyle}>
            <span style={labelTextStyle}>Subject</span>
            <input
              name="subjectTemplate"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={inputStyle}
              required
            />
          </label>
          <label style={{ ...labelStyle, marginTop: "0.75rem" }}>
            <span style={labelTextStyle}>Body</span>
            <textarea
              name="bodyTemplate"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ ...inputStyle, minHeight: "200px", fontFamily: "inherit" }}
              required
            />
          </label>
          {variables.length > 0 ? (
            <p style={varsStyle}>
              Variabelen in deze step:{" "}
              {variables.map((v) => (
                <code key={v} style={varCodeStyle}>{`{{${v}}}`}</code>
              ))}
            </p>
          ) : null}
        </div>

        <div>
          <span style={labelTextStyle}>Preview</span>
          <div style={previewBoxStyle}>
            <div style={previewSubjectStyle}>{subjectPreview}</div>
            <pre style={previewBodyStyle}>{bodyPreview}</pre>
          </div>
          <p style={{ ...hintStyle, marginTop: "0.4rem" }}>
            Voorbeeld-lead: Piet bij Kapsalon de Knipster. De
            personal_observation is een typisch voorbeeld; bij echte sends
            wordt deze door Claude gegenereerd of door de fallback
            heuristiek.
          </p>
        </div>
      </div>

      <div style={footerStyle}>
        <button type="submit" disabled={pending} style={primaryBtnStyle}>
          {pending ? "Opslaan…" : `Step ${step.stepOrder} opslaan`}
        </button>
        {result ? (
          <span
            style={{
              ...resultPillStyle,
              background: result.ok ? "#143524" : "#3a1414",
              color: result.ok ? "#7be0a6" : "#ff8888",
            }}
          >
            {result.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "#0f1218",
};
const h2Style: CSSProperties = { fontSize: "1.05rem", margin: "1.5rem 0 0.4rem" };
const descStyle: CSSProperties = {
  margin: "0 0 1rem 0",
  fontSize: "0.85rem",
  opacity: 0.7,
  lineHeight: 1.5,
};
const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "0.75rem",
};
const inlineLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.85rem",
  opacity: 0.85,
};
const twoColStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "1rem",
};
const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
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
  width: "100%",
  boxSizing: "border-box",
};
const smallInputStyle: CSSProperties = {
  ...inputStyle,
  width: "70px",
};
const previewBoxStyle: CSSProperties = {
  border: "1px solid #2a3140",
  borderRadius: "6px",
  padding: "0.75rem",
  background: "#0a0c11",
  marginTop: "0.3rem",
};
const previewSubjectStyle: CSSProperties = {
  fontWeight: 600,
  marginBottom: "0.6rem",
  paddingBottom: "0.5rem",
  borderBottom: "1px solid #20252e",
  fontSize: "0.9rem",
};
const previewBodyStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  margin: 0,
  fontSize: "0.85rem",
  color: "#c9cdd6",
  fontFamily: "inherit",
};
const varsStyle: CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.75rem",
  opacity: 0.7,
};
const varCodeStyle: CSSProperties = {
  marginRight: "0.4rem",
  background: "#1c2129",
  padding: "0.1rem 0.4rem",
  borderRadius: "4px",
  fontSize: "0.75rem",
};
const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  marginTop: "0.75rem",
};
const primaryBtnStyle: CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.9rem",
  cursor: "pointer",
};
const resultPillStyle: CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
};
const hintStyle: CSSProperties = {
  fontSize: "0.75rem",
  opacity: 0.55,
  lineHeight: 1.4,
};
