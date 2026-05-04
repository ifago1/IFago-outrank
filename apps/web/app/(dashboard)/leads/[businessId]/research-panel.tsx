"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { addManualContact } from "../actions";
import type { ContactActionResult } from "../types";

export interface PlacesSocialUrls {
  facebook?: string;
  instagram?: string;
  generic?: string;
  /** googleMapsUri uit Places — handig voor de 'Bekijk op Google Maps' link. */
  googleMapsUri?: string;
}

/**
 * Sectie speciaal voor websiteloze leads (of leads waar geen contact
 * gevonden kon worden): pre-filled research-zoekopdrachten naar
 * Google/Facebook/KvK/Telefoongids + een handmatige paste-form.
 *
 * Wordt op /leads/<id> getoond zodra er nog geen contacts zijn — voor
 * leads-met-website is enrich genoeg, voor de rest moet je 'm
 * handmatig opzoeken en dit paneel maakt dat een 30-seconden klus.
 */
export function ResearchPanel({
  businessId,
  businessName,
  city,
  phone,
  social,
}: {
  businessId: string;
  businessName: string;
  city: string | null;
  phone: string | null;
  social: PlacesSocialUrls;
}) {
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Geen contact? Zoek &lsquo;m zo</h2>
      <p style={descStyle}>
        Voor websiteloze leads vindt enrich niets. Maar veel lokale
        bedrijven zijn vindbaar via socials of branche-directories. De
        knoppen openen pre-filled zoekopdrachten in een nieuw tabblad —
        daarna voeg je het gevonden e-mailadres met de form hieronder toe.
      </p>

      {phone || social.generic || social.facebook || social.instagram ? (
        <div style={chipsRowStyle}>
          {phone ? (
            <CopyChip
              label="Telefoon"
              value={phone}
              href={`tel:${phone.replace(/\s+/g, "")}`}
            />
          ) : null}
          {social.facebook ? (
            <ExternalChip label="Facebook-pagina" href={social.facebook} tone="primary" />
          ) : null}
          {social.instagram ? (
            <ExternalChip label="Instagram" href={social.instagram} tone="primary" />
          ) : null}
          {social.generic ? (
            <ExternalChip
              label="Plek-link (uit Places)"
              href={social.generic}
              tone="primary"
            />
          ) : null}
          {social.googleMapsUri ? (
            <ExternalChip
              label="Google Maps profiel"
              href={social.googleMapsUri}
            />
          ) : null}
        </div>
      ) : null}

      <div style={chipsRowStyle}>
        <ExternalChip
          label="Google: bedrijfsnaam + email"
          href={googleSearchUrl(`"${businessName}" ${city ?? ""} email`)}
        />
        <ExternalChip
          label="Google: contact"
          href={googleSearchUrl(`"${businessName}" ${city ?? ""} contact`)}
        />
        <ExternalChip
          label="Facebook search"
          href={facebookSearchUrl(`${businessName} ${city ?? ""}`)}
        />
        <ExternalChip
          label="Instagram search"
          href={instagramSearchUrl(businessName)}
        />
        <ExternalChip
          label="KvK Handelsregister"
          href={kvkSearchUrl(businessName, city)}
        />
        <ExternalChip
          label="Telefoonboek.nl"
          href={telefoonboekSearchUrl(businessName, city)}
        />
        <ExternalChip
          label="LinkedIn search"
          href={linkedinSearchUrl(`${businessName} ${city ?? ""}`)}
        />
      </div>

      <ManualContactForm businessId={businessId} />
    </section>
  );
}

