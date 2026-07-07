import { NextResponse, type NextRequest } from "next/server";

import { handlers } from "@/server/auth";
import { isMicrosoftEntraConfigured } from "@/server/auth/constants";

export function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/signin/microsoft-entra-id" && !isMicrosoftEntraConfigured()) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Configuration");
    return NextResponse.redirect(loginUrl);
  }

  return handlers.GET(request);
}

export const { POST } = handlers;
