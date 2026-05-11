import { describe, expect, it } from "vitest";
import {
  adjustForHealth,
  effectiveDailyLimit,
  evaluateBounceCircuit,
} from "./health.js";

describe("effectiveDailyLimit (warmup ramp)", () => {
  const NOW = new Date("2026-05-15T12:00:00Z");

  it("returns floor when there are no sends yet", () => {
    expect(
      effectiveDailyLimit({ firstSentAt: null, now: NOW, fullLimit: 50 }),
    ).toBe(5);
  });

  it("returns floor on day 0", () => {
    expect(
      effectiveDailyLimit({
        firstSentAt: NOW,
        now: NOW,
        fullLimit: 50,
      }),
    ).toBe(5);
  });

  it("interpolates linearly between floor and fullLimit", () => {
    // Day 7 of a 14-day ramp: should be roughly halfway (5 → 50 → ~28)
    const day7 = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(
      effectiveDailyLimit({
        firstSentAt: day7,
        now: NOW,
        fullLimit: 50,
      }),
    ).toBe(28);
  });

  it("returns fullLimit at and beyond warmupDays", () => {
    const day14 = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000);
    expect(
      effectiveDailyLimit({
        firstSentAt: day14,
        now: NOW,
        fullLimit: 50,
      }),
    ).toBe(50);

    const day30 = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(
      effectiveDailyLimit({
        firstSentAt: day30,
        now: NOW,
        fullLimit: 50,
      }),
    ).toBe(50);
  });

  it("respects custom warmupDays + floor", () => {
    const day3 = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    // 3 of 6 days = halfway, floor=10, full=100 → 55
    expect(
      effectiveDailyLimit({
        firstSentAt: day3,
        now: NOW,
        fullLimit: 100,
        warmupDays: 6,
        floor: 10,
      }),
    ).toBe(55);
  });

  it("never returns more than fullLimit even when floor > fullLimit was requested", () => {
    expect(
      effectiveDailyLimit({
        firstSentAt: null,
        now: NOW,
        fullLimit: 3,
        floor: 50,
      }),
    ).toBe(3);
  });
});

describe("evaluateBounceCircuit", () => {
  it("does not trip when sample is too small", () => {
    const decision = evaluateBounceCircuit({
      recentBounces: 5,
      recentSent: 10,
    });
    expect(decision.open).toBe(false);
    expect(decision.reason).toContain("not enough data");
  });

  it("does not trip when rate is at or below threshold", () => {
    const decision = evaluateBounceCircuit({
      recentBounces: 1,
      recentSent: 50,
    }); // 2%
    expect(decision.open).toBe(false);
    expect(decision.rate).toBe(0.02);
  });

  it("trips when rate exceeds threshold and sample is sufficient", () => {
    const decision = evaluateBounceCircuit({
      recentBounces: 5,
      recentSent: 50,
    }); // 10%
    expect(decision.open).toBe(true);
    expect(decision.reason).toContain("10.0%");
  });

  it("respects custom threshold + minSent", () => {
    const decision = evaluateBounceCircuit({
      recentBounces: 2,
      recentSent: 30,
      threshold: 0.1,
      minSent: 10,
    }); // 6.7% < 10%
    expect(decision.open).toBe(false);

    const decision2 = evaluateBounceCircuit({
      recentBounces: 4,
      recentSent: 30,
      threshold: 0.1,
      minSent: 10,
    }); // 13.3% > 10%
    expect(decision2.open).toBe(true);
  });
});

describe("adjustForHealth (smart warmup)", () => {
  const base = { linearLimit: 20, fullLimit: 50, floor: 5 };

  it("leaves the linear limit alone when there's not enough data", () => {
    const d = adjustForHealth({
      ...base,
      recentSent: 10,
      recentBounces: 0,
      recentReplies: 0,
    });
    expect(d.limit).toBe(20);
    expect(d.multiplier).toBe(1);
  });

  it("halves the limit when bounces > 5%", () => {
    const d = adjustForHealth({
      ...base,
      recentSent: 100,
      recentBounces: 8,
      recentReplies: 0,
    });
    expect(d.multiplier).toBe(0.5);
    expect(d.limit).toBe(10);
  });

  it("0.75x when bounces between 3-5%", () => {
    const d = adjustForHealth({
      ...base,
      recentSent: 100,
      recentBounces: 4,
      recentReplies: 0,
    });
    expect(d.multiplier).toBe(0.75);
    expect(d.limit).toBe(15);
  });

  it("1.25x when reply rate > 5%", () => {
    const d = adjustForHealth({
      ...base,
      recentSent: 100,
      recentBounces: 0,
      recentReplies: 8,
    });
    expect(d.multiplier).toBe(1.25);
    expect(d.limit).toBe(25);
  });

  it("compounds bounce penalty + reply boost", () => {
    const d = adjustForHealth({
      ...base,
      recentSent: 100,
      recentBounces: 4, // ×0.75
      recentReplies: 8, // ×1.25
    });
    expect(d.multiplier).toBeCloseTo(0.9375);
    expect(d.limit).toBe(19); // round(20 * 0.9375)
  });

  it("clamps below floor and above fullLimit", () => {
    const lowFloor = adjustForHealth({
      linearLimit: 6,
      fullLimit: 50,
      floor: 5,
      recentSent: 100,
      recentBounces: 8, // ×0.5 → 3, but floor is 5
      recentReplies: 0,
    });
    expect(lowFloor.limit).toBe(5);

    const highCap = adjustForHealth({
      linearLimit: 50,
      fullLimit: 50,
      floor: 5,
      recentSent: 100,
      recentBounces: 0,
      recentReplies: 8, // ×1.25 → 62.5, clamped to fullLimit
    });
    expect(highCap.limit).toBe(50);
  });
});
