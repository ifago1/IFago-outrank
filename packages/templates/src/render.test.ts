import { describe, expect, it } from "vitest";
import { listVariables, render, TemplateError } from "./render.js";

describe("render", () => {
  it("substitutes simple placeholders", () => {
    expect(render("Hi {{name}}!", { name: "Piet" })).toBe("Hi Piet!");
  });

  it("trims whitespace inside placeholders", () => {
    expect(render("Hi {{ name }}!", { name: "Piet" })).toBe("Hi Piet!");
  });

  it("handles repeated placeholders", () => {
    expect(render("{{x}} and {{x}}", { x: "y" })).toBe("y and y");
  });

  it("converts numbers to strings", () => {
    expect(render("{{n}}x", { n: 3 })).toBe("3x");
  });

  it("throws on missing variables by default, listing every missing key", () => {
    try {
      render("Hi {{a}}, {{b}}", { a: "ok" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateError);
      expect((err as TemplateError).missing).toEqual(["b"]);
    }
  });

  it("supports onMissing=blank", () => {
    expect(render("Hi {{a}}", {}, { onMissing: "blank" })).toBe("Hi ");
  });

  it("supports onMissing=keep", () => {
    expect(render("Hi {{a}}", {}, { onMissing: "keep" })).toBe("Hi {{a}}");
  });

  it("treats null and empty-string the same as missing", () => {
    expect(() =>
      render("Hi {{a}}", { a: null }, { onMissing: "throw" }),
    ).toThrow(TemplateError);
    expect(() =>
      render("Hi {{a}}", { a: "" }, { onMissing: "throw" }),
    ).toThrow(TemplateError);
  });
});

describe("listVariables", () => {
  it("returns each placeholder once", () => {
    expect(listVariables("Hi {{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});
