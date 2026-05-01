export default function HomePage() {
  return (
    <main style={{ padding: "3rem", maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Outreach Tool
      </h1>
      <p style={{ opacity: 0.75, marginTop: 0 }}>
        Fase 1 (MVP) — CLI-first. Het dashboard volgt in fase 3.
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Snelstart</h2>
        <ol style={{ lineHeight: 1.7 }}>
          <li>
            <code>docker compose up -d</code>
          </li>
          <li>
            <code>pnpm db:migrate</code>
          </li>
          <li>
            <code>
              pnpm discover --niche=&quot;kapper&quot; --city=&quot;Utrecht&quot;
            </code>
          </li>
        </ol>
      </section>
    </main>
  );
}
