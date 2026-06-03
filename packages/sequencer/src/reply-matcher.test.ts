import { describe, expect, it } from "vitest";
import { extractIds } from "./reply-matcher.js";

describe("extractIds", () => {
  it("strips angle brackets", () => {
    expect(extractIds("<abc@host>")).toEqual(["abc@host"]);
  });
  it("splits whitespace-separated lists", () => {
    expect(extractIds("<a@x> <b@y>\n<c@z>")).toEqual([
      "a@x",
      "b@y",
      "c@z",
    ]);
  });
  it("ignores empty entries", () => {
    expect(extractIds("   ")).toEqual([]);
  });
});
