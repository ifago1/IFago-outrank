import { describe, expect, it } from "vitest";
import { matchesRule } from "./auto-assign.js";

describe("matchesRule", () => {
  const business = {
    category: "Kapper",
    city: "Maastricht",
    websiteQuality: "outdated",
  };

  it("matches when no rules are set (wildcard)", () => {
    expect(
      matchesRule(business, {
        niche: null,
        city: null,
        websiteQuality: null,
      }),
    ).toBe(true);
  });

  it("matches case-insensitively on niche", () => {
    expect(
      matchesRule(business, {
        niche: "kapper",
        city: null,
        websiteQuality: null,
      }),
    ).toBe(true);
  });

  it("matches case-insensitively on city", () => {
    expect(
      matchesRule(business, {
        niche: null,
        city: "MAASTRICHT",
        websiteQuality: null,
      }),
    ).toBe(true);
  });

  it("rejects on niche mismatch", () => {
    expect(
      matchesRule(business, {
        niche: "klusbedrijf",
        city: null,
        websiteQuality: null,
      }),
    ).toBe(false);
  });

  it("rejects on city mismatch", () => {
    expect(
      matchesRule(business, {
        niche: null,
        city: "Utrecht",
        websiteQuality: null,
      }),
    ).toBe(false);
  });

  it("matches website-quality bucket exactly", () => {
    expect(
      matchesRule(business, {
        niche: null,
        city: null,
        websiteQuality: "outdated",
      }),
    ).toBe(true);
    expect(
      matchesRule(business, {
        niche: null,
        city: null,
        websiteQuality: "good",
      }),
    ).toBe(false);
  });

  it("rejects when business field is null but rule expects a value", () => {
    expect(
      matchesRule(
        { category: null, city: null, websiteQuality: null },
        { niche: "Kapper", city: null, websiteQuality: null },
      ),
    ).toBe(false);
  });

  it("requires ALL set fields to match (AND semantics)", () => {
    expect(
      matchesRule(business, {
        niche: "kapper",
        city: "maastricht",
        websiteQuality: "outdated",
      }),
    ).toBe(true);
    expect(
      matchesRule(business, {
        niche: "kapper",
        city: "maastricht",
        websiteQuality: "good",
      }),
    ).toBe(false);
  });

  describe("score range (audit_detail.htmlScore)", () => {
    const withScore = (score: number | null) => ({
      category: null,
      city: null,
      websiteQuality: null,
      auditDetail: score == null ? null : { htmlScore: score },
    });

    it("matches when score is within range", () => {
      expect(
        matchesRule(withScore(35), {
          niche: null,
          city: null,
          websiteQuality: null,
          minScore: 20,
          maxScore: 50,
        }),
      ).toBe(true);
    });

    it("rejects when score is below minScore", () => {
      expect(
        matchesRule(withScore(15), {
          niche: null,
          city: null,
          websiteQuality: null,
          minScore: 20,
          maxScore: null,
        }),
      ).toBe(false);
    });

    it("rejects when score is above maxScore", () => {
      expect(
        matchesRule(withScore(85), {
          niche: null,
          city: null,
          websiteQuality: null,
          minScore: null,
          maxScore: 50,
        }),
      ).toBe(false);
    });

    it("rejects when audit is missing entirely and a range is required", () => {
      expect(
        matchesRule(withScore(null), {
          niche: null,
          city: null,
          websiteQuality: null,
          minScore: 20,
          maxScore: null,
        }),
      ).toBe(false);
    });

    it("ignores missing audit when no range is set", () => {
      expect(
        matchesRule(withScore(null), {
          niche: null,
          city: null,
          websiteQuality: null,
        }),
      ).toBe(true);
    });

    it("only minScore is bounded — no upper limit", () => {
      expect(
        matchesRule(withScore(95), {
          niche: null,
          city: null,
          websiteQuality: null,
          minScore: 80,
          maxScore: null,
        }),
      ).toBe(true);
    });
  });
});
