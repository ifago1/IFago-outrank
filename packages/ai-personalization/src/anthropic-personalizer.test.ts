import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "./anthropic-personalizer.js";

describe("buildUserPrompt", () => {
  it("includes minimum business info", () => {
    const prompt = buildUserPrompt({
      businessName: "Kapsalon de Knipster",
      city: "Utrecht",
      niche: "kapper",
      rating: null,
      reviewsCount: null,
    });
    expect(prompt).toContain("Bedrijf: Kapsalon de Knipster");
    expect(prompt).toContain("Niche: kapper");
    expect(prompt).toContain("Stad: Utrecht");
    expect(prompt).not.toContain("Google:");
    expect(prompt).not.toContain("Reviews:");
  });

  it("formats rating + reviews count when both are present", () => {
    const prompt = buildUserPrompt({
      businessName: "X",
      city: null,
      niche: null,
      rating: 4.7,
      reviewsCount: 86,
    });
    expect(prompt).toContain("Google: 4.7 sterren over 86 reviews");
  });

  it("trims and caps review snippets", () => {
    const prompt = buildUserPrompt({
      businessName: "X",
      city: null,
      niche: null,
      rating: null,
      reviewsCount: null,
      reviewSnippets: [
        "  Goede   service   ",
        "Top kapper",
        "Aanrader",
        "Lekkere koffie",
        "Snelle behandeling",
        "extra-snippet-should-be-dropped",
      ],
    });
    expect(prompt).toContain('- "Goede service"');
    expect(prompt).toContain('- "Top kapper"');
    expect(prompt).not.toContain("extra-snippet-should-be-dropped");
  });

  it("trims website snippets to 400 chars", () => {
    const long = "x".repeat(1000);
    const prompt = buildUserPrompt({
      businessName: "X",
      city: null,
      niche: null,
      rating: null,
      reviewsCount: null,
      websiteSnippet: long,
    });
    const match = prompt.match(/Website-snippet: "(x+)"/);
    expect(match).toBeTruthy();
    expect(match![1]!.length).toBeLessThanOrEqual(400);
  });
});
