import { describe, expect, it } from "vitest";
import {
  findMatchingCampaign,
  type CampaignRule,
  type CandidateLead,
} from "./auto-assign.js";

const baseLead: CandidateLead = {
  contactId: "c1",
  businessId: "b1",
  businessCategory: "Hair salon (kapper)",
  businessCity: "Utrecht",
  businessWebsiteQuality: "outdated",
  htmlScore: 35,
};

function rule(overrides: Partial<CampaignRule> = {}): CampaignRule {
  return {
    id: "cam1",
    niche: null,
    autoAssignNiche: null,
    autoAssignCity: null,
    autoAssignWebsiteQuality: null,
    autoAssignMinScore: null,
    autoAssignMaxScore: null,
    autoAssignMaxLeads: null,
    ...overrides,
  };
}

describe("findMatchingCampaign", () => {
  it("matches catch-all (no filters)", () => {
    expect(findMatchingCampaign(baseLead, [rule()])?.id).toBe("cam1");
  });

  it("matches niche substring case-insensitive", () => {
    const r = rule({ id: "kappers", autoAssignNiche: "KAPPER" });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("kappers");
  });

  it("matches niche via English Places-term", () => {
    const r = rule({ id: "salons", autoAssignNiche: "hair" });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("salons");
  });

  it("rejects niche mismatch", () => {
    const r = rule({ autoAssignNiche: "restaurant" });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("matches city exact case-insensitive", () => {
    const r = rule({ id: "u", autoAssignCity: "UTRECHT" });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("u");
  });

  it("rejects city mismatch", () => {
    const r = rule({ autoAssignCity: "Amsterdam" });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("rejects city filter when lead has no city", () => {
    const cityless = { ...baseLead, businessCity: null };
    const r = rule({ autoAssignCity: "Utrecht" });
    expect(findMatchingCampaign(cityless, [r])).toBeNull();
  });

  it("matches website-quality bucket", () => {
    const r = rule({ id: "rot", autoAssignWebsiteQuality: "outdated" });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("rot");
  });

  it("treats null website_quality as 'none' bucket", () => {
    const noSite = { ...baseLead, businessWebsiteQuality: null };
    const r = rule({ id: "geen", autoAssignWebsiteQuality: "none" });
    expect(findMatchingCampaign(noSite, [r])?.id).toBe("geen");
  });

  it("matches inclusive score range", () => {
    const r = rule({
      id: "lo",
      autoAssignMinScore: 30,
      autoAssignMaxScore: 50,
    });
    expect(findMatchingCampaign(baseLead, [r])?.id).toBe("lo");
  });

  it("rejects score below min", () => {
    const r = rule({ autoAssignMinScore: 40 });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("rejects score above max", () => {
    const r = rule({ autoAssignMaxScore: 30 });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("rejects when score is null and a score filter is set", () => {
    const unscored = { ...baseLead, htmlScore: null };
    const r = rule({ autoAssignMinScore: 0 });
    expect(findMatchingCampaign(unscored, [r])).toBeNull();
  });

  it("accepts null score when no score filter is set", () => {
    const unscored = { ...baseLead, htmlScore: null };
    const r = rule({ autoAssignNiche: "kapper" });
    expect(findMatchingCampaign(unscored, [r])?.id).toBe("cam1");
  });

  it("rejects when one of multiple filters fails (AND-semantics)", () => {
    const r = rule({
      autoAssignNiche: "kapper",
      autoAssignCity: "Amsterdam", // mismatch
    });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });

  it("breaks tie by specificity (more filters wins)", () => {
    const catchAll = rule({ id: "all" });
    const specific = rule({
      id: "specific",
      autoAssignNiche: "kapper",
      autoAssignCity: "Utrecht",
    });
    expect(findMatchingCampaign(baseLead, [catchAll, specific])?.id).toBe(
      "specific",
    );
  });

  it("returns null when no campaigns match", () => {
    const r = rule({ autoAssignCity: "Berlin" });
    expect(findMatchingCampaign(baseLead, [r])).toBeNull();
  });
});
