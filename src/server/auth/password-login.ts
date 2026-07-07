import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import {
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getSessionMaxAgeSeconds,
  isDevLoginEnabled,
  isLocalPasswordLoginFallbackEnabled,
  isPasswordLoginEnabled,
  isTemporaryPasswordLoginEnabled
} from "@/server/auth/constants";
import { verifyPassword } from "@/server/auth/password";

export async function handlePasswordLogin(request: Request) {
  if (!isPasswordLoginEnabled()) {
    return NextResponse.json({ error: "Password login is disabled." }, { status: 404 });
  }

  if (isDevLoginEnabled()) {
    console.warn("\n[auth] DEV LOGIN BYPASS ACTIVE - AUTH_DEV_BYPASS=true. Do not enable this in production.\n");
  } else if (isLocalPasswordLoginFallbackEnabled()) {
    console.warn("\n[auth] LOCAL PASSWORD LOGIN ACTIVE - Microsoft Entra SSO is not configured.\n");
  } else if (isTemporaryPasswordLoginEnabled()) {
    console.warn("\n[auth] TEMP PASSWORD LOGIN ACTIVE - use only while Microsoft Entra SSO is being configured.\n");
  }

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

  const secureCookie = shouldUseSecureCookie(request);
  const response = NextResponse.redirect(new URL(callbackUrl, request.url), { status: 303 });
  response.cookies.set(secureCookie ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookie,
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

function sanitizeCallbackUrl(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

function shouldUseSecureCookie(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  return process.env.NODE_ENV === "production" || forwardedProto === "https" || new URL(request.url).protocol === "https:";
}
