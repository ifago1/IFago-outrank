import { describe, expect, it } from "vitest";
import {
  getDomain,
  isRoleAddress,
  isSyntaxValid,
  validateEmail,
} from "./email-validator.js";

describe("isSyntaxValid", () => {
  it("accepts well-formed addresses", () => {
    expect(isSyntaxValid("piet@kapsalon.nl")).toBe(true);
    expect(isSyntaxValid("p.deboer+work@example.co.uk")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "no-at", "two@@x.com", "trailing@", "@nohead.com"]) {
      expect(isSyntaxValid(bad)).toBe(false);
    }
  });
});

describe("isRoleAddress", () => {
  it("flags generic mailboxes that should usually not be cold-mailed", () => {
    expect(isRoleAddress("info@kapsalon.nl")).toBe(true);
    expect(isRoleAddress("contact@kapsalon.nl")).toBe(true);
    expect(isRoleAddress("klantenservice@kapsalon.nl")).toBe(true);
  });
  it("does not flag personal addresses", () => {
    expect(isRoleAddress("piet@kapsalon.nl")).toBe(false);
  });
});

describe("getDomain", () => {
  it("extracts the domain in lowercase", () => {
    expect(getDomain("Piet@Kapsalon.NL")).toBe("kapsalon.nl");
  });
  it("returns null for malformed input", () => {
    expect(getDomain("oops")).toBeNull();
  });
});

describe("validateEmail", () => {
  it("returns isDeliverable=true when MX is present", async () => {
    const v = await validateEmail("piet@kapsalon.nl", {
      resolveMx: async () => [{ exchange: "mx.kapsalon.nl", priority: 10 }],
    });
    expect(v.isDeliverable).toBe(true);
    expect(v.hasMx).toBe(true);
  });

  it("returns isDeliverable=false when MX lookup fails", async () => {
    const v = await validateEmail("piet@kapsalon.nl", {
      resolveMx: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(v.isDeliverable).toBe(false);
    expect(v.hasMx).toBe(false);
  });

  it("short-circuits on syntax errors", async () => {
    const v = await validateEmail("nope");
    expect(v.syntaxOk).toBe(false);
    expect(v.isDeliverable).toBe(false);
  });
});
