"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties } from "react";
import { deleteContact, setContactDnc } from "../actions";
import type { ContactActionResult } from "../types";

export interface ContactView {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  source: string | null;
  isVerified: boolean;
  doNotContact: boolean;
  createdAt: string;
}

export interface CampaignMembership {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  contactId: string;
  contactEmail: string;
  status: string;
  currentStep: number;
  nextSendAt: string | null;
  sentCount: number;
}

export function LeadDetailClient({
  businessId,
  contacts,
  memberships,
}: {
  businessId: string;
  contacts: ContactView[];
  memberships: CampaignMembership[];
}) {
  return (
    <>
      <ContactsSection contacts={contacts} />
      <MembershipsSection memberships={memberships} />
      <p style={{ fontSize: "0.8rem", opacity: 0.55 }}>
        Wil je deze business aan een (extra) campagne toevoegen? Ga terug naar{" "}
        <Link href={`/leads?bid=${businessId}`} style={{ color: "#7ab8ff" }}>
          de leads-tab
        </Link>{" "}
        en gebruik de + Campagne-knop of de bulk-actiebalk.
      </p>
    </>
  );
}

function ContactsSection({ contacts }: { contacts: ContactView[] }) {
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>
        Gevonden contacts ({contacts.length})
      </h2>
      {contacts.length === 0 ? (
        <p style={{ opacity: 0.6, margin: 0, fontSize: "0.9rem" }}>
          Nog geen contacts. Run{" "}
          <code style={codeStyle}>pnpm enrich</code> om e-mails te zoeken
          voor deze business — eventueel met{" "}
          <code style={codeStyle}>--business-id={"<uuid>"}</code> voor
          alleen deze.
        </p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Naam</th>
                <th style={thStyle}>Bron</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Gevonden</th>
                <th style={thStyle}>Acties</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <ContactRow key={c.id} contact={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContactRow({ contact }: { contact: ContactView }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ContactActionResult | null>(null);
  // Optimistically reflect DNC flips so the row disables instantly even
  // before revalidatePath round-trips.
  const [optimisticDnc, setOptimisticDnc] = useState(contact.doNotContact);

  function onToggleDnc() {
    const next = !optimisticDnc;
    setOptimisticDnc(next);
    startTransition(async () => {
      const r = await setContactDnc(contact.id, next);
      setResult(r);
      if (!r.ok) setOptimisticDnc(!next); // rollback
    });
  }

  function onDelete() {
    if (
      !confirm(
        `Definitief verwijderen: ${contact.email}? campaign_leads die hiernaar verwijzen worden mee gewist.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await deleteContact(contact.id);
      setResult(r);
    });
  }

  const fullName = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <tr style={optimisticDnc ? dncRowStyle : undefined}>
      <td style={tdStyle}>
        <code style={emailStyle}>{contact.email}</code>
        {result ? (
          <div style={{ marginTop: "0.3rem" }}>
            <span
              style={{
                ...pillStyle,
                ...(result.ok ? toneOk : toneBad),
                fontSize: "0.7rem",
              }}
            >
              {result.message}
            </span>
          </div>
        ) : null}
      </td>
      <td style={tdStyle}>{fullName || <span style={{ opacity: 0.5 }}>—</span>}</td>
      <td style={tdStyle}>
        {contact.source ?? <span style={{ opacity: 0.5 }}>—</span>}
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
          {contact.isVerified ? (
            <span style={{ ...pillStyle, ...toneOk }}>verified</span>
          ) : (
            <span style={{ ...pillStyle, ...toneNeutral }}>unverified</span>
          )}
          {optimisticDnc ? (
            <span style={{ ...pillStyle, ...toneBad }}>DNC</span>
          ) : null}
        </div>
      </td>
      <td style={tdStyle}>
        {new Date(contact.createdAt).toLocaleDateString("nl-NL")}
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onToggleDnc}
            disabled={pending}
            style={optimisticDnc ? smallPrimaryBtnStyle : smallGhostBtnStyle}
            title={
              optimisticDnc
                ? "Herstel — contact mag weer benaderd worden"
                : "Markeer als Do Not Contact"
            }
          >
            {pending ? "…" : optimisticDnc ? "Herstel" : "Op DNC"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            style={smallDangerBtnStyle}
            title="Verwijder contact + alle bijbehorende campaign_leads"
          >
            Wis
          </button>
        </div>
      </td>
    </tr>
  );
}

function MembershipsSection({
  memberships,
}: {
  memberships: CampaignMembership[];
}) {
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>
        Campagne-deelnames ({memberships.length})
      </h2>
      {memberships.length === 0 ? (
        <p style={{ opacity: 0.6, margin: 0, fontSize: "0.9rem" }}>
          Nog niet aan een campagne toegewezen.
        </p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Campagne</th>
                <th style={thStyle}>Contact</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Step</th>
                <th style={thStyle}>Verzonden</th>
                <th style={thStyle}>Volgende send</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m, i) => (
                <tr key={`${m.campaignId}-${m.contactId}-${i}`}>
                  <td style={tdStyle}>
                    <Link
                      href={`/campaigns/${m.campaignId}`}
                      style={{ color: "#7ab8ff" }}
                    >
                      {m.campaignName}
                    </Link>
                    <span
                      style={{
                        ...pillStyle,
                        ...toneNeutral,
                        marginLeft: "0.5rem",
                        fontSize: "0.7rem",
                      }}
                    >
                      {m.campaignStatus}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <code style={emailStyle}>{m.contactEmail}</code>
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        ...pillStyle,
                        ...statusTone(m.status),
                      }}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td style={tdStyle}>{m.currentStep}</td>
                  <td style={tdStyle}>{m.sentCount}</td>
                  <td style={tdStyle}>
                    {m.nextSendAt
                      ? new Date(m.nextSendAt).toLocaleString("nl-NL")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function statusTone(status: string): CSSProperties {
  if (status === "replied") return toneOk;
  if (status === "bounced" || status === "unsubscribed") return toneBad;
  if (status === "queued" || status === "sent") return toneWarn;
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
  margin: "0 0 0.75rem 0",
};

const tableWrapStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "6px",
  overflow: "hidden",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #2a3140",
  textAlign: "left",
  fontSize: "0.8rem",
  fontWeight: 600,
  background: "#0a0c11",
};

const tdStyle: CSSProperties = {
  padding: "0.55rem 0.75rem",
  borderBottom: "1px solid #20252e",
  fontSize: "0.85rem",
  verticalAlign: "middle",
};

const dncRowStyle: CSSProperties = {
  opacity: 0.55,
};

const emailStyle: CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.85rem",
};

const codeStyle: CSSProperties = {
  background: "#1c2129",
  padding: "0.1rem 0.4rem",
  borderRadius: "4px",
  fontSize: "0.78rem",
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
const toneBad: CSSProperties = { background: "#3a1414", color: "#ff8888" };
const toneWarn: CSSProperties = { background: "#3a2e10", color: "#ffcc66" };
const toneNeutral: CSSProperties = { background: "#1c2129", color: "#c9cdd6" };

const smallGhostBtnStyle: CSSProperties = {
  padding: "0.3rem 0.65rem",
  background: "transparent",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#c9cdd6",
  fontSize: "0.78rem",
  cursor: "pointer",
};

const smallPrimaryBtnStyle: CSSProperties = {
  padding: "0.3rem 0.65rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.78rem",
  cursor: "pointer",
};

const smallDangerBtnStyle: CSSProperties = {
  padding: "0.3rem 0.65rem",
  background: "transparent",
  border: "1px solid #3a1414",
  borderRadius: "6px",
  color: "#ff8888",
  fontSize: "0.78rem",
  cursor: "pointer",
};
