import { describe, expect, it } from "vitest";
import { effectiveDailyLimit, evaluateBounceCircuit } from "./health.js";

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
