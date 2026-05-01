import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves input order in the results array", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      2, 4, 6, 8, 10,
    ]);
  });

  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    const run = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    };
    await mapWithConcurrency(Array.from({ length: 10 }), 3, run);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("isolates failures (one bad task doesn't sink the batch)", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(out[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(out[1]?.status).toBe("rejected");
    expect(out[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("handles empty input", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it("clamps negative or zero concurrency to 1", async () => {
    const out = await mapWithConcurrency([1, 2], 0, async (n) => n);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      1, 2,
    ]);
  });
});
