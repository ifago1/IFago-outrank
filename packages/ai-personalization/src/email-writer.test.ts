import { describe, expect, it } from "vitest";
import {
  buildEmailUserPrompt,
  parseSubjectBody,
} from "./email-writer.js";

describe("buildEmailUserPrompt", () => {
  it("includes audit context when present", () => {
    const prompt = buildEmailUserPrompt({
      businessName: "Kapsalon X",
      niche: "kapper",
      city: "Utrecht",
      websiteUrl: "https://example.nl",
      websiteQuality: "outdated",
      psiPerformanceMobile: 22,
      auditSummary: "Verouderde HTML, geen viewport.",
      auditWeaknesses: ["Geen mobile responsive", "Trage laadtijden"],
      stepOrder: 1,
    });
    expect(prompt).toContain("WebsiteQuality: outdated");
    expect(prompt).toContain("PSI-mobile-performance: 22");
    expect(prompt).toContain("Audit-summary: Verouderde HTML, geen viewport.");
    expect(prompt).toContain("- Geen mobile responsive");
    expect(prompt).toContain("Step: 1");
  });

  it("marks websiteUrl as (geen) when missing", () => {
    const prompt = buildEmailUserPrompt({
      businessName: "Pizzeria Roma",
      websiteUrl: null,
      stepOrder: 1,
    });
    expect(prompt).toContain("WebsiteUrl: (geen)");
  });

  it("caps weaknesses at 5 entries", () => {
    const prompt = buildEmailUserPrompt({
      businessName: "X",
      auditWeaknesses: ["a", "b", "c", "d", "e", "f", "g"],
      stepOrder: 1,
    });
    expect(prompt).toContain("- a");
    expect(prompt).toContain("- e");
    expect(prompt).not.toContain("- f");
  });

  it("normalizes whitespace in audit-summary and weaknesses", () => {
    const prompt = buildEmailUserPrompt({
      businessName: "X",
      auditSummary: "Heel  lange  zin\nmet\nnewlines.",
      auditWeaknesses: ["Spaces   en\nnewlines"],
      stepOrder: 1,
    });
    expect(prompt).toContain("Audit-summary: Heel lange zin met newlines.");
    expect(prompt).toContain("- Spaces en newlines");
  });
});

describe("parseSubjectBody", () => {
  it("extracts subject and body in standard format", () => {
    const raw = `SUBJECT: Snelle vraag\nBODY:\nHi {{first_name}},\n\nWat een korte tekst.\n\nGroet,\n{{sender_name}}`;
    const { subject, body } = parseSubjectBody(raw);
    expect(subject).toBe("Snelle vraag");
    expect(body).toBe(
      "Hi {{first_name}},\n\nWat een korte tekst.\n\nGroet,\n{{sender_name}}",
    );
  });

  it("strips stray markdown bolds", () => {
    const raw = `**SUBJECT:** Hallo\n**BODY:**\nHi {{first_name}},\n\nTest`;
    const { subject, body } = parseSubjectBody(raw);
    expect(subject).toBe("Hallo");
    expect(body).toContain("Hi {{first_name}}");
  });

  it("returns empty strings when format is missing", () => {
    const { subject, body } = parseSubjectBody("just a regular response");
    expect(subject).toBe("");
    expect(body).toBe("");
  });
});
