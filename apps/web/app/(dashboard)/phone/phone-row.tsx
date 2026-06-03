"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pill } from "../_ui";
import { setPhoneStatus } from "./actions";
import { generateCallPitch, previewWarmFollowupMail } from "./ai-actions";
import {
  PHONE_STATUSES,
  STATUS_META,
  type PhoneLeadRow,
  type PhoneStatus,
} from "./types";

/**
 * Snel-vul chips voor het notitieveld. Klik voegt de label toe als
 * extra regel (zodat eerdere notities behouden blijven). Consistente
 * notities helpen Claude in de warm-followup mail.
 */
const NOTE_CHIPS = [
  "Receptie / niet de eigenaar",
  "Eigenaar afwezig",
  "Wil offerte",
  "Concurrent in gebruik",
  "Doorverbonden",
  "Bel ik volgende week terug",
];

const POWER_DIAL_EVENT = "phone:advance";

export function PhoneRow({ row }: { row: PhoneLeadRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<PhoneStatus | "">(
    row.phoneStatus ?? "",
  );
  const [draftNotes, setDraftNotes] = useState(row.phoneNotes ?? "");
  const [draftCallback, setDraftCallback] = useState(
    defaultCallbackInput(row.phoneNextAttemptAt),
  );
  const [draftMailSendAt, setDraftMailSendAt] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // AI bel-pitch state — pas opgehaald op klik
  const [pitch, setPitch] = useState<string | null>(null);
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchError, setPitchError] = useState<string | null>(null);

  // Mail-preview state — alleen relevant bij draftStatus=interested
  const [mailPreview, setMailPreview] = useState<{
    subject: string;
    body: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function fetchPitch() {
    setPitchLoading(true);
    setPitchError(null);
    const r = await generateCallPitch(row.businessId);
    setPitchLoading(false);
    if (r.ok && r.pitch) setPitch(r.pitch);
    else setPitchError(r.error ?? "Onbekende fout");
  }

  async function fetchMailPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    const r = await previewWarmFollowupMail(row.businessId, draftNotes);
    setPreviewLoading(false);
    if (r.ok && r.subject && r.body) {
      setMailPreview({ subject: r.subject, body: r.body });
    } else {
      setPreviewError(r.error ?? "Onbekende fout");
    }
  }

  // Power-dial: andere row stuurt een event als 'ie wil dat de
  // volgende open-row opent. We luisteren alleen als deze rij Open is
  // (geen status), zodat we niet per ongeluk afgehandelde rijen weer
  // opengooien.
  useEffect(() => {
    if (row.phoneStatus !== null) return;
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ targetId: string }>).detail;
      if (detail.targetId === row.businessId) setOpen(true);
    }
    window.addEventListener(POWER_DIAL_EVENT, handler);
    return () => window.removeEventListener(POWER_DIAL_EVENT, handler);
  }, [row.businessId, row.phoneStatus]);

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("status", draftStatus);
    fd.set("notes", draftNotes);
    if (draftStatus === "callback" && draftCallback) {
      fd.set("nextAttemptAt", new Date(draftCallback).toISOString());
    }
    if (draftStatus === "interested" && draftMailSendAt) {
      fd.set("mailSendAt", new Date(draftMailSendAt).toISOString());
    }
    return fd;
  }

  function save({ advance }: { advance: boolean }) {
    startTransition(async () => {
      const r = await setPhoneStatus(row.businessId, buildFormData());
      if (!r.ok) return;
      setSavedAt(new Date().toLocaleTimeString("nl-NL"));
      setOpen(false);
      if (advance) {
        // Triggert na server-state refresh een event dat de volgende
        // openbare row oppikt. Korte timeout om de revalidate eerst
        // door React te laten lopen.
        router.refresh();
        setTimeout(() => advanceToNextOpen(row.businessId), 200);
      }
    });
  }

  function appendChip(label: string) {
    setDraftNotes((cur) =>
      cur.trim() ? cur.trim() + " · " + label : label,
    );
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
    <tr
      data-business-id={row.businessId}
      data-phone-status={row.phoneStatus ?? ""}
    >
      <td style={tdStyle}>
        <HeatPill heat={row.heat} />
      </td>
      <td style={tdStyle}>
        <Link
          href={`/leads/${row.businessId}`}
          style={{ color: "#7ab8ff", textDecoration: "none" }}
        >
          {row.name}
        </Link>
        {row.phoneAttempts > 0 ? (
          <div style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: "0.15rem" }}>
            {row.phoneAttempts}× geprobeerd
          </div>
        ) : null}
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
        {row.phoneNextAttemptAt && row.phoneStatus !== "interested" ? (
          <div
            style={{
              opacity: 0.65,
              fontSize: "0.7rem",
              marginTop: "0.2rem",
              color: "#7aa7ff",
            }}
          >
            terug op {new Date(row.phoneNextAttemptAt).toLocaleString("nl-NL", {
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
            <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={fetchPitch}
                disabled={pitchLoading}
                style={pitchBtnStyle}
                title="Claude schrijft een korte bel-opener op basis van de business + audit"
              >
                {pitchLoading ? "…" : pitch ? "Nieuwe pitch" : "💡 Bel-pitch"}
              </button>
            </div>
            {pitch ? (
              <div style={pitchBoxStyle}>{pitch}</div>
            ) : pitchError ? (
              <div style={errorBoxStyle}>{pitchError}</div>
            ) : null}
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
            {draftStatus === "callback" ? (
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <span style={{ fontSize: "0.75rem", opacity: 0.65 }}>
                  Terugbellen op:
                </span>
                <input
                  type="datetime-local"
                  value={draftCallback}
                  onChange={(e) => setDraftCallback(e.target.value)}
                  style={selectStyle}
                />
              </label>
            ) : null}
            {(draftStatus === "voicemail" || draftStatus === "called") ? (
              <div style={{ fontSize: "0.7rem", opacity: 0.55, fontStyle: "italic" }}>
                {draftStatus === "voicemail"
                  ? "Verschijnt over 3 werkdagen weer in Open."
                  : "Verschijnt over 7 dagen weer in Open."}
              </div>
            ) : null}
            {draftStatus === "interested" ? (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                  <span style={{ fontSize: "0.75rem", opacity: 0.65 }}>
                    Wanneer eerste warm-up mail versturen?
                    <span style={{ opacity: 0.5 }}> (leeg = direct)</span>
                  </span>
                  <input
                    type="datetime-local"
                    value={draftMailSendAt}
                    onChange={(e) => setDraftMailSendAt(e.target.value)}
                    style={selectStyle}
                  />
                </label>
                <div style={{ fontSize: "0.7rem", color: "#7be0a6" }}>
                  Lead wordt op de gekozen datum aan de warm-followup
                  campagne toegevoegd. Notitie hieronder wordt door
                  Claude meegenomen in de mail.
                </div>
                <button
                  type="button"
                  onClick={fetchMailPreview}
                  disabled={previewLoading}
                  style={pitchBtnStyle}
                  title="Bekijk wat Claude zou versturen met de huidige notitie"
                >
                  {previewLoading
                    ? "…"
                    : mailPreview
                      ? "Regenereer preview"
                      : "📧 Toon mail-preview"}
                </button>
                {mailPreview ? (
                  <div style={mailPreviewBoxStyle}>
                    <div style={{ fontWeight: 600, marginBottom: "0.3rem" }}>
                      <span style={{ opacity: 0.55 }}>Onderwerp:</span>{" "}
                      {mailPreview.subject}
                    </div>
                    <pre style={mailPreviewBodyStyle}>{mailPreview.body}</pre>
                    <div style={{ fontSize: "0.65rem", opacity: 0.5, marginTop: "0.4rem" }}>
                      Bij verzending kan Claude een minimaal andere variant
                      schrijven (temperature). Verfijn je notitie voor
                      andere accenten.
                    </div>
                  </div>
                ) : previewError ? (
                  <div style={errorBoxStyle}>{previewError}</div>
                ) : null}
              </>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {NOTE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => appendChip(chip)}
                  style={chipStyle}
                  title={`Voeg "${chip}" toe aan notitie`}
                >
                  + {chip}
                </button>
              ))}
            </div>
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
                onClick={() => save({ advance: false })}
                disabled={pending || !draftStatus}
                style={primaryBtnStyle}
              >
                {pending ? "…" : "Bewaar"}
              </button>
              <button
                type="button"
                onClick={() => save({ advance: true })}
                disabled={pending || !draftStatus}
                style={primaryAccentBtnStyle}
                title="Sla op + spring meteen naar de volgende open lead"
              >
                {pending ? "…" : "Bewaar + volgende →"}
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

function HeatPill({ heat }: { heat: number }) {
  const tone: "ok" | "warn" | "neutral" | "bad" =
    heat >= 75 ? "ok" : heat >= 55 ? "warn" : heat >= 35 ? "neutral" : "bad";
  return (
    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
      <Pill tone={tone}>{heat}</Pill>
    </span>
  );
}

function defaultCallbackInput(nextAttemptAt: string | null): string {
  if (nextAttemptAt) {
    const d = new Date(nextAttemptAt);
    if (!Number.isNaN(d.getTime())) return toDatetimeLocalValue(d);
  }
  // Default: morgen om 10:00 lokale tijd
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
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

const primaryAccentBtnStyle: CSSProperties = {
  padding: "0.35rem 0.8rem",
  background: "#1c7a3a",
  border: "none",
  borderRadius: "5px",
  color: "white",
  fontSize: "0.8rem",
  fontWeight: 500,
  cursor: "pointer",
};

const chipStyle: CSSProperties = {
  padding: "0.2rem 0.5rem",
  background: "#0f1218",
  border: "1px solid #2a3140",
  borderRadius: "12px",
  color: "#8a93a3",
  fontSize: "0.7rem",
  cursor: "pointer",
};

const pitchBtnStyle: CSSProperties = {
  padding: "0.3rem 0.65rem",
  background: "#2a1c3a",
  border: "1px solid #4a3060",
  borderRadius: "5px",
  color: "#c79bff",
  fontSize: "0.75rem",
  cursor: "pointer",
};

const pitchBoxStyle: CSSProperties = {
  background: "#0f0c18",
  border: "1px solid #2a1c3a",
  borderRadius: "5px",
  padding: "0.5rem 0.7rem",
  fontSize: "0.82rem",
  lineHeight: 1.45,
  color: "#d4caf0",
  fontStyle: "italic",
};

const errorBoxStyle: CSSProperties = {
  background: "#3a1414",
  border: "1px solid #5a2020",
  borderRadius: "5px",
  padding: "0.4rem 0.65rem",
  fontSize: "0.75rem",
  color: "#ff8888",
};

const mailPreviewBoxStyle: CSSProperties = {
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "5px",
  padding: "0.6rem 0.75rem",
  fontSize: "0.8rem",
  lineHeight: 1.5,
  color: "#d4d8e0",
  maxWidth: "420px",
};

const mailPreviewBodyStyle: CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  lineHeight: 1.5,
};

/**
 * DOM-walk om de eerstvolgende phone-row te vinden die nog "open" is
 * (geen phone_status gezet). Triggert een custom event waar die row
 * naar luistert en zichzelf op de edit-modus zet.
 */
function advanceToNextOpen(currentBusinessId: string): void {
  const rows = Array.from(
    document.querySelectorAll<HTMLTableRowElement>("tr[data-business-id]"),
  );
  const currentIdx = rows.findIndex(
    (r) => r.dataset["businessId"] === currentBusinessId,
  );
  const searchStart = currentIdx >= 0 ? currentIdx + 1 : 0;
  const next =
    rows.slice(searchStart).find((r) => r.dataset["phoneStatus"] === "") ??
    // fallback: ook eerder in de lijst zoeken (in case row was removed)
    rows.find((r) => r.dataset["phoneStatus"] === "");
  if (!next) return;
  const id = next.dataset["businessId"];
  if (!id) return;
  next.scrollIntoView({ behavior: "smooth", block: "center" });
  window.dispatchEvent(
    new CustomEvent("phone:advance", { detail: { targetId: id } }),
  );
}

const notesStyle: CSSProperties = {
  marginTop: "0.4rem",
  fontSize: "0.75rem",
  opacity: 0.6,
  fontStyle: "italic",
  maxWidth: "220px",
  lineHeight: 1.3,
};
