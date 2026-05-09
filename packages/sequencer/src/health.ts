/**
 * Linear domain warmup. New sending domains that suddenly go from 0 →
 * 50/day get filtered as spam; ramping up over a few weeks builds
 * sender reputation. Implementation: floor on day 0, linearly interpolate
 * to fullLimit by day `warmupDays`.
 */
export interface WarmupOptions {
  /** Earliest emails_sent.sent_at; null when no sends yet. */
  firstSentAt: Date | null;
  now: Date;
  /** The configured maximum (DAILY_SEND_LIMIT). */
  fullLimit: number;
  /** Default 14 days from first send to full throttle. */
  warmupDays?: number;
  /** Day-zero limit. Default 5. */
  floor?: number;
}

export function effectiveDailyLimit(opts: WarmupOptions): number {
  const warmupDays = opts.warmupDays ?? 14;
  const floor = Math.min(opts.floor ?? 5, opts.fullLimit);

  if (!opts.firstSentAt) return floor;

  const ms = opts.now.getTime() - opts.firstSentAt.getTime();
  const daysSince = ms / (24 * 60 * 60 * 1000);
  if (daysSince >= warmupDays) return opts.fullLimit;
  if (daysSince <= 0) return floor;

  const t = daysSince / warmupDays;
  return Math.round(floor + (opts.fullLimit - floor) * t);
}

/**
 * Smart adjustment of the linear warmup ramp based on recent inbox
 * health. Inputs:
 *   - linearLimit  → today's value from `effectiveDailyLimit`
 *   - bounceRate   → recent bounce rate (0-1)
 *   - replyRate    → recent reply rate (0-1)
 *
 * Output is clamped to [floor, fullLimit]. Pure — same inputs always
 * give the same number, so behavior is auditable.
 *
 * Multipliers (compounding):
 *   bounce > 5%       →  ×0.5  (cool off — likely bad list)
 *   bounce > 3%       →  ×0.75 (slow down)
 *   reply  > 5%       →  ×1.25 (warmup is going great — accelerate)
 *
 * Below `minSent` recent sends we don't have enough data to adjust, so
 * we leave the linear ramp alone (returns `linearLimit`).
 */
export interface SmartWarmupOptions {
  linearLimit: number;
  fullLimit: number;
  floor: number;
  recentBounces: number;
  recentReplies: number;
  recentSent: number;
  /** Min sends in the window before adjustments apply. Default 20. */
  minSent?: number;
}

export interface SmartWarmupDecision {
  limit: number;
  bounceRate: number;
  replyRate: number;
  /** Multiplier applied to the linear ramp. 1.0 == unchanged. */
  multiplier: number;
  reason: string;
}

export function adjustForHealth(
  opts: SmartWarmupOptions,
): SmartWarmupDecision {
  const minSent = opts.minSent ?? 20;
  if (opts.recentSent < minSent) {
    return {
      limit: opts.linearLimit,
      bounceRate: 0,
      replyRate: 0,
      multiplier: 1,
      reason: `not enough data (${opts.recentSent} < ${minSent} sends)`,
    };
  }
  const bounceRate = opts.recentBounces / opts.recentSent;
  const replyRate = opts.recentReplies / opts.recentSent;

  let multiplier = 1;
  const reasons: string[] = [];

  if (bounceRate > 0.05) {
    multiplier *= 0.5;
    reasons.push(`bounce ${(bounceRate * 100).toFixed(1)}% > 5% (×0.5)`);
  } else if (bounceRate > 0.03) {
    multiplier *= 0.75;
    reasons.push(`bounce ${(bounceRate * 100).toFixed(1)}% > 3% (×0.75)`);
  }
  if (replyRate > 0.05) {
    multiplier *= 1.25;
    reasons.push(`reply ${(replyRate * 100).toFixed(1)}% > 5% (×1.25)`);
  }

  const raw = Math.round(opts.linearLimit * multiplier);
  const limit = Math.max(opts.floor, Math.min(opts.fullLimit, raw));
  return {
    limit,
    bounceRate,
    replyRate,
    multiplier,
    reason: reasons.length > 0 ? reasons.join(", ") : "ok",
  };
}

/**
 * Recent-bounce circuit breaker. If the bounce rate over the last N
 * sends exceeds the threshold, halt the entire tick — sending more
 * mail with bad addresses scorches your sender reputation. Operators
 * fix the data, then re-enable.
 */
export interface BounceCircuitOptions {
  /** Number of bounced emails in the recent window. */
  recentBounces: number;
  /** Total sends in the recent window. */
  recentSent: number;
  /** Maximum acceptable bounce rate (0-1). Default 0.05 (5%). */
  threshold?: number;
  /**
   * Don't trigger until we have at least this many sends in the window —
   * one bounce out of two sends would otherwise trip the circuit. Default 20.
   */
  minSent?: number;
}

export interface BounceCircuitDecision {
  open: boolean;
  rate: number;
  reason: string;
}

export function evaluateBounceCircuit(
  opts: BounceCircuitOptions,
): BounceCircuitDecision {
  const threshold = opts.threshold ?? 0.05;
  const minSent = opts.minSent ?? 20;
  if (opts.recentSent < minSent) {
    return {
      open: false,
      rate: 0,
      reason: `not enough data (${opts.recentSent} < ${minSent} sends)`,
    };
  }
  const rate = opts.recentBounces / opts.recentSent;
  if (rate > threshold) {
    return {
      open: true,
      rate,
      reason: `bounce rate ${(rate * 100).toFixed(1)}% > threshold ${(threshold * 100).toFixed(1)}%`,
    };
  }
  return { open: false, rate, reason: "ok" };
}
