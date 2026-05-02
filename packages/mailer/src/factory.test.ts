import { describe, expect, it } from "vitest";
import { createMailer } from "./factory.js";
import { PostmarkMailer } from "./postmark.js";
import { SmtpMailer } from "./smtp.js";

describe("createMailer", () => {
  it("constructs a PostmarkMailer when provider=postmark", () => {
    const m = createMailer({
      provider: "postmark",
      postmark: { serverToken: "t", from: "me@a.nl" },
    });
    expect(m).toBeInstanceOf(PostmarkMailer);
  });

  it("constructs an SmtpMailer when provider=smtp (with injected transporter)", () => {
    const m = createMailer({
      provider: "smtp",
      smtp: {
        host: "x",
        port: 587,
        user: "u",
        pass: "p",
        from: "me@a.nl",
        transporter: { sendMail: async () => ({}) },
      },
    });
    expect(m).toBeInstanceOf(SmtpMailer);
  });

  it("rejects mismatched config (postmark requested without postmark options)", () => {
    expect(() =>
      createMailer({
        provider: "postmark",
        smtp: {
          host: "x",
          port: 587,
          user: "u",
          pass: "p",
          from: "me@a.nl",
          transporter: { sendMail: async () => ({}) },
        },
      }),
    ).toThrow(/postmark/);
  });

  it("rejects smtp requested without smtp options", () => {
    expect(() => createMailer({ provider: "smtp" })).toThrow(/smtp/);
  });
});
