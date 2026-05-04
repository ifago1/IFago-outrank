import { describe, expect, it, vi } from "vitest";
import { PostmarkMailer } from "./postmark.js";

function okResponse(messageId: string) {
  return new Response(
    JSON.stringify({
      MessageID: messageId,
      ErrorCode: 0,
      SubmittedAt: new Date().toISOString(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("PostmarkMailer", () => {
  it("requires serverToken and from", () => {
    expect(
      () => new PostmarkMailer({ serverToken: "", from: "a@b.c" }),
    ).toThrow();
    expect(
      () => new PostmarkMailer({ serverToken: "x", from: "" }),
    ).toThrow();
  });

  it("posts the right payload, headers, threading, and unsubscribe header", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse("abc-123"),
    ) as unknown as typeof fetch;

    const mailer = new PostmarkMailer({
      serverToken: "tok",
      from: "me@agency.nl",
      fromName: "Mij",
      replyTo: "reply@agency.nl",
      defaultTag: "outreach",
      fetchImpl,
    });

    const res = await mailer.send({
      to: "lead@kapsalon.nl",
      subject: "Hi",
      text: "Body",
      inReplyTo: "<original@msg>",
      unsubscribeUrl: "https://x.test/unsub?t=abc",
      tags: { campaign: "kappers-q2" },
    });

    expect(res.messageId).toBe("abc-123");

    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect(call?.[0]).toBe("https://api.postmarkapp.com/email");
    const init = call?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Postmark-Server-Token"]).toBe("tok");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["From"]).toBe("Mij <me@agency.nl>");
    expect(body["ReplyTo"]).toBe("reply@agency.nl");
    expect(body["Tag"]).toBe("outreach");
    expect(body["Metadata"]).toEqual({ campaign: "kappers-q2" });
    expect(body["TrackOpens"]).toBe(false);

    const customHeaders = body["Headers"] as Array<{ Name: string; Value: string }>;
    const names = customHeaders.map((h) => h.Name);
    expect(names).toContain("In-Reply-To");
    expect(names).toContain("References");
    expect(names).toContain("List-Unsubscribe");
    expect(names).toContain("List-Unsubscribe-Post");
  });

  it("throws on Postmark ErrorCode != 0", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          MessageID: "",
          ErrorCode: 406,
          Message: "Inactive recipient",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const mailer = new PostmarkMailer({
      serverToken: "tok",
      from: "me@agency.nl",
      fetchImpl,
    });
    await expect(
      mailer.send({ to: "x@y.z", subject: "s", text: "b" }),
    ).rejects.toThrow(/Inactive recipient/);
  });
});
