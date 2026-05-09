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
});
