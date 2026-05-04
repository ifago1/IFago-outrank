"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties } from "react";
import {
  createCampaign,
  deleteCampaign,
  setCampaignStatus,
} from "./actions";
import type { CampaignActionResult } from "./types";
import type { CampaignRow } from "./page";

export function CampaignsClient({
  campaigns,
}: {
  campaigns: CampaignRow[];
}) {
  return (
    <div>
      <NewCampaignForm />
      <h2 style={h2Style}>Campagnes ({campaigns.length})</h2>
      {campaigns.length === 0 ? (
        <p style={emptyStyle}>
          Nog geen campagnes — vul het formulier hierboven in om je eerste
          aan te maken (komt met de standaard 3-step sequence).
        </p>
      ) : (
        <div style={{ overflow: "hidden", border: "1px solid #20252e", borderRadius: "8px" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Naam</th>
                <th style={thStyle}>Niche</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Steps</th>
                <th style={thStyle}>Leads</th>
                <th style={thStyle}>Sent</th>
                <th style={thStyle}>Replied</th>
                <th style={thStyle}>Acties</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <CampaignRowRow key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewCampaignForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CampaignActionResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const r = await createCampaign(data);
      setResult(r);
      if (r.ok) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} style={cardStyle}>
      <h2 style={h2Style}>Nieuwe campagne</h2>
      <p style={descStyle}>
        Krijgt automatisch de standaard 3-step sequence (dag 0, dag 4, dag 9).
        Templates kun je daarna per step bewerken op de detailpagina.
      </p>
      <div style={gridStyle}>
        <Field
          label="Naam"
          name="name"
          required
          placeholder="bv. Kappers Utrecht Q2"
          hint="Uniek in dit account."
        />
        <Field
          label="Niche (optioneel)"
          name="niche"
          placeholder="kapper"
          hint="Voor filteren in de Leads-tab + AI-personalisatie."
        />
        <Toggle
          label="Direct activeren"
          name="activate"
          defaultChecked={true}
          hint="Aan = mails gaan uit zodra leads zijn toegewezen. Uit = blijft draft."
        />
      </div>
      <div style={footerStyle}>
        <button type="submit" disabled={pending} style={primaryBtnStyle}>
          {pending ? "Aanmaken…" : "Campagne aanmaken"}
        </button>
        {result ? <ResultPill result={result} /> : null}
      </div>
    </form>
  );
}

function CampaignRowRow({ c }: { c: CampaignRow }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CampaignActionResult | null>(null);

  function onStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === c.status) return;
    startTransition(async () => {
      const r = await setCampaignStatus(c.id, next);
      setResult(r);
    });
  }

  function onDelete() {
    if (
      !confirm(
        `Verwijder "${c.name}" (${c.leadCount} lead(s), ${c.sentCount} sent)? Cascade-delete: alle campaign_leads + emails_sent gaan ook weg.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await deleteCampaign(c.id);
      setResult(r);
    });
  }

  return (
    <tr>
      <td style={tdStyle}>
        <Link href={`/campaigns/${c.id}`} style={{ color: "#7ab8ff" }}>
          {c.name}
        </Link>
        {result ? (
          <div style={{ marginTop: "0.3rem" }}>
            <ResultPill result={result} small />
          </div>
        ) : null}
      </td>
      <td style={tdStyle}>{c.niche ?? "—"}</td>
      <td style={tdStyle}>
        <select
          defaultValue={c.status}
          disabled={pending}
          onChange={onStatusChange}
          style={selectStyle}
        >
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="paused">paused</option>
        </select>
      </td>
      <td style={tdStyle}>{c.stepCount}</td>
      <td style={tdStyle}>{c.leadCount}</td>
      <td style={tdStyle}>{c.sentCount}</td>
      <td style={tdStyle}>
        {c.repliedCount > 0 ? (
          <span style={pillOkStyle}>{c.repliedCount}</span>
        ) : (
          c.repliedCount
        )}
      </td>
      <td style={tdStyle}>
        <button
          onClick={onDelete}
          disabled={pending}
          style={dangerBtnStyle}
          title="Verwijder campagne (cascade)"
        >
          Verwijder
        </button>
      </td>
    </tr>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label style={labelStyle}>
      <span style={labelTextStyle}>{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        style={inputStyle}
      />
      {hint ? <span style={hintStyle}>{hint}</span> : null}
    </label>
  );
}

function Toggle({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label style={labelStyle}>
      <span style={labelTextStyle}>{label}</span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        style={{ width: 18, height: 18 }}
      />
      {hint ? <span style={hintStyle}>{hint}</span> : null}
    </label>
  );
}

function ResultPill({
  result,
  small = false,
}: {
  result: CampaignActionResult;
  small?: boolean;
}) {
  return (
    <span
      style={{
        ...(small ? pillSmallStyle : pillStyle),
        background: result.ok ? "#143524" : "#3a1414",
        color: result.ok ? "#7be0a6" : "#ff8888",
      }}
    >
      {result.message}
    </span>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1.5rem",
  background: "#0f1218",
};
const h2Style: CSSProperties = { fontSize: "1.05rem", margin: "0 0 0.4rem 0" };
const descStyle: CSSProperties = {
  margin: "0 0 0.75rem 0",
  fontSize: "0.85rem",
  opacity: 0.7,
  lineHeight: 1.5,
};
const emptyStyle: CSSProperties = { opacity: 0.6, fontSize: "0.9rem" };
const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "0.75rem",
};
const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  marginTop: "0.75rem",
};
const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
};
const labelTextStyle: CSSProperties = { fontSize: "0.85rem", fontWeight: 500 };
const inputStyle: CSSProperties = {
  padding: "0.5rem 0.65rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.9rem",
  fontFamily: "inherit",
};
const hintStyle: CSSProperties = {
  fontSize: "0.75rem",
  opacity: 0.55,
  lineHeight: 1.4,
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
const dangerBtnStyle: CSSProperties = {
  padding: "0.4rem 0.8rem",
  background: "transparent",
  border: "1px solid #3a1414",
  borderRadius: "6px",
  color: "#ff8888",
  fontSize: "0.8rem",
  cursor: "pointer",
};
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse" };
const thStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #2a3140",
  textAlign: "left",
  fontSize: "0.85rem",
  fontWeight: 600,
  background: "#0f1218",
};
const tdStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #20252e",
  fontSize: "0.9rem",
  verticalAlign: "middle",
};
const selectStyle: CSSProperties = {
  padding: "0.3rem 0.5rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.85rem",
};
const pillStyle: CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
};
const pillSmallStyle: CSSProperties = {
  padding: "0.2rem 0.6rem",
  borderRadius: "999px",
  fontSize: "0.7rem",
};
const pillOkStyle: CSSProperties = {
  background: "#143524",
  color: "#7be0a6",
  padding: "0.2rem 0.55rem",
  borderRadius: "999px",
  fontSize: "0.75rem",
};
