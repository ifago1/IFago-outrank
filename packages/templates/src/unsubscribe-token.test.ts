import { describe, expect, it } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe-token.js";

const SECRET = "super-secret-test-key";

describe("unsubscribe tokens", () => {
  it("round-trips correctly + records issuedAt", () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signUnsubscribeToken("Piet@Kapsalon.NL", SECRET);
    const result = verifyUnsubscribeToken(token, SECRET);
    expect(result).toMatchObject({
      valid: true,
      email: "piet@kapsalon.nl",
    });
    if (result.valid) {
      expect(result.issuedAt).not.toBeNull();
      expect(result.issuedAt!).toBeGreaterThanOrEqual(before);
    }
  });

  it("rejects tampered payload", () => {
    const token = signUnsubscribeToken("piet@kapsalon.nl", SECRET);
    const parts = token.split(".");
    // Swap the email portion but keep the iat + sig — signature invalid.
    const tampered = `${signUnsubscribeToken("attacker@evil.com", SECRET).split(".")[0]}.${parts[1]}.${parts[2]}`;
    expect(verifyUnsubscribeToken(tampered, SECRET).valid).toBe(false);
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

  it("rejects expired tokens (over default 90 days)", () => {
    const token = signUnsubscribeToken("piet@kapsalon.nl", SECRET);
    const tooLater = Math.floor(Date.now() / 1000) + 91 * 24 * 60 * 60;
    const result = verifyUnsubscribeToken(token, SECRET, { now: tooLater });
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("respects a custom maxAgeSeconds", () => {
    const token = signUnsubscribeToken("piet@kapsalon.nl", SECRET);
    const fiveSeconds = 5;
    const tenSecondsLater = Math.floor(Date.now() / 1000) + 10;
    expect(
      verifyUnsubscribeToken(token, SECRET, {
        maxAgeSeconds: fiveSeconds,
        now: tenSecondsLater,
      }).valid,
    ).toBe(false);
    expect(
      verifyUnsubscribeToken(token, SECRET, {
        maxAgeSeconds: 60,
        now: tenSecondsLater,
      }).valid,
    ).toBe(true);
  });

  it("accepts legacy 2-part tokens but reports issuedAt=null", () => {
    // Manually construct a legacy token (no iat segment).
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const email = "legacy@kapsalon.nl";
    const payload = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const sig = createHmac("sha256", SECRET)
      .update(payload)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const legacy = `${payload}.${sig}`;
    const result = verifyUnsubscribeToken(legacy, SECRET);
    expect(result).toEqual({
      valid: true,
      email: "legacy@kapsalon.nl",
      issuedAt: null,
    });
  });
});
