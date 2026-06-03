import { describe, expect, it } from "vitest";
import { heatScore } from "./heat-score.js";

describe("heatScore", () => {
  it("base case is 50 with no signals", () => {
    expect(heatScore({})).toBe(50);
  });

  it("interested adds 35", () => {
    expect(heatScore({ phoneStatus: "interested" })).toBe(85);
  });

  it("not_interested and wrong_number force 0", () => {
    expect(heatScore({ phoneStatus: "not_interested" })).toBe(0);
    expect(
      heatScore({
        phoneStatus: "wrong_number",
        websiteQuality: "outdated",
        rating: 4.9,
        reviewsCount: 200,
      }),
    ).toBe(0);
  });

  it("upcoming callback within 3 days bumps high", () => {
    const now = new Date("2026-05-20T12:00:00Z");
    const tomorrow = new Date("2026-05-21T12:00:00Z");
    expect(
      heatScore(
        { phoneStatus: "callback", phoneNextAttemptAt: tomorrow },
        now,
      ),
    ).toBe(75);
  });

  it("overdue callback bumps highest", () => {
    const now = new Date("2026-05-20T12:00:00Z");
    const yesterday = new Date("2026-05-19T12:00:00Z");
    expect(
      heatScore(
        { phoneStatus: "callback", phoneNextAttemptAt: yesterday },
        now,
      ),
    ).toBe(80);
  });

  it("outdated site bumps", () => {
    expect(heatScore({ websiteUrl: "https://x.nl", websiteQuality: "outdated" })).toBe(
      65,
    );
  });

  it("no website at all bumps too", () => {
    expect(heatScore({ websiteUrl: null })).toBe(65);
  });

  it("good site cools off", () => {
    expect(heatScore({ websiteUrl: "https://x.nl", websiteQuality: "good" })).toBe(
      45,
    );
  });

  it("reputable rating adds 10", () => {
    expect(heatScore({ rating: 4.7, reviewsCount: 100 })).toBe(60);
  });

  it("low rating subtracts 5", () => {
    expect(heatScore({ rating: 3.0 })).toBe(45);
  });

  it("recent interaction adds warmth", () => {
    const now = new Date("2026-05-20T12:00:00Z");
    const yesterday = new Date("2026-05-19T12:00:00Z");
    expect(heatScore({ lastInteractionAt: yesterday }, now)).toBe(55);
  });

  it("clips to 0..100", () => {
    expect(
      heatScore({
        phoneStatus: "interested",
        websiteUrl: null,
        rating: 5,
        reviewsCount: 500,
        lastInteractionAt: new Date(),
      }),
    ).toBeLessThanOrEqual(100);
  });

  it("accepts ISO strings for dates", () => {
    const now = new Date("2026-05-20T12:00:00Z");
    expect(
      heatScore(
        { phoneStatus: "callback", phoneNextAttemptAt: "2026-05-21T12:00:00Z" },
        now,
      ),
    ).toBe(75);
  });
});
