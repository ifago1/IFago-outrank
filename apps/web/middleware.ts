import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic Auth voor het dashboard. Alleen actief als
 * DASHBOARD_AUTH_USER + DASHBOARD_AUTH_PASS in de env staan; anders is
 * het dashboard open (handig voor lokale dev).
 *
 * Webhooks en de unsubscribe-link skippen we expliciet — die hebben hun
 * eigen auth (Bearer-secret resp. HMAC-token).
 */

const PUBLIC_PREFIXES = [
  "/api/webhooks/",
  "/api/unsubscribe",
  "/_next/",
  "/favicon.ico",
];

export function middleware(req: NextRequest) {
  const user = process.env["DASHBOARD_AUTH_USER"];
  const pass = process.env["DASHBOARD_AUTH_PASS"];
  if (!user || !pass) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization") ?? "";
  const expected =
    "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");

  if (!safeEqual(auth, expected)) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Outreach Dashboard", charset="UTF-8"',
      },
    });
  }
  return NextResponse.next();
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export const config = {
  // Run on every path except Next internals; we still skip webhooks/unsub
  // explicitly inside the function so the matcher stays simple.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
