"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { Pill } from "../_ui";
import { setPhoneStatus } from "./actions";
import {
  PHONE_STATUSES,
  STATUS_META,
  type PhoneLeadRow,
  type PhoneStatus,
} from "./types";

export function PhoneRow({ row }: { row: PhoneLeadRow }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<PhoneStatus | "">(
    row.phoneStatus ?? "",
  );
  const [draftNotes, setDraftNotes] = useState(row.phoneNotes ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function save() {
    const fd = new FormData();
    fd.set("status", draftStatus);
    fd.set("notes", draftNotes);
    startTransition(async () => {
      const r = await setPhoneStatus(row.businessId, fd);
      if (r.ok) {
        setSavedAt(new Date().toLocaleTimeString("nl-NL"));
        setOpen(false);
      }
    });
  }

  function clear() {
    const fd = new FormData();
    fd.set("status", "clear");
    fd.set("notes", "");
    startTransition(async () => {
      await setPhoneStatus(row.businessId, fd);
      setDraftStatus("");
      setDraftNotes("");
      setSavedAt(new Date().toLocaleTimeString("nl-NL"));
      setOpen(false);
    });
  }

  return (
    <tr>
      <td style={tdStyle}>
        <Link
          href={`/leads/${row.businessId}`}
          style={{ color: "#7ab8ff", textDecoration: "none" }}
        >
          {row.name}
        </Link>
      </td>
      <td style={tdStyle}>{row.city ?? "—"}</td>
      <td style={tdStyle}>{row.category ?? "—"}</td>
      <td style={tdStyle}>
        {row.phone ? (
          <a
            href={`tel:${row.phone.replace(/[^\d+]/g, "")}`}
            style={{
              color: "#7be0a6",
              textDecoration: "none",
              fontFamily: "monospace",
            }}
          >
            {row.phone}
          </a>
        ) : (
          "—"
        )}
      </td>
      <td style={tdStyle}>
        {row.websiteUrl ? (
          <a
            href={row.websiteUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#7ab8ff", fontSize: "0.85rem" }}
          >
            bekijken
          </a>
        ) : (
          <span style={{ opacity: 0.5 }}>—</span>
        )}
      </td>
      <td style={tdStyle}>{qualityPill(row.websiteUrl, row.websiteQuality)}</td>
      <td style={tdStyle}>
        {row.rating != null
          ? `${row.rating.toFixed(1)} (${row.reviewsCount ?? 0})`
          : "—"}
      </td>
      <td style={tdStyle}>
        {row.phoneStatus ? (
          <Pill tone={STATUS_META[row.phoneStatus].tone}>
            {STATUS_META[row.phoneStatus].label}
          </Pill>
        ) : (
          <span style={{ opacity: 0.5, fontSize: "0.8rem" }}>—</span>
        )}
        {row.phoneCalledAt ? (
          <div style={{ opacity: 0.55, fontSize: "0.7rem", marginTop: "0.2rem" }}>
            {new Date(row.phoneCalledAt).toLocaleString("nl-NL", {
              timeZone: "Europe/Amsterdam",
              dateStyle: "short",
              timeStyle: "short",
            })}
          </div>
        ) : null}
      </td>
      <td style={tdStyle}>
        {open ? (
          <div style={editorStyle}>
            <select
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value as PhoneStatus | "")}
              style={selectStyle}
            >
              <option value="">— kies status —</option>
              {PHONE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
            <textarea
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              placeholder="Notitie (bv. 'Pieter, terugbellen na 17u')"
              rows={2}
              style={textareaStyle}
            />
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={save}
                disabled={pending || !draftStatus}
                style={primaryBtnStyle}
              >
                {pending ? "…" : "Bewaar"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={ghostBtnStyle}
              >
                Annuleer
              </button>
              {row.phoneStatus ? (
                <button
                  type="button"
                  onClick={clear}
                  disabled={pending}
                  style={dangerBtnStyle}
                  title="Wis status — lead komt weer in de 'nog te bellen' lijst"
                >
                  Wis status
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={editBtnStyle}
          >
            {row.phoneStatus ? "Bewerken" : "Markeer"}
          </button>
        )}
        {row.phoneNotes && !open ? (
          <div style={notesStyle} title={row.phoneNotes}>
            {row.phoneNotes.length > 60
              ? row.phoneNotes.slice(0, 60) + "…"
              : row.phoneNotes}
          </div>
        ) : null}
        {savedAt && !open ? (
          <div style={{ opacity: 0.55, fontSize: "0.7rem", marginTop: "0.2rem" }}>
            opgeslagen {savedAt}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function qualityPill(websiteUrl: string | null, quality: string | null) {
  if (!websiteUrl) return <Pill tone="bad">geen site</Pill>;
  if (!quality || quality === "none")
    return <span style={{ opacity: 0.6 }}>—</span>;
  if (quality === "good") return <Pill tone="ok">goed</Pill>;
  if (quality === "decent") return <Pill tone="warn">decent</Pill>;
  if (quality === "outdated") return <Pill tone="bad">verouderd</Pill>;
  return <Pill>{quality}</Pill>;
}

const tdStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #20252e",
  fontSize: "0.9rem",
  verticalAlign: "top",
};

const editBtnStyle: CSSProperties = {
  padding: "0.35rem 0.7rem",
  background: "#1c2129",
  border: "1px solid #2a3140",
  borderRadius: "5px",
  color: "#c9cdd6",
  fontSize: "0.8rem",
  cursor: "pointer",
};

const editorStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  minWidth: "240px",
};

const selectStyle: CSSProperties = {
  padding: "0.4rem 0.6rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "5px",
  color: "#e6e8ee",
  fontSize: "0.85rem",
};

const textareaStyle: CSSProperties = {
  padding: "0.4rem 0.6rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "5px",
  color: "#e6e8ee",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  resize: "vertical",
};

const primaryBtnStyle: CSSProperties = {
  padding: "0.35rem 0.8rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "5px",
  color: "white",
  fontSize: "0.8rem",
  fontWeight: 500,
  cursor: "pointer",
};

const ghostBtnStyle: CSSProperties = {
  padding: "0.35rem 0.8rem",
  background: "transparent",
  border: "1px solid #2a3140",
  borderRadius: "5px",
  color: "#c9cdd6",
  fontSize: "0.8rem",
  cursor: "pointer",
};

const dangerBtnStyle: CSSProperties = {
  padding: "0.35rem 0.8rem",
  background: "transparent",
  border: "1px solid #3a1414",
  borderRadius: "5px",
  color: "#ff8888",
  fontSize: "0.8rem",
  cursor: "pointer",
};

const notesStyle: CSSProperties = {
  marginTop: "0.4rem",
  fontSize: "0.75rem",
  opacity: 0.6,
  fontStyle: "italic",
  maxWidth: "220px",
  lineHeight: 1.3,
};
