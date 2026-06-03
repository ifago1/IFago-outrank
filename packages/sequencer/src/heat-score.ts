/**
 * Lead-warmte score 0-100. Pure functie zodat UI 'm per-request kan
 * berekenen zonder DB-kolom te onderhouden. Hoger = warmer = eerst
 * benaderen.
 *
 * Drijvers + gewichten (kleine bedragen, optellend tot een nuttig
 * sorteringssignaal — niet bedoeld als wetenschappelijke voorspelling):
 *
 *   phoneStatus 'interested'          → +35
 *   phoneStatus 'callback' (nu of <3d) → +25
 *   phoneStatus 'voicemail' recent    → +10
 *   phoneStatus 'called' (gesproken)  → +5
 *   phoneStatus 'not_interested'/'wrong_number' → -1000 (forceert
 *                                       koud onderaan)
 *
 *   websiteQuality 'outdated' of geen site → +15 (slechte site =
 *                                       hoge pitch-kans)
 *   websiteQuality 'decent'           → +5
 *   websiteQuality 'good'             → -5
 *
 *   rating ≥ 4.5 én reviewsCount ≥ 20 → +10 (reputabel — meer waarde
 *                                       om binnen te halen)
 *   rating < 3.5                     → -5
 *
 *   lastInteractionAt < 3 dagen      → +5
 *   lastInteractionAt < 7 dagen      → +3
 *
 * Base = 50. Geclipt naar [0, 100], maar de "koude" forcering blijft
 * onderaan want -1000 zorgt voor 0 na clip.
 */

export interface HeatInput {
  phoneStatus?: string | null;
  /** Bij callback: de geplande callback-datum. */
  phoneNextAttemptAt?: Date | string | null;
  websiteUrl?: string | null;
  websiteQuality?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
  /** Tijdstip van de laatste relevante interactie (mail-send, telefoon, audit). */
  lastInteractionAt?: Date | string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function heatScore(input: HeatInput, now: Date = new Date()): number {
  let score = 50;

  switch (input.phoneStatus) {
    case "interested":
      score += 35;
      break;
    case "callback": {
      const at = parseDate(input.phoneNextAttemptAt);
      if (at) {
        const days = (at.getTime() - now.getTime()) / DAY_MS;
        if (days <= 0) score += 30; // overdue
        else if (days <= 3) score += 25;
        else score += 10;
      } else {
        score += 15;
      }
      break;
    }
    case "voicemail": {
      const at = parseDate(input.phoneNextAttemptAt);
      if (at && (now.getTime() - at.getTime()) / DAY_MS <= 7) score += 10;
      else score += 5;
      break;
    }
    case "called":
      score += 5;
      break;
    case "not_interested":
    case "wrong_number":
      return 0;
    default:
      break;
  }

  // Onderscheid null (geen site bekend → bump) versus undefined
  // (signaal ontbreekt — geen invloed). Drizzle geeft null voor lege
  // SQL-kolommen, dus dit klopt vanuit de DB.
  if (input.websiteUrl === null) {
    score += 15;
  } else if (input.websiteUrl) {
    if (input.websiteQuality === "outdated") score += 15;
    else if (input.websiteQuality === "decent") score += 5;
    else if (input.websiteQuality === "good") score -= 5;
  }

  if (
    typeof input.rating === "number" &&
    input.rating >= 4.5 &&
    typeof input.reviewsCount === "number" &&
    input.reviewsCount >= 20
  ) {
    score += 10;
  } else if (typeof input.rating === "number" && input.rating < 3.5) {
    score -= 5;
  }

  const last = parseDate(input.lastInteractionAt);
  if (last) {
    const days = (now.getTime() - last.getTime()) / DAY_MS;
    if (days < 3) score += 5;
    else if (days < 7) score += 3;
  }

  return Math.max(0, Math.min(100, score));
}

function parseDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
