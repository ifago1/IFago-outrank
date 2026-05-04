"use client";

import { useState, useTransition, type CSSProperties } from "react";
import {
  createSearch,
  deleteSearch,
  runSearchNow,
  updateSearch,
} from "./actions";
import type { DiscoverActionResult, SavedSearchView } from "./types";

export function DiscoverClient({ searches }: { searches: SavedSearchView[] }) {
  return (
    <div>
      <NewSearchForm />
      <h2 style={h2Style}>Saved searches ({searches.length})</h2>
      {searches.length === 0 ? (
        <p style={emptyStyle}>
          Nog geen searches. Voeg er één toe hierboven — de scheduler runt
          deze dan elk interval automatisch.
        </p>
      ) : (
        searches.map((s) => <SearchRow key={s.id} search={s} />)
      )}
    </div>
  );
}

function NewSearchForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DiscoverActionResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const r = await createSearch(data);
      setResult(r);
      if (r.ok) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} style={cardStyle}>
      <h2 style={h2Style}>Nieuwe saved search</h2>
      <div style={gridStyle}>
        <Field
          label="Naam"
          name="name"
          required
          placeholder="bv. Kappers Utrecht weekly"
        />
        <Field
          label="Niche"
          name="niche"
          required
          placeholder="kapper"
          hint="Wat in de Google Places query komt — bv. 'kapper', 'fysiotherapeut', 'tandarts'."
        />
        <Field
          label="Stad"
          name="city"
          required
          placeholder="Utrecht"
        />
        <Field
          label="Radius (meters)"
          name="radiusMeters"
          type="number"
          placeholder="5000"
          hint="Optioneel. Met radius wordt de stad eerst geocoded en filteren we strikt op afstand. Zonder = text-only zoekopdracht."
        />
        <Field
          label="Max pages (1-3)"
          name="maxPages"
          type="number"
          defaultValue="1"
          hint="20 results per page; 3 pages = 60 max. Elke page is een aparte API-call."
        />
        <Field
          label="Interval (dagen)"
          name="scheduleIntervalDays"
          type="number"
          defaultValue="7"
          hint="Hoe vaak de scheduler deze search opnieuw runt. 1=dagelijks, 7=wekelijks, 30=maandelijks."
        />
        <Toggle
          label="Schedule actief"
          name="scheduleEnabled"
          defaultChecked={true}
          hint="Uit = niet automatisch, maar wel handmatig 'Run now'."
        />
      </div>
      <div style={footerStyle}>
        <button type="submit" disabled={pending} style={primaryBtnStyle}>
          {pending ? "Opslaan…" : "Search aanmaken"}
        </button>
        {result ? <ResultPill result={result} /> : null}
      </div>
    </form>
  );
}

function SearchRow({ search }: { search: SavedSearchView }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DiscoverActionResult | null>(null);

  function onUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateSearch(search.id, data);
      setResult(r);
      if (r.ok) setEditing(false);
    });
  }

  function onDelete() {
    if (!confirm(`Weet je zeker dat je "${search.name}" wilt verwijderen?`)) return;
    startTransition(async () => {
      const r = await deleteSearch(search.id);
      setResult(r);
    });
  }

  function onRunNow() {
    startTransition(async () => {
      const r = await runSearchNow(search.id);
      setResult(r);
    });
  }

  return (
    <div style={cardStyle}>
      <header style={rowHeaderStyle}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>{search.name}</h3>
          <p style={subStyle}>
            <code>{search.niche}</code> in <code>{search.city}</code>
            {search.radiusMeters
              ? ` · radius ${search.radiusMeters / 1000}km`
              : " · text-only"}
            · {search.scheduleEnabled ? "auto" : "uit"} (elke{" "}
            {search.scheduleIntervalDays} dagen)
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button onClick={onRunNow} disabled={pending} style={primaryBtnStyle}>
            {pending ? "…" : "Run now"}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={pending}
            style={ghostBtnStyle}
          >
            {editing ? "Annuleer" : "Bewerk"}
          </button>
          <button
            onClick={onDelete}
            disabled={pending}
            style={dangerBtnStyle}
          >
            Verwijder
          </button>
        </div>
      </header>

      {search.lastRunAt ? (
        <p style={subStyle}>
          Laatste run:{" "}
          <strong>
            {new Date(search.lastRunAt).toLocaleString("nl-NL")}
          </strong>
          {search.lastRunResult?.ok
            ? ` — ${search.lastRunResult.found ?? 0} gevonden / ${search.lastRunResult.upserted ?? 0} opgeslagen`
            : search.lastRunResult?.error
              ? ` — ⚠ ${search.lastRunResult.error}`
              : ""}
        </p>
      ) : (
        <p style={subStyle}>Nog niet gerund.</p>
      )}

      {result ? <ResultPill result={result} /> : null}

      {editing ? (
        <form onSubmit={onUpdate} style={{ marginTop: "0.75rem" }}>
          <div style={gridStyle}>
            <Field label="Naam" name="name" defaultValue={search.name} required />
            <Field label="Niche" name="niche" defaultValue={search.niche} required />
            <Field label="Stad" name="city" defaultValue={search.city} required />
            <Field
              label="Radius (meters)"
              name="radiusMeters"
              type="number"
              defaultValue={search.radiusMeters?.toString() ?? ""}
            />
            <Field
              label="Max pages"
              name="maxPages"
              type="number"
              defaultValue={String(search.maxPages)}
            />
            <Field
              label="Interval (dagen)"
              name="scheduleIntervalDays"
              type="number"
              defaultValue={String(search.scheduleIntervalDays)}
            />
            <Toggle
              label="Schedule actief"
              name="scheduleEnabled"
              defaultChecked={search.scheduleEnabled}
            />
          </div>
          <div style={footerStyle}>
            <button type="submit" disabled={pending} style={primaryBtnStyle}>
              {pending ? "Opslaan…" : "Opslaan"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
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
        defaultValue={defaultValue}
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

function ResultPill({ result }: { result: DiscoverActionResult }) {
  return (
    <span
      style={{
        ...pillStyle,
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
  marginBottom: "1rem",
  background: "#0f1218",
};
const h2Style: CSSProperties = { fontSize: "1.05rem", margin: "0 0 0.75rem 0" };
const rowHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "0.75rem",
  marginBottom: "0.4rem",
};
const subStyle: CSSProperties = {
  margin: "0.15rem 0",
  fontSize: "0.85rem",
  opacity: 0.7,
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
const ghostBtnStyle: CSSProperties = {
  padding: "0.5rem 1rem",
  background: "transparent",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#c9cdd6",
  fontSize: "0.9rem",
  cursor: "pointer",
};
const dangerBtnStyle: CSSProperties = {
  padding: "0.5rem 1rem",
  background: "transparent",
  border: "1px solid #3a1414",
  borderRadius: "6px",
  color: "#ff8888",
  fontSize: "0.9rem",
  cursor: "pointer",
};
const pillStyle: CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
};
