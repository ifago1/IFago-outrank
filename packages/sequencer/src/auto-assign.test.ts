import { describe, expect, it } from "vitest";
import { findMatchingCampaign, type CampaignRule, type CandidateLead } from "./auto-assign.js";

const baseLead: CandidateLead = {
  contactId: "c1",
  businessId: "b1",
  // Lijkt op wat Places teruggeeft voor NL-kappers: Engelse hoofdterm
  // plus de Nederlandse aliases die de discovery-CLI vastlegt.
  businessCategory: "Hair salon (kapper)",
  businessCity: "Utrecht",
  businessWebsiteQuality: "outdated",
};

function rule(overrides: Partial<CampaignRule> = {}): CampaignRule {
  return {
    id: "cam1",
    niche: null,
    matchNiches: null,
    matchCities: null,
    matchWebsiteQualities: null,
    matchPriority: 0,
    ...overrides,
  };
}

describe("findMatchingCampaign", () => {
  it("matches when no filters are set (catch-all campaign)", () => {
    const result = findMatchingCampaign(baseLead, [rule()]);
    expect(result?.id).toBe("cam1");
  });

  it("matches niche substring against business.category (case-insensitive)", () => {
    const r = rule({ id: "kappers", matchNiches: ["KAPPER"] });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("kappers");
  });

  it("matches via the English Places-category term", () => {
    const r = rule({ id: "salons", matchNiches: ["hair"] });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("salons");
  });

  it("rejects niche mismatch", () => {
    const r = rule({ matchNiches: ["restaurant"] });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("matches city case-insensitive exact", () => {
    const r = rule({ id: "u", matchCities: ["UTRECHT"] });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("u");
  });

  it("rejects city mismatch", () => {
    const r = rule({ matchCities: ["Amsterdam"] });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("rejects city filter when lead has no city", () => {
    const cityless = { ...baseLead, businessCity: null };
    const r = rule({ matchCities: ["Utrecht"] });
    expect(findMatchingCampaign(cityless, [r])).toBeNull();
  });

  it("matches website quality bucket", () => {
    const r = rule({ id: "rotte-sites", matchWebsiteQualities: ["outdated"] });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("rotte-sites");
  });

  it("treats null website_quality as 'none' bucket", () => {
    const noWebsite = { ...baseLead, businessWebsiteQuality: null };
    const r = rule({ matchWebsiteQualities: ["none"] });
    expect(findMatchingCampaign(noWebsite, [r])?.id).toBe("cam1");
  });

  it("rejects when one of multiple filters fails (AND-semantics)", () => {
    const r = rule({
      matchNiches: ["kapper"],
      matchCities: ["Amsterdam"], // mismatch
    });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("picks higher priority on tie", () => {
    const lowPrio = rule({ id: "low", matchPriority: 0 });
    const highPrio = rule({ id: "high", matchPriority: 10 });
    expect(findMatchingCampaign(baseLead, [lowPrio, highPrio])?.id).toBe("high");
  });

  it("breaks tie by specificity (more filters wins)", () => {
    const catchAll = rule({ id: "all", matchPriority: 5 });
    const specific = rule({
      id: "specific",
      matchPriority: 5,
      matchNiches: ["kapper"],
      matchCities: ["Utrecht"],
    });
    expect(findMatchingCampaign(baseLead, [catchAll, specific])?.id).toBe(
      "specific",
    );
  });

  it("returns null when no campaigns match", () => {
    const r = rule({ matchCities: ["Berlin"] });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });
});
