import { describe, expect, it } from "vitest";
import { pickDueSearches } from "./run-saved-search.js";
import type { SavedSearch } from "@outreach/db";

const NOW = new Date("2026-05-15T12:00:00Z");

function search(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: "s1",
    name: "Kappers Utrecht",
    niche: "kapper",
    city: "Utrecht",
    radiusMeters: null,
    maxPages: 1,
    scheduleEnabled: true,
    scheduleIntervalDays: 7,
    lastRunAt: null,
    lastRunResult: null,
    createdAt: new Date(),
    ...overrides,
  } as SavedSearch;
}

describe("pickDueSearches", () => {
  it("includes searches that have never run", () => {
    expect(pickDueSearches([search()], NOW)).toHaveLength(1);
  });

  it("skips disabled searches", () => {
    expect(
      pickDueSearches([search({ scheduleEnabled: false })], NOW),
    ).toHaveLength(0);
  });

  it("skips searches that ran within the interval", () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(
      pickDueSearches([search({ lastRunAt: yesterday })], NOW),
    ).toHaveLength(0);
  });

  it("includes searches whose interval has elapsed", () => {
    const eightDaysAgo = new Date(
      NOW.getTime() - 8 * 24 * 60 * 60 * 1000,
    );
    expect(
      pickDueSearches([search({ lastRunAt: eightDaysAgo })], NOW),
    ).toHaveLength(1);
  });

  it("respects per-search interval", () => {
    const sixHoursAgo = new Date(NOW.getTime() - 6 * 60 * 60 * 1000);
    // Daily interval -> due (>= 1 day)?  6 hours < 1 day, NOT due
    expect(
      pickDueSearches(
        [search({ scheduleIntervalDays: 1, lastRunAt: sixHoursAgo })],
        NOW,
      ),
    ).toHaveLength(0);
    // 30-min interval would catch it but we use whole-day intervals only
    const ninetyMinutesAgo = new Date(NOW.getTime() - 90 * 60 * 1000);
    expect(
      pickDueSearches(
        [search({ scheduleIntervalDays: 1, lastRunAt: ninetyMinutesAgo })],
        NOW,
      ),
    ).toHaveLength(0);
  });
});
