import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import {
  buildQuickBooksCredentialRecord,
  encryptQuickBooksSecret,
  exchangeQuickBooksAuthorizationCode,
  fetchQuickBooksCompanyInfo,
  parseQuickBooksState
} from "@/server/integrations/quickbooks";

export async function GET(request: Request) {
  const callbackBase = process.env.AUTH_URL ?? new URL(request.url).origin;

  try {
    const context = await getAuthenticatedContext();
    requireAdmin(context);

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      return NextResponse.redirect(
        new URL(`/settings?quickbooks=error&reason=${encodeURIComponent(oauthError)}#quickbooks`, callbackBase)
      );
    }

    if (!code || !realmId || !state) {
      return NextResponse.redirect(
        new URL("/settings?quickbooks=error&reason=missing-callback-params#quickbooks", callbackBase)
      );
    }

    const parsedState = parseQuickBooksState(state);
    if (parsedState.tenantId !== context.tenantId) {
      return NextResponse.redirect(
        new URL("/settings?quickbooks=error&reason=tenant-mismatch#quickbooks", callbackBase)
      );
    }

    const tokenSet = await exchangeQuickBooksAuthorizationCode({ code, realmId });
    const companyInfo = await fetchQuickBooksCompanyInfo({
      realmId,
      accessToken: tokenSet.accessToken
    });
    const credential = buildQuickBooksCredentialRecord({
      legalEntity: parsedState.legalEntity,
      realmId,
      environment: process.env.QUICKBOOKS_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
      companyName: companyInfo.companyName,
      accessTokenExpiresAt: tokenSet.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokenSet.refreshTokenExpiresAt,
      connectedAt: new Date().toISOString(),
      scopes: ["com.intuit.quickbooks.accounting"]
    });
    const secretRef = encryptQuickBooksSecret({
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      tokenType: tokenSet.tokenType,
      realmId
    });
    const existing = await prisma.integrationCredential.findFirst({
      where: {
        tenantId: context.tenantId,
        provider: credential.provider,
        name: credential.name
      },
      select: {
        id: true
      }
    });

    if (existing) {
      await prisma.integrationCredential.update({
        where: {
          id: existing.id
        },
        data: {
          status: credential.status,
          publicConfig: credential.publicConfig,
          secretRef
        }
      });
    } else {
      await prisma.integrationCredential.create({
        data: {
          tenantId: context.tenantId,
          provider: credential.provider,
          name: credential.name,
          status: credential.status,
          publicConfig: credential.publicConfig,
          secretRef
        }
      });
    }

    return NextResponse.redirect(
      new URL(
        `${parsedState.returnTo}?quickbooks=connected&entity=${encodeURIComponent(parsedState.legalEntity)}#quickbooks`,
        callbackBase
      )
    );
  } catch (error) {
    return NextResponse.redirect(
      new URL(
        `/settings?quickbooks=error&reason=${encodeURIComponent(error instanceof Error ? error.message : "callback-failed")}#quickbooks`,
        callbackBase
      )
    );
  }
}
