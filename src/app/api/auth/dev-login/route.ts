import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import {
  SESSION_COOKIE_NAME,
  getSessionMaxAgeSeconds,
  isDevLoginEnabled
} from "@/server/auth/constants";
import { verifyPassword } from "@/server/auth/password";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY local login. This exists solely so the app is runnable and testable
 * locally without real Microsoft Entra ID credentials. It is gated behind
 * AUTH_DEV_BYPASS=true and is impossible to enable when NODE_ENV==="production".
 *
 * It creates a real Auth.js database Session row and sets the standard session
 * cookie, so the rest of the app uses a single (database) session strategy for
 * both this path and production SSO.
 */
export async function POST(request: Request) {
  if (!isDevLoginEnabled()) {
    return NextResponse.json({ error: "Dev login is disabled." }, { status: 404 });
  }

  console.warn(
    "\n[auth] ⚠️  DEV LOGIN BYPASS ACTIVE — AUTH_DEV_BYPASS=true. This must NEVER be enabled in production.\n"
  );

  const formData = await request.formData();
  const email = readString(formData, "email")?.toLowerCase();
  const password = readString(formData, "password");
  const callbackUrl = sanitizeCallbackUrl(readString(formData, "callbackUrl"));

  const loginUrl = new URL("/login", request.url);
  if (callbackUrl !== "/dashboard") {
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
  }

  if (!email || !password) {
    loginUrl.searchParams.set("error", "missing_credentials");
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      _count: { select: { memberships: true } }
    }
  });

  // Validate password and that the user is provisioned into at least one tenant.
  if (!user || !user.passwordHash || user._count.memberships === 0) {
    loginUrl.searchParams.set("error", "invalid_credentials");
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    loginUrl.searchParams.set("error", "invalid_credentials");
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const maxAgeSeconds = getSessionMaxAgeSeconds();
  const expires = new Date(Date.now() + maxAgeSeconds * 1000);
  const sessionToken = crypto.randomUUID() + crypto.randomBytes(16).toString("hex");

  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires
    }
  });

  const response = NextResponse.redirect(new URL(callbackUrl, request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
    expires
  });

  return response;
}

function readString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.trim();
}

// Only allow same-origin relative paths to prevent open-redirect abuse.
function sanitizeCallbackUrl(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}
