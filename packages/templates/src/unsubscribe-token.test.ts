import { describe, expect, it } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe-token.js";

const SECRET = "super-secret-test-key";

describe("unsubscribe tokens", () => {
  it("round-trips correctly", () => {
    const token = signUnsubscribeToken("Piet@Kapsalon.NL", SECRET);
    const result = verifyUnsubscribeToken(token, SECRET);
    expect(result).toEqual({ valid: true, email: "piet@kapsalon.nl" });
  });

  it("rejects tampered payload", () => {
    const token = signUnsubscribeToken("piet@kapsalon.nl", SECRET);
    const [, sig] = token.split(".");
    const tampered = `${signUnsubscribeToken("attacker@evil.com", SECRET).split(".")[0]}.${sig}`;
    const result = verifyUnsubscribeToken(tampered, SECRET);
    expect(result.valid).toBe(false);
  });

  it("rejects bad secret", () => {
    const token = signUnsubscribeToken("piet@kapsalon.nl", SECRET);
    expect(verifyUnsubscribeToken(token, "wrong-secret").valid).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyUnsubscribeToken("garbage", SECRET).valid).toBe(false);
    expect(verifyUnsubscribeToken("", SECRET).valid).toBe(false);
  });

  it("requires a non-empty secret on signing", () => {
    expect(() => signUnsubscribeToken("piet@kapsalon.nl", "")).toThrow();
  });
});
