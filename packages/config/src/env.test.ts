import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env.js";

const minimalDb = { DATABASE_URL: "postgres://u:p@localhost:5432/x" };

describe("loadConfig", () => {
  it("validates the discover profile happy path", () => {
    const cfg = loadConfig("discover", {
      ...minimalDb,
      GOOGLE_PLACES_API_KEY: "key123",
    } as NodeJS.ProcessEnv);
    expect(cfg.GOOGLE_PLACES_API_KEY).toBe("key123");
  });

  it("collects every missing/invalid var (not just the first)", () => {
    try {
      loadConfig("send-tick", { DATABASE_URL: "not-a-url" } as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const issues = (err as ConfigError).issues;
      const paths = issues.map((i) => i.path.join("."));
      expect(paths).toContain("DATABASE_URL");
      expect(paths).toContain("POSTMARK_SERVER_TOKEN");
      expect(paths).toContain("FROM_EMAIL");
      expect(paths).toContain("UNSUBSCRIBE_SECRET");
      // optional fields shouldn't appear
      expect(paths).not.toContain("ANTHROPIC_API_KEY");
    }
  });

  it("rejects a too-short unsubscribe secret", () => {
    expect(() =>
      loadConfig("send-tick", {
        ...minimalDb,
        POSTMARK_SERVER_TOKEN: "tok",
        FROM_EMAIL: "me@a.nl",
        FROM_NAME: "Me",
        PUBLIC_BASE_URL: "https://x.test",
        UNSUBSCRIBE_SECRET: "too-short",
      } as NodeJS.ProcessEnv),
    ).toThrow(/UNSUBSCRIBE_SECRET/);
  });

  it("coerces integer + hour fields to numbers", () => {
    const cfg = loadConfig("send-tick", {
      ...minimalDb,
      POSTMARK_SERVER_TOKEN: "tok",
      FROM_EMAIL: "me@a.nl",
      FROM_NAME: "Me",
      PUBLIC_BASE_URL: "https://x.test",
      UNSUBSCRIBE_SECRET: "x".repeat(20),
      DAILY_SEND_LIMIT: "75",
      SEND_WINDOW_START: "9",
      SEND_WINDOW_END: "16",
      SEND_WEEKDAYS: "2,3,4",
    } as NodeJS.ProcessEnv);
    expect(cfg.DAILY_SEND_LIMIT).toBe(75);
    expect(cfg.SEND_WINDOW_START).toBe(9);
    expect(cfg.SEND_WINDOW_END).toBe(16);
  });

  it("validates SEND_WEEKDAYS format", () => {
    expect(() =>
      loadConfig("send-tick", {
        ...minimalDb,
        POSTMARK_SERVER_TOKEN: "tok",
        FROM_EMAIL: "me@a.nl",
        FROM_NAME: "Me",
        PUBLIC_BASE_URL: "https://x.test",
        UNSUBSCRIBE_SECRET: "x".repeat(20),
        SEND_WEEKDAYS: "1,2,8", // 8 is invalid
      } as NodeJS.ProcessEnv),
    ).toThrow(/SEND_WEEKDAYS/);
  });
});
