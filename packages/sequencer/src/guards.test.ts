import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEND_WINDOW,
  isDailyLimitReached,
  isInSendWindow,
  isUnsubscribed,
  preSendCheck,
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
