import { describe, expect, it } from "vitest";
import {
  pickThompson,
  sampleBeta,
  type ThompsonItem,
} from "./thompson-sampler.js";

/** Seeded LCG so tests are deterministic. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("sampleBeta", () => {
  it("stays in [0, 1]", () => {
    const r = lcg(42);
    for (let i = 0; i < 200; i++) {
      const x = sampleBeta(2, 5, r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it("mean approximates α / (α + β) over many samples", () => {
    const r = lcg(7);
    const N = 5000;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += sampleBeta(8, 2, r);
    const mean = sum / N;
    // True mean is 0.8; allow generous tolerance for an LCG.
    expect(mean).toBeGreaterThan(0.74);
    expect(mean).toBeLessThan(0.86);
  });
});

describe("pickThompson", () => {
  it("returns null on empty input", () => {
    expect(pickThompson([])).toBeNull();
  });

  it("returns the only item when there's one variant", () => {
    const items: ThompsonItem<string>[] = [
      { item: "A", stats: { sends: 10, replies: 1 } },
    ];
    expect(pickThompson(items, { random: lcg(1) })).toBe("A");
  });

  it("picks the dominant variant most of the time when one is clearly better", () => {
    const items: ThompsonItem<string>[] = [
      { item: "winner", stats: { sends: 200, replies: 60 } }, // ~30%
      { item: "loser", stats: { sends: 200, replies: 4 } }, // ~2%
    ];
    const r = lcg(123);
    let winnerCount = 0;
    for (let i = 0; i < 500; i++) {
      if (pickThompson(items, { random: r }) === "winner") winnerCount++;
    }
    // With this much evidence, winner should dominate (>= 90%).
    expect(winnerCount).toBeGreaterThan(450);
  });

  it("explores untried variants thanks to the uniform prior", () => {
    // Known variant with mediocre evidence — leaves room for the untried
    // posterior (Beta(1,1), mean 0.5, wide) to compete genuinely.
    const items: ThompsonItem<string>[] = [
      { item: "known", stats: { sends: 100, replies: 30 } }, // 30%
      { item: "untried", stats: { sends: 0, replies: 0 } },
    ];
    const r = lcg(99);
    let untriedCount = 0;
    for (let i = 0; i < 500; i++) {
      if (pickThompson(items, { random: r }) === "untried") untriedCount++;
    }
    // Both are reasonable at first glance; we expect a meaningful split,
    // not full domination by either.
    expect(untriedCount).toBeGreaterThan(150);
    expect(untriedCount).toBeLessThan(450);
  });
});
