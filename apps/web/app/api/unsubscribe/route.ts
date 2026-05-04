import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { contacts, getDb, unsubscribes } from "@outreach/db";
import { verifyUnsubscribeToken } from "@outreach/templates";

export const runtime = "nodejs";

/**
 * POST handler for one-click unsubscribe (RFC 8058 List-Unsubscribe-Post).
 * Postmark, Gmail, etc. POST to this URL when the user clicks the
 * one-click unsubscribe button.
 */
export async function POST(req: Request) {
  return doUnsubscribe(req, "POST");
}

/**
 * GET handler for the human-clickable link in the email body.
 */
export async function GET(req: Request) {
  return doUnsubscribe(req, "GET");
}

async function doUnsubscribe(req: Request, method: "GET" | "POST") {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const secret = process.env["UNSUBSCRIBE_SECRET"];

  if (!secret) {
    return NextResponse.json(
      { error: "service unavailable" },
      { status: 503 },
    );
  }
  if (!token) {
    return method === "POST"
      ? NextResponse.json({ error: "missing token" }, { status: 400 })
      : html(
          400,
          "Ongeldige link",
          "Deze afmeldlink mist een token.",
        );
  }

  const result = verifyUnsubscribeToken(token, secret);
  if (!result.valid) {
    return method === "POST"
      ? NextResponse.json({ error: "invalid token" }, { status: 400 })
      : html(
          400,
          "Ongeldige link",
          "We konden deze afmeldlink niet verifiëren.",
        );
  }

  const db = getDb();
  await db
    .insert(unsubscribes)
    .values({
      email: result.email,
      unsubscribedAt: new Date(),
      reason: "user_clicked",
    })
    .onConflictDoNothing({ target: unsubscribes.email });

  await db
    .update(contacts)
    .set({ doNotContact: true })
    .where(eq(contacts.email, result.email));

  if (method === "POST") return NextResponse.json({ ok: true });
  return html(
    200,
    "Afgemeld",
    `<strong>${escapeHtml(result.email)}</strong> ontvangt geen mails meer van ons.`,
  );
}

function html(status: number, title: string, body: string) {
  return new NextResponse(
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title>
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 1.5rem;color:#222} h1{font-size:1.4rem}</style>
     </head><body><h1>${title}</h1><p>${body}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
