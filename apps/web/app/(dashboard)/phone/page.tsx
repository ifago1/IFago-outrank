import { and, eq, gte, gt, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { businesses, getDb, getSetting } from "@outreach/db";
import { heatScore } from "@outreach/sequencer";
import { PageHeader } from "../_ui";
import { PhoneRow } from "./phone-row";
import { QuietHoursBanner } from "./quiet-hours-banner";
import { DayStats } from "./day-stats";
import type { PhoneLeadRow, PhoneStatus } from "./types";

export const dynamic = "force-dynamic";

type Bucket = "open" | "scheduled" | "warm" | "exhausted" | "done" | "all";

interface SearchParams {
  niche?: string;
  city?: string;
  bucket?: Bucket;
}

const DEFAULT_VOICEMAIL_MAX = 3;

/**
 * Bellen-tab buckets:
 *   open       → nooit gebeld OF cadence-due (voicemail/callback/called
 *                met next_attempt_at <= now). Geen DNC-signalen.
 *   scheduled  → cadence-future (next_attempt_at > now). Read-only,
 *                wachtend op de juiste datum.
 *   warm       → interested. Volgende stap: contact via mail-warm-
 *                followup of bellen.
 *   done       → not_interested / wrong_number.
 *   all        → alles met telefoon.
 */
export default async function PhonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const bucket: Bucket = params.bucket ?? "open";
  const db = getDb();
  const now = new Date();

  // Voicemail-uitputting: na N voicemails geldt 'ie als 'exhausted'
  // (uit de Open-cadence, naar aparte bucket). Setting in /settings,
  // default 3.
  const vmMaxStr = await getSetting(db, "PHONE_VOICEMAIL_MAX_ATTEMPTS");
  const vmMax = parsePositiveInt(vmMaxStr, DEFAULT_VOICEMAIL_MAX);

  const where: SQL[] = [];
  if (bucket !== "done" && bucket !== "exhausted") {
    where.push(isNotNull(businesses.phone));
  }

  if (bucket === "open") {
    // Nooit gebeld OF cadence-due, MAAR niet uitgeput
    where.push(
      or(
        isNull(businesses.phoneStatus),
        and(
          sql`${businesses.phoneStatus} IN ('voicemail','callback','called')`,
          lte(businesses.phoneNextAttemptAt, now),
        ),
      )!,
    );
    where.push(
      sql`NOT (${businesses.phoneStatus} = 'voicemail' AND ${businesses.phoneAttempts} >= ${vmMax})`,
    );
    where.push(sql`NOT EXISTS (
      SELECT 1 FROM contacts cc
      WHERE cc.business_id = businesses.id AND cc.do_not_contact = true
    )`);
    where.push(sql`NOT EXISTS (
      SELECT 1 FROM unsubscribes u
      JOIN contacts cc2 ON LOWER(cc2.email) = LOWER(u.email)
      WHERE cc2.business_id = businesses.id
    )`);
  } else if (bucket === "scheduled") {
    where.push(
      sql`${businesses.phoneStatus} IN ('voicemail','callback','called')`,
    );
    where.push(gt(businesses.phoneNextAttemptAt, now));
    where.push(
      sql`NOT (${businesses.phoneStatus} = 'voicemail' AND ${businesses.phoneAttempts} >= ${vmMax})`,
    );
  } else if (bucket === "warm") {
    where.push(eq(businesses.phoneStatus, "interested"));
  } else if (bucket === "exhausted") {
    where.push(isNotNull(businesses.phone));
    where.push(eq(businesses.phoneStatus, "voicemail"));
    where.push(gte(businesses.phoneAttempts, vmMax));
  } else if (bucket === "done") {
    where.push(sql`${businesses.phoneStatus} IN ('not_interested', 'wrong_number')`);
  }

  if (params.niche) where.push(eq(businesses.category, params.niche));
  if (params.city) where.push(eq(businesses.city, params.city));

  const rawRows = await db
    .select({
      businessId: businesses.id,
      name: businesses.name,
      city: businesses.city,
      category: businesses.category,
      phone: businesses.phone,
      websiteUrl: businesses.websiteUrl,
      websiteQuality: businesses.websiteQuality,
      rating: businesses.googleRating,
      reviewsCount: businesses.reviewsCount,
      phoneStatus: businesses.phoneStatus,
      phoneCalledAt: businesses.phoneCalledAt,
      phoneNotes: businesses.phoneNotes,
      phoneNextAttemptAt: businesses.phoneNextAttemptAt,
      phoneAttempts: businesses.phoneAttempts,
    })
    .from(businesses)
    .where(where.length ? sql.join(where, sql` AND `) : sql`true`)
    .orderBy(
      bucket === "scheduled"
        ? sql`${businesses.phoneNextAttemptAt} ASC NULLS LAST`
        : sql`${businesses.phoneCalledAt} DESC NULLS LAST`,
      sql`${businesses.googleRating} DESC NULLS LAST`,
    )
    .limit(300);

  // Heat-score per row + sortering. Op de Open-tab winnen warm leads
  // bovenaan; op andere tabs gaat de DB-order voor.
  const leadRows: PhoneLeadRow[] = rawRows.map((r) => ({
    businessId: r.businessId,
    name: r.name,
    city: r.city,
    category: r.category,
    phone: r.phone,
    websiteUrl: r.websiteUrl,
    websiteQuality: r.websiteQuality,
    rating: r.rating != null ? Number(r.rating) : null,
    reviewsCount: r.reviewsCount,
    phoneStatus: (r.phoneStatus ?? null) as PhoneStatus | null,
    phoneCalledAt: toIso(r.phoneCalledAt),
    phoneNotes: r.phoneNotes,
    phoneNextAttemptAt: toIso(r.phoneNextAttemptAt),
    phoneAttempts: r.phoneAttempts ?? 0,
    heat: heatScore(
      {
        phoneStatus: r.phoneStatus,
        phoneNextAttemptAt: r.phoneNextAttemptAt as unknown as Date | null,
        websiteUrl: r.websiteUrl,
        websiteQuality: r.websiteQuality,
        rating: r.rating != null ? Number(r.rating) : null,
        reviewsCount: r.reviewsCount,
        lastInteractionAt: r.phoneCalledAt as unknown as Date | null,
      },
      now,
    ),
  }));

  // Open/warm primair op heat. Andere buckets primair op de DB-order.
  if (bucket === "open" || bucket === "warm") {
    leadRows.sort((a, b) => b.heat - a.heat);
  }

  // Limit naar 200 in de UI om de tabel hanteerbaar te houden
  const visible = leadRows.slice(0, 200);

  const counts = await getBucketCounts(db, now, vmMax);
  const dayStats = await getTodayStats(db, now);

  return (
    <>
      <PageHeader
        title="Bellen"
        subtitle={subtitleFor(bucket, visible.length)}
      />

      <QuietHoursBanner />
      <DayStats stats={dayStats} />
      <BucketTabs current={bucket} counts={counts} />
      <FilterBar params={params} bucket={bucket} />

      {visible.length === 0 ? (
        <p style={{ opacity: 0.6 }}>{emptyMessageFor(bucket)}</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Heat</th>
                <th style={thStyle}>Business</th>
                <th style={thStyle}>Stad</th>
                <th style={thStyle}>Categorie</th>
                <th style={thStyle}>Telefoon</th>
                <th style={thStyle}>Website</th>
                <th style={thStyle}>Kwaliteit</th>
                <th style={thStyle}>Rating</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actie</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <PhoneRow key={r.businessId} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return v as string;
}

async function getBucketCounts(
  db: ReturnType<typeof getDb>,
  now: Date,
  vmMax: number,
): Promise<Record<Bucket, number>> {
  const nowIso = now.toISOString();
  const rows = await db
    .select({
      open: sql<number>`(SELECT count(*)::int FROM businesses b
        WHERE b.phone IS NOT NULL
          AND (
            b.phone_status IS NULL
            OR (b.phone_status IN ('voicemail','callback','called')
                AND b.phone_next_attempt_at <= ${nowIso}::timestamptz)
          )
          AND NOT (b.phone_status = 'voicemail' AND b.phone_attempts >= ${vmMax})
          AND NOT EXISTS (
            SELECT 1 FROM contacts cc
            WHERE cc.business_id = b.id AND cc.do_not_contact = true
          )
          AND NOT EXISTS (
            SELECT 1 FROM unsubscribes u
            JOIN contacts cc2 ON LOWER(cc2.email) = LOWER(u.email)
            WHERE cc2.business_id = b.id
          ))`,
      scheduled: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone IS NOT NULL
          AND phone_status IN ('voicemail','callback','called')
          AND phone_next_attempt_at > ${nowIso}::timestamptz
          AND NOT (phone_status = 'voicemail' AND phone_attempts >= ${vmMax}))`,
      warm: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_status = 'interested')`,
      exhausted: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_status = 'voicemail' AND phone_attempts >= ${vmMax})`,
      done: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_status IN ('not_interested','wrong_number'))`,
    })
    .from(sql`(SELECT 1) _t`);
  const r = rows[0]!;
  return {
    open: r.open,
    scheduled: r.scheduled,
    warm: r.warm,
    exhausted: r.exhausted,
    done: r.done,
    all: r.open + r.scheduled + r.warm + r.exhausted + r.done,
  };
}

export interface PhoneDayStats {
  calls: number;
  voicemails: number;
  interested: number;
  notInterested: number;
  mailsScheduled: number;
}

/**
 * Wat heb je vandaag gedaan? Telt op basis van phone_called_at +
 * lead_events.auto_assigned. Gebruikt in de DayStats-widget.
 */
async function getTodayStats(
  db: ReturnType<typeof getDb>,
  now: Date,
): Promise<PhoneDayStats> {
  // Begin-van-de-dag in Amsterdam-tijd. We doen 't pragmatisch: lokaal
  // 00:00 in Europe/Amsterdam, dan naar ISO. Voor één gebruiker met
  // één tijdzone goed genoeg.
  const localMidnight = new Date(now);
  localMidnight.setHours(0, 0, 0, 0);
  const sinceIso = localMidnight.toISOString();
  const rows = await db
    .select({
      calls: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_called_at >= ${sinceIso}::timestamptz)`,
      voicemails: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_called_at >= ${sinceIso}::timestamptz
          AND phone_status = 'voicemail')`,
      interested: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_called_at >= ${sinceIso}::timestamptz
          AND phone_status = 'interested')`,
      notInterested: sql<number>`(SELECT count(*)::int FROM businesses
        WHERE phone_called_at >= ${sinceIso}::timestamptz
          AND phone_status IN ('not_interested','wrong_number'))`,
      mailsScheduled: sql<number>`(SELECT count(*)::int FROM lead_events
        WHERE type = 'auto_assigned'
          AND occurred_at >= ${sinceIso}::timestamptz)`,
    })
    .from(sql`(SELECT 1) _t`);
  return rows[0] ?? {
    calls: 0,
    voicemails: 0,
    interested: 0,
    notInterested: 0,
    mailsScheduled: 0,
  };
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function subtitleFor(bucket: Bucket, n: number): string {
  if (bucket === "open")
    return `${n} leads klaar om nu te bellen — gesorteerd op heat (warmste eerst).`;
  if (bucket === "scheduled")
    return `${n} leads ingepland voor later. Verschijnen automatisch in Open op de juiste datum.`;
  if (bucket === "warm")
    return `${n} warme leads — interesse getoond. Tijd om af te sluiten.`;
  if (bucket === "exhausted")
    return `${n} uitgeputte voicemails — N keer geprobeerd zonder respons. Read-only.`;
  if (bucket === "done") return `${n} afgehandelde leads. Read-only audit.`;
  return `${n} leads totaal`;
}

function emptyMessageFor(bucket: Bucket): string {
  if (bucket === "open")
    return "Geen leads klaar om te bellen — alles is afgehandeld of ingepland.";
  if (bucket === "scheduled") return "Geen leads ingepland.";
  if (bucket === "warm") return "Geen warme leads (nog). Markeer een gesprek als 'interesse'.";
  if (bucket === "exhausted") return "Niemand opgegeven. Mooi.";
  if (bucket === "done") return "Nog niemand afgehandeld.";
  return "Geen leads gevonden.";
}

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "scheduled", label: "Gepland" },
  { key: "warm", label: "Interesse" },
  { key: "exhausted", label: "Uitgeput" },
  { key: "done", label: "Afgehandeld" },
  { key: "all", label: "Alles" },
];

function BucketTabs({
  current,
  counts,
}: {
  current: Bucket;
  counts: Record<Bucket, number>;
}) {
  return (
    <div style={tabsStyle}>
      {BUCKETS.map((b) => {
        const active = b.key === current;
        return (
          <Link
            key={b.key}
            href={`/phone?bucket=${b.key}`}
            style={{ ...tabStyle, ...(active ? tabActiveStyle : {}) }}
          >
            {b.label}
            <span style={tabCountStyle}>{counts[b.key]}</span>
          </Link>
        );
      })}
    </div>
  );
}

function FilterBar({
  params,
  bucket,
}: {
  params: SearchParams;
  bucket: Bucket;
}) {
  return (
    <form
      method="get"
      action="/phone"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        marginBottom: "1rem",
        alignItems: "center",
      }}
    >
      <input type="hidden" name="bucket" value={bucket} />
      <input
        type="text"
        name="niche"
        placeholder="Categorie"
        defaultValue={params.niche ?? ""}
        style={inputStyle}
      />
      <input
        type="text"
        name="city"
        placeholder="Stad"
        defaultValue={params.city ?? ""}
        style={inputStyle}
      />
      <button type="submit" style={btnStyle}>Filter</button>
      {params.niche || params.city ? (
        <Link href={`/phone?bucket=${bucket}`} style={{ color: "#7ab8ff", fontSize: "0.85rem" }}>
          Wis filter
        </Link>
      ) : null}
    </form>
  );
}

const tableWrapStyle = {
  border: "1px solid #20252e",
  borderRadius: "8px",
  overflow: "auto" as const,
};

const tableStyle = { width: "100%", borderCollapse: "collapse" as const };

const thStyle = {
  padding: "0.65rem 0.75rem",
  borderBottom: "1px solid #2a3140",
  textAlign: "left" as const,
  fontSize: "0.8rem",
  fontWeight: 600 as const,
  background: "#0f1218",
};

const tabsStyle = {
  display: "flex",
  gap: "0.35rem",
  marginBottom: "1rem",
  borderBottom: "1px solid #20252e",
  paddingBottom: "0.5rem",
  flexWrap: "wrap" as const,
};

const tabStyle = {
  padding: "0.45rem 0.85rem",
  borderRadius: "6px",
  color: "#c9cdd6",
  textDecoration: "none",
  fontSize: "0.85rem",
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  border: "1px solid transparent",
};

const tabActiveStyle = {
  background: "#1d4ed8",
  color: "white",
};

const tabCountStyle = {
  background: "rgba(255,255,255,0.15)",
  padding: "0.05rem 0.4rem",
  borderRadius: "999px",
  fontSize: "0.7rem",
  fontWeight: 600 as const,
};

const inputStyle = {
  padding: "0.45rem 0.65rem",
  background: "#0a0c11",
  border: "1px solid #2a3140",
  borderRadius: "6px",
  color: "#e6e8ee",
  fontSize: "0.85rem",
};

const btnStyle = {
  padding: "0.45rem 0.85rem",
  background: "#1d4ed8",
  border: "none",
  borderRadius: "6px",
  color: "white",
  fontSize: "0.85rem",
  fontWeight: 500,
  cursor: "pointer",
};