function ManualContactForm({ businessId }: { businessId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ContactActionResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const r = await addManualContact(businessId, data);
      setResult(r);
      if (r.ok) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} style={formStyle}>
      <h3 style={h3Style}>+ Handmatig contact toevoegen</h3>
      <div style={fieldsRowStyle}>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Email *</span>
          <input
            name="email"
            type="email"
            required
            placeholder="info@bedrijf.nl"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Voornaam (optioneel)</span>
          <input name="firstName" type="text" placeholder="Piet" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Achternaam (optioneel)</span>
          <input name="lastName" type="text" placeholder="Jansen" style={inputStyle} />
        </label>
      </div>
      <label style={checkboxLabelStyle}>
        <input type="checkbox" name="isVerified" />
        <span style={{ fontSize: "0.85rem" }}>
          Markeer als verified (alleen aanvinken als je MX-status hebt
          gecheckt of het adres uit een betrouwbare bron komt)
        </span>
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        <button type="submit" disabled={pending} style={primaryBtnStyle}>
          {pending ? "Toevoegen…" : "Contact toevoegen"}
        </button>
        {result ? (
          <span
            style={{
              ...pillStyle,
              ...(result.ok ? toneOk : toneBad),
            }}
          >
            {result.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function ExternalChip({
  label,
  href,
  tone = "ghost",
}: {
  label: string;
  href: string;
  tone?: "ghost" | "primary";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={tone === "primary" ? chipPrimaryStyle : chipStyle}
    >
      {label} ↗
    </a>
  );
}

function CopyChip({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  function copy() {
    void navigator.clipboard.writeText(value);
  }
  return (
    <span style={copyChipStyle}>
      <a href={href} style={{ color: "#7be0a6", textDecoration: "none" }}>
        {label}: {value}
      </a>
      <button
        type="button"
        onClick={copy}
        title="Kopieer naar klembord"
        style={copyBtnStyle}
      >
        kopieer
      </button>
    </span>
  );
}

function googleSearchUrl(q: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
function facebookSearchUrl(q: string): string {
  return `https://www.facebook.com/search/pages/?q=${encodeURIComponent(q)}`;
}
function instagramSearchUrl(q: string): string {
  // Instagram heeft geen public search URL; Google site-search is nuttiger.
  return `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com "${q}"`)}`;
}
function kvkSearchUrl(name: string, city: string | null): string {
  const q = city ? `${name} ${city}` : name;
  return `https://www.kvk.nl/zoeken/?source=all&q=${encodeURIComponent(q)}`;
}
function telefoonboekSearchUrl(name: string, city: string | null): string {
  const q = city ? `${name}/${city}` : name;
  return `https://www.telefoonboek.nl/zoeken/${encodeURIComponent(q)}/`;
}
function linkedinSearchUrl(q: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(q)}`;
}

const sectionStyle: CSSProperties = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "#0f1218",
};

const h2Style: CSSProperties = { fontSize: "1.05rem", margin: "0 0 0.4rem 0" };
const h3Style: CSSProperties = { fontSize: "0.95rem", margin: "0 0 0.5rem 0" };

const descStyle: CSSProperties = {
  margin: "0 0 0.75rem 0",
  fontSize: "0.85rem",
  opacity: 0.7,
  lineHeight: 1.5,
};

const chipsRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.4rem",
  marginBottom: "0.75rem",
};

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.35rem 0.7rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  fontSize: "0.78rem",
  color: "#c9cdd6",
  textDecoration: "none",
  cursor: "pointer",
};

const chipPrimaryStyle: CSSProperties = {
  ...chipStyle,
  background: "#102a4a",
  borderColor: "#1d3a66",
  color: "#7ab8ff",
  fontWeight: 500,
};

const copyChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.35rem 0.7rem",
  background: "#0a2418",
  border: "1px solid #143524",
  borderRadius: "6px",
  fontSize: "0.78rem",
};

const copyBtnStyle: CSSProperties = {
  padding: "0.15rem 0.45rem",
  background: "transparent",
  border: "1px solid #2a3140",
  borderRadius: "4px",
  color: "#c9cdd6",
  fontSize: "0.7rem",
  cursor: "pointer",
};

const formStyle: CSSProperties = {
  marginTop: "0.75rem",
  paddingTop: "0.75rem",
  borderTop: "1px solid #20252e",
};

const fieldsRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "0.5rem",
  marginBottom: "0.5rem",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};

const labelTextStyle: CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 500,
  opacity: 0.85,
};

const inputStyle: CSSProperties = {
  padding: "0.4rem 0.6rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.85rem",
};

const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.5rem",
  marginTop: "0.4rem",
};

const primaryBtnStyle: CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.85rem",
  fontWeight: 500,
  cursor: "pointer",
};

const pillStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.3rem 0.7rem",
  borderRadius: "999px",
  fontSize: "0.75rem",
};

const toneOk: CSSProperties = { background: "#143524", color: "#7be0a6" };
const toneBad: CSSProperties = { background: "#3a1414", color: "#ff8888" };
