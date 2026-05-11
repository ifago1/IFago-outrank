"use client";

import { useState, useTransition, type CSSProperties } from "react";
import type { SettingKey } from "@outreach/db";
import { saveSettings } from "./actions";
import { SECRET_PLACEHOLDER, type SaveSettingsResult } from "./types";

interface FieldDef {
  key: SettingKey;
  label: string;
  type: "text" | "email" | "url" | "number" | "password" | "select" | "textarea";
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
}

interface Section {
  title: string;
  description?: string;
  fields: FieldDef[];
}

export function SettingsForm({
  sections,
  initialValues,
  dbHasKey,
}: {
  sections: Section[];
  initialValues: Partial<Record<SettingKey, string>>;
  dbHasKey: SettingKey[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SaveSettingsResult | null>(null);
  const dbSet = new Set(dbHasKey);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveSettings(data);
      setResult(r);
    });
  }

  return (
    <form onSubmit={onSubmit}>
      {sections.map((section) => (
        <section key={section.title} style={sectionStyle}>
          <h2 style={h2Style}>{section.title}</h2>
          {section.description ? (
            <p style={descStyle}>{section.description}</p>
          ) : null}
          <div style={gridStyle}>
            {section.fields.map((f) => (
              <FieldRow
                key={f.key}
                field={f}
                value={initialValues[f.key] ?? ""}
                isSecretInDb={
                  f.type === "password" && dbSet.has(f.key)
                }
              />
            ))}
          </div>
        </section>
      ))}

      <div style={footerStyle}>
        <button type="submit" disabled={pending} style={btnStyle}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {result ? <ResultPill result={result} /> : null}
      </div>
    </form>
  );
}

function FieldRow({
  field,
  value,
  isSecretInDb,
}: {
  field: FieldDef;
  value: string;
  isSecretInDb: boolean;
}) {
  // Secret fields with a current DB value: show a placeholder sentinel.
  // The user can leave it alone (we skip the update) or overwrite.
  const initial = isSecretInDb ? SECRET_PLACEHOLDER : value;
  const [v, setV] = useState(initial);
  const [revealed, setRevealed] = useState(!isSecretInDb);

  const inputProps = {
    name: field.key,
    id: field.key,
    value: v,
    onChange: (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => setV(e.target.value),
    placeholder: field.placeholder,
    style: inputStyle,
  };

  return (
    <div style={fieldRowStyle}>
      <label htmlFor={field.key} style={labelStyle}>
        <span>{field.label}</span>
        <code style={keyCodeStyle}>{field.key}</code>
      </label>

      {field.type === "select" && field.options ? (
        <select {...inputProps}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          {...inputProps}
          rows={6}
          spellCheck={false}
          style={{
            ...inputStyle,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "0.85rem",
            minHeight: "8rem",
            resize: "vertical",
          }}
        />
      ) : (
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <input
            {...inputProps}
            type={
              field.type === "password" && !revealed ? "password" : "text"
            }
            inputMode={field.type === "number" ? "numeric" : undefined}
            autoComplete={field.type === "password" ? "off" : undefined}
            spellCheck={false}
          />
          {field.type === "password" ? (
            <button
              type="button"
              onClick={() => {
                if (v === SECRET_PLACEHOLDER) setV("");
                setRevealed((r) => !r);
              }}
              style={smallBtnStyle}
              title={
                v === SECRET_PLACEHOLDER
                  ? "Wis veld om te overschrijven"
                  : revealed
                    ? "Verberg"
                    : "Toon"
              }
            >
              {v === SECRET_PLACEHOLDER ? "↻" : revealed ? "👁" : "👁"}
            </button>
          ) : null}
        </div>
      )}

      {field.hint ? <p style={hintStyle}>{field.hint}</p> : null}
    </div>
  );
}

function ResultPill({ result }: { result: SaveSettingsResult }) {
  const total = result.saved.length + result.cleared.length;
  const tone = result.errors.length > 0 ? "bad" : total > 0 ? "ok" : "neutral";
  const text =
    result.errors.length > 0
      ? `Fout: ${result.errors.map((e) => `${e.key} (${e.message})`).join(", ")}`
      : total === 0
        ? "Geen wijzigingen."
        : `Bewaard: ${result.saved.length} · Gewist: ${result.cleared.length}`;
  return (
    <span style={{ ...resultStyle, ...(toneStyles[tone] ?? {}) }}>{text}</span>
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

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "0.75rem",
};

const fieldRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
};

const labelStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "0.5rem",
  fontSize: "0.85rem",
  fontWeight: 500,
};

const keyCodeStyle: CSSProperties = {
  fontSize: "0.7rem",
  opacity: 0.5,
  fontFamily: "monospace",
};

const inputStyle: CSSProperties = {
  flex: 1,
  padding: "0.5rem 0.65rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.9rem",
  fontFamily: "inherit",
};

const smallBtnStyle: CSSProperties = {
  padding: "0 0.65rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#c9cdd6",
  cursor: "pointer",
  fontSize: "0.85rem",
};

const hintStyle: CSSProperties = {
  margin: "0.1rem 0 0 0",
  fontSize: "0.75rem",
  opacity: 0.55,
  lineHeight: 1.4,
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  marginTop: "1.5rem",
  position: "sticky",
  bottom: "0",
  padding: "1rem 0",
  background: "#0b0d12",
  borderTop: "1px solid #20252e",
};

const btnStyle: CSSProperties = {
  padding: "0.6rem 1.2rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.95rem",
  fontWeight: 500,
  cursor: "pointer",
};

const resultStyle: CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
};

const toneStyles: Record<string, CSSProperties> = {
  ok: { background: "#143524", color: "#7be0a6" },
  bad: { background: "#3a1414", color: "#ff8888" },
  neutral: { background: "#1c2129", color: "#c9cdd6" },
};
