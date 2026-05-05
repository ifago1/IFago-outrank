import { describe, expect, it } from "vitest";
import { classify } from "./classifier.js";
import type { ParsedInboundMessage } from "./types.js";

function msg(over: Partial<ParsedInboundMessage>): ParsedInboundMessage {
  return {
    uid: 1,
    messageId: "<inbound-1@example.com>",
    fromAddress: "human@example.com",
    fromName: "Jan",
    toAddresses: ["hallo@ifago.nl"],
    subject: "Re: jouw mail",
    text: "Bedankt voor je bericht.",
    date: new Date(),
    headers: {},
    attachedRfc822: [],
    deliveryStatus: null,
    ...over,
  };
}

describe("classify", () => {
  it("recognises a real reply via In-Reply-To", () => {
    const c = classify(
      msg({ headers: { "in-reply-to": "<orig-1@ifago.nl>" } }),
    );
    expect(c.kind).toBe("reply");
  });

  it("recognises a real reply via References", () => {
    const c = classify(
      msg({
        headers: { references: "<a@x.nl> <orig-1@ifago.nl>" },
      }),
    );
    expect(c.kind).toBe("reply");
  });

  it("classifies vacation auto-reply via Auto-Submitted", () => {
    const c = classify(
      msg({
        headers: { "auto-submitted": "auto-replied" },
        subject: "Re: jouw mail",
      }),
    );
    expect(c.kind).toBe("auto-reply");
  });

  it("classifies out-of-office subject", () => {
    const c = classify(msg({ subject: "Out of office reply" }));
    expect(c.kind).toBe("auto-reply");
  });

  it("classifies DSN bounce via delivery-status part as hard", () => {
    const c = classify(
      msg({
        fromAddress: "MAILER-DAEMON@mailprotect.be",
        subject: "Undeliverable: Snelle vraag",
        deliveryStatus: {
          status: "5.1.1",
          action: "failed",
          finalRecipient: "info@kapsalonzeelig.nl",
          diagnosticCode: "smtp; 550 No such user",
          isHard: true,
        },
        attachedRfc822: [
          { messageId: "<orig-1@ifago.nl>", headers: {} },
        ],
      }),
    );
    expect(c.kind).toBe("bounce");
    if (c.kind === "bounce") {
      expect(c.isHard).toBe(true);
      expect(c.recipient).toBe("info@kapsalonzeelig.nl");
      expect(c.originalMessageId).toBe("orig-1@ifago.nl");
      expect(c.reason).toContain("550");
    }
  });

  it("classifies plain-text bounce when sender is mailer-daemon", () => {
    const c = classify(
      msg({
        fromAddress: "mailer-daemon@example.com",
        subject: "Mail Delivery Failed",
        text: "550 user unknown — could not be delivered",
      }),
    );
    expect(c.kind).toBe("bounce");
    if (c.kind === "bounce") {
      expect(c.isHard).toBe(true);
    }
  });

  it("falls back to unknown when no signals present", () => {
    const c = classify(
      msg({
        headers: {},
        subject: "Newsletter",
        fromAddress: "news@example.com",
      }),
    );
    expect(c.kind).toBe("unknown");
  });

  it("treats soft bounce status 4.x.x as not-hard", () => {
    const c = classify(
      msg({
        fromAddress: "MAILER-DAEMON@example.com",
        deliveryStatus: {
          status: "4.4.7",
          action: "delayed",
          finalRecipient: "boss@example.com",
          diagnosticCode: null,
          isHard: false,
        },
        attachedRfc822: [{ messageId: "<orig-2@ifago.nl>", headers: {} }],
      }),
    );
    expect(c.kind).toBe("bounce");
    if (c.kind === "bounce") expect(c.isHard).toBe(false);
  });
});
