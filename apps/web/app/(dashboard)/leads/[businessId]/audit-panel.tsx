"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { rerunAuditForBusiness } from "../actions";
import type { AiAuditActionResult } from "../types";

export interface AuditSignalView {
  key: string;
  weight: number;
  label: string;
}

export interface PsiAuditView {
  ok: boolean;
  fetchedAt: string;
  performanceMobile: number | null;
  accessibilityMobile: number | null;
  bestPracticesMobile: number | null;
  seoMobile: number | null;
  error?: string;
}

export interface AiAuditView {
  ok: boolean;
  fetchedAt: string;
  score: number | null;
  summary: string | null;
  strengths: string[];
  weaknesses: string[];
  model: string;
  error?: string;
}

export interface AuditDetailView {
  bucket?: string;
  htmlScore?: number;
  signals?: AuditSignalView[];
  reachable?: boolean;
  finalUrl?: string | null;
  psi?: PsiAuditView;
  ai?: AiAuditView;
}

export function AuditPanel({
  businessId,
  websiteUrl,
  auditDetail,
  auditedAt,
}: {
  businessId: string;
  websiteUrl: string | null;
  auditDetail: AuditDetailView | null;
  auditedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AiAuditActionResult | null>(null);

  function rerun(useAi: boolean) {
    startTransition(async () => {
      const r = await rerunAuditForBusiness(businessId, { useAi });
      setResult(r);
    });
  }

  if (!websiteUrl) {
    return (
      <section style={sectionStyle}>
        <h2 style={h2Style}>Website-audit</h2>
        <p style={{ ...mutedStyle, margin: 0 }}>
          Geen website — niets om te scoren.
        </p>
      </section>
    );
  }

  return (
    <section style={sectionStyle}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <h2 style={{ ...h2Style, margin: 0 }}>Website-audit</h2>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => rerun(false)}
            disabled={pending}
            style={ghostBtnStyle}
            title="HTML + PSI opnieuw scoren (geen AI-kosten)"
          >
            {pending ? "Bezig…" : "Re-scan (HTML + PSI)"}
          </button>
          <button
            type="button"
            onClick={() => rerun(true)}
            disabled={pending}
            style={primaryBtnStyle}
            title="HTML + PSI + Claude design-audit (~$0.005)"
          >
            {pending ? "Bezig…" : "AI design-audit"}
          </button>
        </div>
      </header>

      {result ? (
        <div style={{ marginBottom: "0.75rem" }}>
          <span
            style={{
              ...pillStyle,
              ...(result.ok ? toneOk : toneBad),
            }}
          >
            {result.message}
          </span>
        </div>
      ) : null}

      {!auditDetail ? (
        <p style={{ ...mutedStyle, margin: 0 }}>
          Nog geen audit-detail — klik op een van de scan-knoppen om te
          starten. De HTML + PSI scan duurt ~10s, AI-audit ongeveer
          20s.
        </p>
      ) : (
        <>
          <div style={summaryGridStyle}>
            <Stat
              label="HTML-score"
              value={
                auditDetail.htmlScore != null
                  ? `${auditDetail.htmlScore}/100`
                  : "—"
              }
              tone={scoreTone(auditDetail.htmlScore ?? null, 50, 80)}
            />
            <Stat
              label="PSI mobile (perf)"
              value={
                auditDetail.psi?.performanceMobile != null
                  ? `${auditDetail.psi.performanceMobile}/100`
                  : auditDetail.psi?.error
                    ? "fout"
                    : "—"
              }
              tone={scoreTone(
                auditDetail.psi?.performanceMobile ?? null,
                40,
                80,
              )}
            />
            <Stat
              label="AI design"
              value={
                auditDetail.ai?.score != null
                  ? `${auditDetail.ai.score}/10`
                  : auditDetail.ai?.error
                    ? "fout"
                    : "—"
              }
              tone={scoreTone(
                auditDetail.ai?.score != null ? auditDetail.ai.score * 10 : null,
                40,
                70,
              )}
            />
            <Stat
              label="Bucket"
              value={auditDetail.bucket ?? "—"}
              tone={
                auditDetail.bucket === "good"
                  ? "ok"
                  : auditDetail.bucket === "decent"
                    ? "warn"
                    : auditDetail.bucket === "outdated"
                      ? "bad"
                      : "neutral"
              }
            />
          </div>

          {auditDetail.ai?.summary ? (
            <div style={aiBoxStyle}>
              <div style={aiHeaderStyle}>
                <strong>AI-oordeel</strong>
                {auditDetail.ai.score != null ? (
                  <span style={{ ...pillStyle, ...scoreToneStyle(auditDetail.ai.score * 10) }}>
                    {auditDetail.ai.score}/10
                  </span>
                ) : null}
                {auditDetail.ai.model ? (
                  <code style={modelCodeStyle}>{auditDetail.ai.model}</code>
                ) : null}
              </div>
              <p style={{ margin: "0.4rem 0 0.6rem", fontStyle: "italic" }}>
                &ldquo;{auditDetail.ai.summary}&rdquo;
              </p>
              {auditDetail.ai.strengths.length > 0 ? (
                <p style={{ margin: "0.2rem 0", fontSize: "0.85rem" }}>
                  <strong style={{ color: "#7be0a6" }}>+</strong>{" "}
                  {auditDetail.ai.strengths.join(", ")}
                </p>
              ) : null}
              {auditDetail.ai.weaknesses.length > 0 ? (
                <p style={{ margin: "0.2rem 0", fontSize: "0.85rem" }}>
                  <strong style={{ color: "#ff8888" }}>−</strong>{" "}
                  {auditDetail.ai.weaknesses.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {auditDetail.signals && auditDetail.signals.length > 0 ? (
            <div style={{ marginTop: "0.75rem" }}>
              <strong style={{ fontSize: "0.85rem" }}>HTML-signalen</strong>
              <ul style={signalListStyle}>
                {auditDetail.signals.map((s) => (
                  <li key={s.key} style={signalItemStyle}>
                    <span
                      style={{
                        ...pillStyle,
                        ...(s.weight > 0 ? toneOk : toneBad),
                        marginRight: "0.5rem",
                      }}
                    >
                      {s.weight > 0 ? `+${s.weight}` : s.weight}
                    </span>
                    <span style={{ opacity: 0.85, fontSize: "0.85rem" }}>
                      {s.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {auditedAt ? (
            <p style={{ ...mutedStyle, marginTop: "0.6rem", fontSize: "0.75rem" }}>
              Laatste audit: {new Date(auditedAt).toLocaleString("nl-NL")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  const colors: Record<string, CSSProperties> = {
    ok: { color: "#7be0a6", borderColor: "#143524" },
    warn: { color: "#ffcc66", borderColor: "#3a2e10" },
    bad: { color: "#ff8888", borderColor: "#3a1414" },
    neutral: { color: "#c9cdd6", borderColor: "#20252e" },
  };
  return (
    <div style={{ ...statBoxStyle, ...colors[tone] }}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value}</div>
    </div>
  );
}

function scoreTone(
  value: number | null,
  badBelow: number,
  goodAbove: number,
): "ok" | "warn" | "bad" | "neutral" {
  if (value == null) return "neutral";
  if (value >= goodAbove) return "ok";
  if (value < badBelow) return "bad";
  return "warn";
}

function scoreToneStyle(value: number): CSSProperties {
  const t = scoreTone(value, 40, 70);
  if (t === "ok") return toneOk;
  if (t === "warn") return toneWarn;
  if (t === "bad") return toneBad;
  return toneNeutral;
}

const sectionStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "#0f1218",
};

const h2Style: CSSProperties = {
  fontSize: "1.05rem",
  margin: 0,
};

const mutedStyle: CSSProperties = {
  opacity: 0.65,
  fontSize: "0.85rem",
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "0.5rem",
  marginBottom: "0.75rem",
};

const statBoxStyle: CSSProperties = {
  border: "1px solid",
  borderRadius: "6px",
  padding: "0.5rem 0.75rem",
  background: "#0a0c11",
};

const statLabelStyle: CSSProperties = {
  fontSize: "0.7rem",
  opacity: 0.65,
  marginBottom: "0.2rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const statValueStyle: CSSProperties = {
  fontSize: "1.05rem",
  fontWeight: 600,
};

const aiBoxStyle: CSSProperties = {
  border: "1px solid #2a3140",
  borderRadius: "6px",
  padding: "0.7rem 0.9rem",
  background: "#0a0c11",
  marginTop: "0.5rem",
};

const aiHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const modelCodeStyle: CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.7rem",
  opacity: 0.55,
};

const signalListStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0.4rem 0 0",
};

const signalItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  marginBottom: "0.25rem",
};

const pillStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.15rem 0.55rem",
  borderRadius: "999px",
  fontSize: "0.72rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const toneOk: CSSProperties = { background: "#143524", color: "#7be0a6" };
const toneWarn: CSSProperties = { background: "#3a2e10", color: "#ffcc66" };
const toneBad: CSSProperties = { background: "#3a1414", color: "#ff8888" };
const toneNeutral: CSSProperties = { background: "#1c2129", color: "#c9cdd6" };

const primaryBtnStyle: CSSProperties = {
  padding: "0.4rem 0.85rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.8rem",
  cursor: "pointer",
};

const ghostBtnStyle: CSSProperties = {
  padding: "0.4rem 0.85rem",
  background: "transparent",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#c9cdd6",
  fontSize: "0.8rem",
  cursor: "pointer",
};
