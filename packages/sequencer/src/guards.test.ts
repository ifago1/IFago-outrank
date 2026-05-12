import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEND_WINDOW,
  isDailyLimitReached,
  isInSendWindow,
  isUnsubscribed,
  preSendCheck,
  startOfDay,
} from "./guards.js";

const wedAt10 = new Date("2026-05-06T10:00:00"); // Wed (ISO 3)
const satAt10 = new Date("2026-05-09T10:00:00"); // Sat (ISO 6)
const wedAt22 = new Date("2026-05-06T22:00:00");

describe("isInSendWindow", () => {
  it("accepts a tue/wed/thu within hours", () => {
    expect(isInSendWindow(wedAt10, DEFAULT_SEND_WINDOW)).toBe(true);
  });
  it("rejects weekends", () => {
    expect(isInSendWindow(satAt10, DEFAULT_SEND_WINDOW)).toBe(false);
  });
  it("rejects out-of-hours", () => {
    expect(isInSendWindow(wedAt22, DEFAULT_SEND_WINDOW)).toBe(false);
  });

  describe("with explicit timezone", () => {
    // 2026-05-13 06:30 UTC = Wed 08:30 Europe/Amsterdam — before the window.
    const utc0630OnWed = new Date("2026-05-13T06:30:00Z");
    // 2026-05-13 09:30 UTC = Wed 11:30 Europe/Amsterdam — inside the window.
    const utc0930OnWed = new Date("2026-05-13T09:30:00Z");
    // 2026-05-13 14:30 UTC = Wed 16:30 Europe/Amsterdam — past the window.
    const utc1430OnWed = new Date("2026-05-13T14:30:00Z");

    const amsWindow = { ...DEFAULT_SEND_WINDOW, timezone: "Europe/Amsterdam" };

    it("interprets startHour/endHour in the configured tz", () => {
      expect(isInSendWindow(utc0630OnWed, amsWindow)).toBe(false);
      expect(isInSendWindow(utc0930OnWed, amsWindow)).toBe(true);
      expect(isInSendWindow(utc1430OnWed, amsWindow)).toBe(false);
    });

    it("interprets weekdays in the configured tz", () => {
      // Wed 23:30 UTC = Thu 01:30 Europe/Amsterdam. Window is 9-16 so the
      // hour check still rejects it, but the weekday now resolves to Thu.
      const utc2330OnWed = new Date("2026-05-13T23:30:00Z");
      expect(isInSendWindow(utc2330OnWed, amsWindow)).toBe(false);
      // Make the hour valid in Amsterdam by jumping forward; still Thu locally.
      const utc1100OnWed = new Date("2026-05-13T11:00:00Z"); // Wed 13:00 Ams
      expect(isInSendWindow(utc1100OnWed, amsWindow)).toBe(true);
    });
  });
});

describe("startOfDay", () => {
  it("returns host-local midnight when tz is omitted", () => {
    const sample = new Date("2026-05-13T12:34:56");
    const result = startOfDay(sample);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("returns the tz's midnight as a UTC instant", () => {
    // 2026-05-13 06:30 UTC = Wed 08:30 Europe/Amsterdam.
    // Midnight Ams on Wed = 2026-05-12 22:00 UTC.
    const result = startOfDay(
      new Date("2026-05-13T06:30:00Z"),
      "Europe/Amsterdam",
    );
    expect(result.toISOString()).toBe("2026-05-12T22:00:00.000Z");
  });

  it("handles dates straddling the UTC day boundary correctly", () => {
    // 2026-05-13 23:30 UTC = Thu 01:30 Europe/Amsterdam.
    // Midnight Thu Ams = 2026-05-13 22:00 UTC, NOT 2026-05-13 00:00 UTC.
    const result = startOfDay(
      new Date("2026-05-13T23:30:00Z"),
      "Europe/Amsterdam",
    );
    expect(result.toISOString()).toBe("2026-05-13T22:00:00.000Z");
  });
});

describe("isUnsubscribed", () => {
  it("matches case-insensitively", () => {
    expect(isUnsubscribed("Piet@Kapsalon.NL", ["piet@kapsalon.nl"])).toBe(true);
    expect(isUnsubscribed("Piet@Kapsalon.NL", ["someone-else@x.com"])).toBe(
      false,
    );
  });
});

describe("isDailyLimitReached", () => {
  it("compares sent vs limit", () => {
    expect(isDailyLimitReached(49, 50)).toBe(false);
    expect(isDailyLimitReached(50, 50)).toBe(true);
    expect(isDailyLimitReached(99, 50)).toBe(true);
  });
});

describe("preSendCheck (order matters)", () => {
  const base = {
    email: "piet@kapsalon.nl",
    contactDoNotContact: false,
    hasOtherActiveCampaign: false,
    unsubscribed: [] as string[],
    now: wedAt10,
    window: DEFAULT_SEND_WINDOW,
    sentToday: 0,
    dailyLimit: 50,
  };

  it("returns null when everything passes", () => {
    expect(preSendCheck(base)).toBeNull();
  });

  it("returns 'unsubscribed' first", () => {
    expect(
      preSendCheck({
        ...base,
        unsubscribed: ["piet@kapsalon.nl"],
        contactDoNotContact: true,
      }),
    ).toBe("unsubscribed");
  });

  it("returns 'do_not_contact' next", () => {
    expect(
      preSendCheck({
        ...base,
        contactDoNotContact: true,
        hasOtherActiveCampaign: true,
      }),
    ).toBe("do_not_contact");
  });

  it("returns 'already_in_other_campaign' when applicable", () => {
    expect(preSendCheck({ ...base, hasOtherActiveCampaign: true })).toBe(
      "already_in_other_campaign",
    );
  });

  it("can opt-in to multi-campaign with allowMultipleCampaignsPerBusiness", () => {
    expect(
      preSendCheck({
        ...base,
        hasOtherActiveCampaign: true,
        allowMultipleCampaignsPerBusiness: true,
      }),
    ).toBeNull();
  });

  it("returns 'outside_send_window'", () => {
    expect(preSendCheck({ ...base, now: satAt10 })).toBe(
      "outside_send_window",
    );
  });

  it("returns 'daily_limit_reached'", () => {
    expect(preSendCheck({ ...base, sentToday: 50 })).toBe(
      "daily_limit_reached",
    );
  });
});
