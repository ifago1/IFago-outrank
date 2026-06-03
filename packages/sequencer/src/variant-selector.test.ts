import { describe, expect, it } from "vitest";
import { pickWeighted } from "./variant-selector.js";

describe("pickWeighted", () => {
  it("returns null on empty input", () => {
    expect(pickWeighted([])).toBeNull();
  });

  it("picks the only item when there is one", () => {
    expect(pickWeighted([{ item: "a", weight: 1 }])).toBe("a");
  });

  it("respects the weight distribution (deterministic via injected random)", () => {
    const items = [
      { item: "a", weight: 3 },
      { item: "b", weight: 1 },
    ];
    // total weight = 4
    expect(pickWeighted(items, () => 0)).toBe("a"); // target 0 -> a (acc 3)
    expect(pickWeighted(items, () => 0.74)).toBe("a"); // target 2.96 -> a
    expect(pickWeighted(items, () => 0.76)).toBe("b"); // target 3.04 -> b
    expect(pickWeighted(items, () => 0.999)).toBe("b");
  });

  it("ignores negative weights", () => {
    expect(
      pickWeighted(
        [
          { item: "a", weight: -10 },
          { item: "b", weight: 5 },
        ],
        () => 0.5,
      ),
    ).toBe("b");
  });

  it("falls back to the first item when all weights are zero", () => {
    expect(
      pickWeighted([
        { item: "a", weight: 0 },
        { item: "b", weight: 0 },
      ]),
    ).toBe("a");
  });
});
