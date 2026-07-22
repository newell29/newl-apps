import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SECURE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/server/auth/constants";

/**
 * Lightweight, edge-safe route protection. This only checks for the presence of
 * a session cookie and redirects accordingly — it does NOT validate the session
 * against the database (that requires the Node runtime and happens in the
 * (authenticated) layout via getAuthenticatedContext). This keeps middleware
 * fast and avoids importing Prisma/Auth.js into the edge runtime.
 *
 * Exemptions are handled by the matcher below (auth + ingestion APIs and static
 * assets never reach this function).
 */
export function middleware(request: NextRequest) {
  const { nextUrl } = request;
  const hasSession = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME) ?? request.cookies.get(SECURE_SESSION_COOKIE_NAME)
  );

  if (nextUrl.pathname === "/login") {
    // Do not bounce /login based only on cookie presence. A stale or invalid
    // session cookie must still allow the user to reach the login page,
    // otherwise /login <-> /dashboard can loop forever.
    return NextResponse.next();
  }

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Run on everything except:
   *  - /api/auth/*                       (Auth.js + dev login)
   *  - /api/integrations/trademining/*   (machine-to-machine ingestion auth)
   *  - /api/assistant/teamship/read      (OpenClaw Teamship token auth)
   *  - /api/assistant/openclaw/unresolved-turns
   *                                      (OpenClaw assistant token + Teams identity auth)
   *  - /api/assistant/garland/*          (OpenClaw assistant token + Teams identity auth)
   *  - /api/assistant/teamship/browser-jobs/*
   *                                      (Mac Mini Teamship browser worker token auth)
   *  - /api/assistant/printing/*          (OpenClaw print + local print-worker token auth)
   *  - /api/shipment-documents/teamship-review/update-jobs/agent/*
   *                                      (VM Teamship worker ingestion auth)
   *  - /api/shipment-documents/teamship-review/email-intake/scheduled
   *                                      (n8n Garland email intake ingestion auth)
   *  - /api/website-inbound              (website form ingestion auth)
   *  - Next.js internals and static files
   */
  matcher: [
    "/((?!api/auth|api/integrations/trademining|api/assistant/teamship/read|api/assistant/openclaw/unresolved-turns|api/assistant/teamship/browser-jobs|api/assistant/printing|api/assistant/garland|api/shipment-documents/teamship-review/update-jobs/agent|api/shipment-documents/teamship-review/email-intake/scheduled|api/website-inbound|_next/static|_next/image|favicon.ico|.*\\..*).*)"
  ]
};
