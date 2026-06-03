import { describe, expect, it, vi } from "vitest";
import { SmtpMailer, type MinimalTransporter } from "./smtp.js";

/**
 * We don't open real SMTP sockets; instead we inject a stub transporter
 * that records the `sendMail` argument. That covers everything the
 * SmtpMailer is responsible for: header construction, addressing,
 * threading, list-unsubscribe, and message-id normalization.
 */
function stubTransport(messageId = "<smtp-1@local>") {
  const sendMail = vi.fn(async (input: Record<string, unknown>) => ({
    messageId,
    accepted: ["x"],
    rejected: [],
    response: "250 OK",
    raw: input,
  }));
  const transporter: MinimalTransporter = { sendMail };
  return { transporter, sendMail };
}

describe("SmtpMailer", () => {
  it("requires a from address", () => {
    const { transporter } = stubTransport();
    expect(
      () =>
        new SmtpMailer({
          host: "x",
          port: 587,
          user: "u",
          pass: "p",
          from: "",
          transporter,
        }),
    ).toThrow(/from required/);
  });

  it("requires host + port when no transporter is injected", () => {
    expect(
      () =>
        new SmtpMailer({
          host: "",
          port: 587,
          user: "u",
          pass: "p",
          from: "me@a.nl",
        }),
    ).toThrow(/host required/);
  });

  it("formats From with display name when fromName is set", async () => {
    const { transporter, sendMail } = stubTransport();
    const mailer = new SmtpMailer({
      host: "x",
      port: 587,
      user: "u",
      pass: "p",
      from: "me@agency.nl",
      fromName: "Mij",
      transporter,
    });
    await mailer.send({ to: "lead@x.nl", subject: "Hi", text: "Body" });
    const arg = sendMail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg["from"]).toBe('"Mij" <me@agency.nl>');
    expect(arg["to"]).toBe("lead@x.nl");
  });

  it("emits In-Reply-To + References headers when threading", async () => {
    const { transporter, sendMail } = stubTransport();
    const mailer = new SmtpMailer({
      host: "x",
      port: 587,
      user: "u",
      pass: "p",
      from: "me@a.nl",
      transporter,
    });
    await mailer.send({
      to: "lead@x.nl",
      subject: "Re: foo",
      text: "ping",
      inReplyTo: "<original@msg>",
    });
    const headers = (sendMail.mock.calls[0]?.[0] as { headers: Record<string, string> })
      .headers;
    expect(headers["In-Reply-To"]).toBe("<original@msg>");
    expect(headers["References"]).toBe("<original@msg>");
  });

  it("emits RFC 8058 List-Unsubscribe headers", async () => {
    const { transporter, sendMail } = stubTransport();
    const mailer = new SmtpMailer({
      host: "x",
      port: 587,
      user: "u",
      pass: "p",
      from: "me@a.nl",
      transporter,
    });
    await mailer.send({
      to: "lead@x.nl",
      subject: "Hi",
      text: "Body",
      unsubscribeUrl: "https://x.test/unsub?t=abc",
    });
    const headers = (sendMail.mock.calls[0]?.[0] as { headers: Record<string, string> })
      .headers;
    expect(headers["List-Unsubscribe"]).toBe("<https://x.test/unsub?t=abc>");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("strips angle brackets from the returned messageId", async () => {
    const { transporter } = stubTransport("<abc-123@server>");
    const mailer = new SmtpMailer({
      host: "x",
      port: 587,
      user: "u",
      pass: "p",
      from: "me@a.nl",
      transporter,
    });
    const r = await mailer.send({ to: "x@y.z", subject: "s", text: "b" });
    expect(r.messageId).toBe("abc-123@server");
  });

  it("propagates SMTP errors so the sequencer can mark the lead failed/bounced", async () => {
    const transporter: MinimalTransporter = {
      sendMail: vi.fn(async () => {
        const err = new Error("550 5.1.1 user unknown") as Error & {
          responseCode?: number;
        };
        err.responseCode = 550;
        throw err;
      }),
    };
    const mailer = new SmtpMailer({
      host: "x",
      port: 587,
      user: "u",
      pass: "p",
      from: "me@a.nl",
      transporter,
    });
    await expect(
      mailer.send({ to: "lead@x.nl", subject: "Hi", text: "Body" }),
    ).rejects.toThrow(/550/);
  });

  it("emits X-Outreach-* headers from the tags input", async () => {
    const { transporter, sendMail } = stubTransport();
    const mailer = new SmtpMailer({
      host: "x",
      port: 587,
      user: "u",
      pass: "p",
      from: "me@a.nl",
      transporter,
    });
    await mailer.send({
      to: "x@y.z",
      subject: "s",
      text: "b",
      tags: { campaign: "kappers-q2", step: "1" },
    });
    const headers = (sendMail.mock.calls[0]?.[0] as { headers: Record<string, string> })
      .headers;
    expect(headers["X-Outreach-campaign"]).toBe("kappers-q2");
    expect(headers["X-Outreach-step"]).toBe("1");
  });
});
