"use client";

import { useEffect, useState } from "react";

const REASONABLE_START_HOUR = 9;
const REASONABLE_END_HOUR = 17;
const LUNCH_START_HOUR = 12;
const LUNCH_END_HOUR = 13;

/**
 * Soft-warning bovenaan /phone als je buiten kantooruren belt.
 * Geen blokkering — je mag prima oude voicemail-doorlopen na 18u
 * doen. Just nudges.
 *
 * Client-side zodat de check refresht zonder server-call én reageert
 * op de lokale tijd van de gebruiker (handig als de browser in een
 * andere TZ staat dan de server).
 */
export function QuietHoursBanner() {
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    function check() {
      const now = new Date();
      const day = now.getDay();
      const hour = now.getHours();
      if (day === 0 || day === 6) {
        setReason("Weekend — eigenaren nemen meestal niet op.");
        return;
      }
      if (hour < REASONABLE_START_HOUR) {
        setReason(
          `Vroeg op de dag (voor ${REASONABLE_START_HOUR}u) — kantoren zijn vaak nog niet bemand.`,
        );
        return;
      }
      if (hour >= REASONABLE_END_HOUR) {
        setReason(
          `Na ${REASONABLE_END_HOUR}u — kans op opgenomen worden daalt snel.`,
        );
        return;
      }
      if (hour >= LUNCH_START_HOUR && hour < LUNCH_END_HOUR) {
        setReason(
          `Lunchpauze (${LUNCH_START_HOUR}–${LUNCH_END_HOUR}u) — veel zaken nemen niet op.`,
        );
        return;
      }
      setReason(null);
    }
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!reason) return null;

  return (
    <div
      style={{
        background: "#3a2a14",
        border: "1px solid #5a3f1c",
        color: "#ffcc66",
        padding: "0.6rem 0.9rem",
        borderRadius: "6px",
        fontSize: "0.85rem",
        marginBottom: "0.8rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      <span aria-hidden="true">⏰</span>
      <span>{reason}</span>
    </div>
  );
}
