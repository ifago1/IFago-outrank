"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { assignLeadsToCampaign, bulkEnrichLeads } from "./actions";
import type { AssignLeadsResult, BulkEnrichResult } from "./types";

export interface LeadRow {
  businessId: string;
  name: string;
  city: string | null;
  category: string | null;
  websiteUrl: string | null;
  websiteQuality: string | null;
  rating: number | null;
  reviewsCount: number | null;
  contactCount: number;
  verifiedContactCount: number;
  activeLeadCount: number;
}

export interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

interface SearchParams {
  q?: string;
  niche?: string;
  city?: string;
  status?: "any" | "no_website" | "outdated" | "decent" | "good";
}

export function LeadsClient({
  rows,
  campaigns,
  params,
}: {
  rows: LeadRow[];
  campaigns: CampaignOption[];
  params: SearchParams;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [bulkCampaignId, setBulkCampaignId] = useState<string>(
    campaigns[0]?.id ?? "",
  );
  const [result, setResult] = useState<
    AssignLeadsResult | BulkEnrichResult | null
  >(null);

  const selectableIds = useMemo(
    () => rows.map((r) => r.businessId),
    [rows],
  );
  // Hoeveel selectede leads kunnen daadwerkelijk worden geënricht
  // (geen contact yet + wel een website).
  const enrichableSelected = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (selected.has(r.businessId) && r.contactCount === 0 && r.websiteUrl) {
        set.add(r.businessId);
      }
    }
    return set;
  }, [rows, selected]);
  // Hoeveel selected leads kunnen worden toegewezen aan een campagne.
  const assignableSelected = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (selected.has(r.businessId) && r.contactCount > 0) {
        set.add(r.businessId);
      }
    }
    return set;
  }, [rows, selected]);
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulkAssign() {
    if (!bulkCampaignId || assignableSelected.size === 0) return;
    const ids = [...assignableSelected];
    startTransition(async () => {
      const r = await assignLeadsToCampaign(ids, bulkCampaignId);
      setResult(r);
      if (r.ok && (r.assigned ?? 0) > 0) {
        setSelected(new Set());
      }
    });
  }

  function runBulkEnrich() {
    if (enrichableSelected.size === 0) return;
    const ids = [...enrichableSelected];
    startTransition(async () => {
      const r = await bulkEnrichLeads(ids);
      setResult(r);
      if (r.ok && r.newContacts > 0) {
        setSelected(new Set());
      }
    });
  }

  return (
    <div>
      <FilterBar params={params} />

      {campaigns.length === 0 ? (
        <div style={warningCardStyle}>
          Geen campagnes — maak eerst een campagne aan in de{" "}
          <Link href="/campaigns" style={{ color: "#7ab8ff" }}>
            Campaigns-tab
          </Link>{" "}
          voordat je leads kunt toewijzen.
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div style={bulkBarStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <strong>{selected.size}</strong>
            <span style={{ opacity: 0.75 }}>geselecteerd</span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={ghostBtnStyle}
            >
              Wis selectie
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={runBulkEnrich}
              disabled={pending || enrichableSelected.size === 0}
              style={primaryBtnStyle}
              title={
                enrichableSelected.size === 0
                  ? "Geen leads in selectie met website + zonder contact"
                  : `Scrape website + Hunter voor ${enrichableSelected.size} lead(s)`
              }
            >
              {pending
                ? "Enriching…"
                : `Enrich ${enrichableSelected.size} (zoek contacts)`}
            </button>
            <span style={{ opacity: 0.3 }}>·</span>
            <label style={{ fontSize: "0.85rem", opacity: 0.85 }}>
              Toewijzen aan:
            </label>
            <select
              value={bulkCampaignId}
              onChange={(e) => setBulkCampaignId(e.target.value)}
              disabled={pending || campaigns.length === 0}
              style={selectStyle}
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={runBulkAssign}
              disabled={
                pending || !bulkCampaignId || assignableSelected.size === 0
              }
              style={primaryBtnStyle}
              title={
                assignableSelected.size === 0
                  ? "Geen leads met contact in selectie — enrich eerst"
                  : ""
              }
            >
              {pending
                ? "Toevoegen…"
                : `Voeg ${assignableSelected.size} toe`}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div style={{ marginBottom: "0.75rem" }}>
          <ResultPill result={result} />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          Nog geen leads gevonden. Run{" "}
          <code>pnpm discover --niche=... --city=...</code>.
        </p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thCheckStyle}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={selectableIds.length === 0}
                    title={
                      selectableIds.length === 0
                        ? "Geen contacts in deze view — run pnpm enrich"
                        : allSelected
                          ? "Wis selectie"
                          : "Selecteer alle (met contact)"
                    }
                  />
                </th>
                <th style={thStyle}>Business</th>
                <th style={thStyle}>City</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Website</th>
                <th style={thStyle}>Quality</th>
                <th style={thStyle}>Rating</th>
                <th style={thStyle}>Contacts</th>
                <th style={thStyle}>In campaign</th>
                <th style={thStyle}>Actie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <LeadRowView
                  key={r.businessId}
                  row={r}
                  campaigns={campaigns}
                  selected={selected.has(r.businessId)}
                  onToggle={() => toggleOne(r.businessId)}
                  onResult={setResult}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeadRowView({
  row,
  campaigns,
  selected,
  onToggle,
  onResult,
}: {
  row: LeadRow;
  campaigns: CampaignOption[];
  selected: boolean;
  onToggle: () => void;
  onResult: (r: AssignLeadsResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [campaignId, setCampaignId] = useState<string>(campaigns[0]?.id ?? "");
  const hasContact = row.contactCount > 0;
  const hasWebsite = row.websiteUrl != null;
  const checkboxTitle = hasContact
    ? "Selecteer voor bulk-toewijzing"
    : hasWebsite
      ? "Geen contact — selecteer voor bulk-enrich"
      : "Geen website + geen contact — niets te doen";

  function onAssign() {
    if (!campaignId) return;
    startTransition(async () => {
      const r = await assignLeadsToCampaign([row.businessId], campaignId);
      onResult(r);
      setOpen(false);
    });
  }

  return (
    <tr style={selected ? selectedRowStyle : undefined}>
      <td style={tdCheckStyle}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={!hasContact && !hasWebsite}
          title={checkboxTitle}
        />
      </td>
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
        {row.websiteUrl ? (
          <a
            href={row.websiteUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#7ab8ff" }}
          >
            link
          </a>
        ) : (
          <span style={{ ...pillStyle, ...pillTones.warn }}>geen website</span>
        )}
      </td>
      <td style={tdStyle}>{qualityPill(row.websiteUrl, row.websiteQuality)}</td>
      <td style={tdStyle}>
        {row.rating != null
          ? `${row.rating.toFixed(1)} (${row.reviewsCount ?? 0})`
          : "—"}
      </td>
      <td style={tdStyle}>
        {row.contactCount > 0 ? (
          <span title={`${row.verifiedContactCount} verified, ${row.contactCount - row.verifiedContactCount} unverified`}>
            {row.verifiedContactCount}/{row.contactCount}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td style={tdStyle}>
        {row.activeLeadCount > 0 ? (
          <span style={{ ...pillStyle, ...pillTones.ok }}>
            {row.activeLeadCount}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td style={tdStyle}>
        {!hasContact ? (
          <span style={{ opacity: 0.5, fontSize: "0.8rem" }}>—</span>
        ) : campaigns.length === 0 ? (
          <span style={{ opacity: 0.5, fontSize: "0.8rem" }}>geen campagne</span>
        ) : open ? (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              disabled={pending}
              style={smallSelectStyle}
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onAssign}
              disabled={pending || !campaignId}
              style={smallPrimaryBtnStyle}
            >
              {pending ? "…" : "OK"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              style={smallGhostBtnStyle}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={smallPrimaryBtnStyle}
          >
            + Campagne
          </button>
        )}
      </td>
    </tr>
  );
}

function ResultPill({
  result,
}: {
  result: AssignLeadsResult | BulkEnrichResult;
}) {
  const tone = result.ok ? "ok" : "bad";
  return (
    <span style={{ ...pillStyle, ...pillTones[tone] }}>{result.message}</span>
  );
}

function qualityPill(websiteUrl: string | null, quality: string | null) {
  if (!websiteUrl) {
    return <span style={{ ...pillStyle, ...pillTones.bad }}>geen site</span>;
  }
  if (!quality || quality === "none")
    return <span style={{ opacity: 0.6 }}>—</span>;
  if (quality === "good")
    return <span style={{ ...pillStyle, ...pillTones.ok }}>goed</span>;
  if (quality === "decent")
    return <span style={{ ...pillStyle, ...pillTones.warn }}>decent</span>;
  if (quality === "outdated")
    return <span style={{ ...pillStyle, ...pillTones.bad }}>verouderd</span>;
  return <span style={pillStyle}>{quality}</span>;
}

function FilterBar({ params }: { params: SearchParams }) {
  const hasActive = Boolean(
    params.q || params.niche || params.city || (params.status && params.status !== "any"),
  );
  return (
    <form
      method="get"
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1rem",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <input
        name="q"
        defaultValue={params.q ?? ""}
        placeholder="Zoek (naam, stad, categorie, e-mail, telefoon)"
        style={{ ...inputStyle, minWidth: "320px", flex: "1 1 320px" }}
        autoFocus
      />
      <input
        name="niche"
        defaultValue={params.niche ?? ""}
        placeholder="Niche (exact)"
        style={inputStyle}
      />
      <input
        name="city"
        defaultValue={params.city ?? ""}
        placeholder="Stad (exact)"
        style={inputStyle}
      />
      <select name="status" defaultValue={params.status ?? "any"} style={inputStyle}>
        <option value="any">Alle leads</option>
        <option value="no_website">Zonder website (top-prio)</option>
        <option value="outdated">Verouderde site</option>
        <option value="decent">Decent</option>
        <option value="good">Goed (skip)</option>
      </select>
      <button type="submit" style={btnStyle}>Zoek</button>
      {hasActive ? (
        <Link href="/leads" style={{ color: "#7ab8ff", fontSize: "0.85rem" }}>
          Wis
        </Link>
      ) : null}
    </form>
  );
}

const inputStyle: CSSProperties = {
  padding: "0.5rem 0.75rem",
  background: "#0f1218",
  border: "1px solid #20252e",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.9rem",
};

const btnStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  background: "#1d4ed8",
  borderColor: "#1d4ed8",
};

const tableWrapStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  overflow: "hidden",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #2a3140",
  textAlign: "left",
  fontSize: "0.85rem",
  fontWeight: 600,
  background: "#0f1218",
};

const thCheckStyle: CSSProperties = {
  ...thStyle,
  width: "2.4rem",
  textAlign: "center",
  paddingLeft: "0.5rem",
  paddingRight: "0.5rem",
};

const tdStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #20252e",
  fontSize: "0.9rem",
  verticalAlign: "middle",
};

const tdCheckStyle: CSSProperties = {
  ...tdStyle,
  textAlign: "center",
  paddingLeft: "0.5rem",
  paddingRight: "0.5rem",
};

const selectedRowStyle: CSSProperties = {
  background: "#0e1a2c",
};

const bulkBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  padding: "0.65rem 0.85rem",
  marginBottom: "0.75rem",
  background: "#0e1a2c",
  border: "1px solid #1d3a66",
  borderRadius: "8px",
  flexWrap: "wrap",
  position: "sticky",
  top: "0.5rem",
  zIndex: 10,
};

const warningCardStyle: CSSProperties = {
  padding: "0.65rem 0.85rem",
  marginBottom: "0.75rem",
  background: "#3a2e10",
  border: "1px solid #4a3a16",
  borderRadius: "8px",
  fontSize: "0.85rem",
  color: "#ffcc66",
};

const selectStyle: CSSProperties = {
  padding: "0.4rem 0.6rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.85rem",
};

const smallSelectStyle: CSSProperties = {
  ...selectStyle,
  fontSize: "0.8rem",
  padding: "0.3rem 0.5rem",
};

const primaryBtnStyle: CSSProperties = {
  padding: "0.45rem 0.9rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.85rem",
  fontWeight: 500,
  cursor: "pointer",
};

const smallPrimaryBtnStyle: CSSProperties = {
  ...primaryBtnStyle,
  padding: "0.3rem 0.65rem",
  fontSize: "0.78rem",
};

const ghostBtnStyle: CSSProperties = {
  padding: "0.4rem 0.75rem",
  background: "transparent",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#c9cdd6",
  fontSize: "0.8rem",
  cursor: "pointer",
};

const smallGhostBtnStyle: CSSProperties = {
  ...ghostBtnStyle,
  padding: "0.25rem 0.5rem",
  fontSize: "0.75rem",
};

const pillStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.15rem 0.55rem",
  borderRadius: "999px",
  fontSize: "0.75rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const pillTones: Record<string, CSSProperties> = {
  ok: { background: "#143524", color: "#7be0a6" },
  warn: { background: "#3a2e10", color: "#ffcc66" },
  bad: { background: "#3a1414", color: "#ff8888" },
  neutral: { background: "#1c2129", color: "#c9cdd6" },
};
