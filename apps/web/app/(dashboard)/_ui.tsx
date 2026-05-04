import type { CSSProperties, ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: "1.5rem",
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{title}</h1>
        {subtitle ? (
          <p style={{ margin: "0.25rem 0 0", opacity: 0.65, fontSize: "0.9rem" }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </header>
  );
}

const cellStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #20252e",
  textAlign: "left",
  fontSize: "0.9rem",
};

const headerCellStyle: CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  background: "#0f1218",
  position: "sticky",
  top: 0,
  borderBottom: "1px solid #2a3140",
};

export function Table({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ opacity: 0.6 }}>{empty ?? "Niets te zien hier."}</p>
    );
  }
  return (
    <div
      style={{
        border: "1px solid #20252e",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} style={headerCellStyle}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={cellStyle}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #20252e",
        borderRadius: "8px",
        padding: "1rem 1.25rem",
        background: "#0f1218",
      }}
    >
      <div style={{ fontSize: "0.8rem", opacity: 0.65, marginBottom: "0.4rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.6rem", fontWeight: 600 }}>{value}</div>
      {sub ? (
        <div style={{ fontSize: "0.8rem", opacity: 0.6, marginTop: "0.25rem" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const colors: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: "#1c2129", fg: "#c9cdd6" },
    ok: { bg: "#143524", fg: "#7be0a6" },
    warn: { bg: "#3a2e10", fg: "#ffcc66" },
    bad: { bg: "#3a1414", fg: "#ff8888" },
  };
  const c = colors[tone] ?? colors["neutral"]!;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: "0.15rem 0.55rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
