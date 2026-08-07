import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import {
  buildQuickBooksCredentialRecord,
  encryptQuickBooksSecret,
  exchangeQuickBooksAuthorizationCode,
  fetchQuickBooksCompanyInfo,
  getQuickBooksEnvironment,
  parseQuickBooksState,
  quickBooksSlugToLegalEntity
} from "@/server/integrations/quickbooks";

function buildSettingsQuickBooksRedirect(
  callbackBase: string,
  params: Record<string, string>,
  returnTo = "/settings"
) {
  const url = new URL(returnTo, callbackBase);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  url.hash = "quickbooks";
  return url;
}

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
        buildSettingsQuickBooksRedirect(callbackBase, {
          quickbooks: "error",
          reason: oauthError
        }),
        { status: 302 }
      );
    }

    if (!code || !realmId || !state) {
      return NextResponse.redirect(
        buildSettingsQuickBooksRedirect(callbackBase, {
          quickbooks: "error",
          reason: "missing-callback-params"
        }),
        { status: 302 }
      );
    }

    const parsedState = parseQuickBooksState(state);
    if (parsedState.tenantId !== context.tenantId) {
      return NextResponse.redirect(
        buildSettingsQuickBooksRedirect(callbackBase, {
          quickbooks: "error",
          reason: "tenant-mismatch"
        }),
        { status: 302 }
      );
    }

    // The state carries the stable operating-company slug (CP-02B-1-Q1); the
    // legacy legalEntity key is derived only to keep stored credentials and the
    // invoice-automation reader compatible with the two existing connections.
    const legalEntity = quickBooksSlugToLegalEntity(parsedState.operatingCompanySlug);
    if (!legalEntity) {
      return NextResponse.redirect(
        buildSettingsQuickBooksRedirect(callbackBase, {
          quickbooks: "error",
          reason: "invalid-operating-company"
        }),
        { status: 302 }
      );
    }

    const tokenSet = await exchangeQuickBooksAuthorizationCode({ code, realmId });
    const companyInfo = await fetchQuickBooksCompanyInfo({
      realmId,
      accessToken: tokenSet.accessToken
    });
    const credential = buildQuickBooksCredentialRecord({
      legalEntity,
      realmId,
      environment: getQuickBooksEnvironment(),
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
      buildSettingsQuickBooksRedirect(
        callbackBase,
        {
          quickbooks: "connected",
          entity: parsedState.operatingCompanySlug
        },
        parsedState.returnTo
      ),
      { status: 302 }
    );
  } catch (error) {
    return NextResponse.redirect(
      buildSettingsQuickBooksRedirect(callbackBase, {
        quickbooks: "error",
        reason: error instanceof Error ? error.message : "callback-failed"
      }),
      { status: 302 }
    );
  }
}
