import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/leads", label: "Leads" },
  { href: "/discover", label: "Discover" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/inbox", label: "Inbox" },
  { href: "/stats", label: "Stats" },
  { href: "/settings", label: "Settings" },
] as const;

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", minHeight: "100vh" }}>
      <aside
        style={{
          background: "#0f1218",
          borderRight: "1px solid #20252e",
          padding: "1.5rem 1rem",
        }}
      >
        <Link
          href="/"
          style={{
            display: "block",
            color: "#e6e8ee",
            textDecoration: "none",
            fontWeight: 600,
            marginBottom: "1.5rem",
          }}
        >
          Outreach Tool
        </Link>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                color: "#c9cdd6",
                textDecoration: "none",
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                fontSize: "0.95rem",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main style={{ padding: "2rem 2.5rem" }}>{children}</main>
    </div>
  );
}
