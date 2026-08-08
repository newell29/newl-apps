import { IntegrationProvider, IntegrationStatus, Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { AuthenticatedContext } from "@/server/tenant-context";
import {
  QUICKBOOKS_OPERATING_COMPANY_SLUGS,
  quickBooksLegalEntityToSlug,
  type QuickBooksOperatingCompanySlug
} from "@/server/integrations/quickbooks";

export type ExistingQuickBooksAssociationStatus =
  | "ASSOCIATED"
  | "AVAILABLE"
  | "MISSING_CONNECTION"
  | "MISSING_OPERATING_COMPANY"
  | "AMBIGUOUS"
  | "CONFLICT";

export type ExistingQuickBooksAssociationOption = {
  operatingCompanyId: string | null;
  operatingCompanySlug: QuickBooksOperatingCompanySlug;
  status: ExistingQuickBooksAssociationStatus;
  companyName: string | null;
  environment: string | null;
};

type Candidate = {
  id: string;
  realmId: string;
  companyName: string | null;
  environment: string | null;
};

type ResolvedAssociation = ExistingQuickBooksAssociationOption & {
  candidate: Candidate | null;
};

function readString(config: Prisma.JsonValue | null, key: string): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Finds only exact, tenant-owned legacy QuickBooks connections. The selected
 * credential ID and realm remain server-only so the browser cannot nominate a
 * different credential. No token or secret value is selected or returned.
 */
export async function resolveExistingQuickBooksAssociations(
  ctx: AuthenticatedContext
): Promise<ResolvedAssociation[]> {
  const [operatingCompanies, credentials] = await Promise.all([
    prisma.operatingCompany.findMany({
      where: tenantWhere(ctx, { slug: { in: [...QUICKBOOKS_OPERATING_COMPANY_SLUGS] } }),
      select: {
        id: true,
        slug: true,
        quickBooksCredentialId: true,
        quickBooksRealmId: true
      }
    }),
    prisma.integrationCredential.findMany({
      where: tenantWhere(ctx, {
        provider: IntegrationProvider.QUICKBOOKS,
        status: IntegrationStatus.ACTIVE,
        secretRef: { not: null }
      }),
      select: { id: true, publicConfig: true }
    })
  ]);

  const candidatesBySlug = new Map<QuickBooksOperatingCompanySlug, Candidate[]>();
  for (const credential of credentials) {
    const legalEntity = readString(credential.publicConfig, "legalEntity");
    const slug = legalEntity ? quickBooksLegalEntityToSlug(legalEntity) : null;
    const realmId = readString(credential.publicConfig, "realmId");
    if (!slug || !realmId) continue;
    const candidates = candidatesBySlug.get(slug) ?? [];
    candidates.push({
      id: credential.id,
      realmId,
      companyName: readString(credential.publicConfig, "companyName"),
      environment: readString(credential.publicConfig, "environment")
    });
    candidatesBySlug.set(slug, candidates);
  }

  return QUICKBOOKS_OPERATING_COMPANY_SLUGS.map((slug) => {
    const operatingCompany = operatingCompanies.find((company) => company.slug === slug);
    const candidates = candidatesBySlug.get(slug) ?? [];
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const publicBase = {
      operatingCompanyId: operatingCompany?.id ?? null,
      operatingCompanySlug: slug,
      companyName: candidate?.companyName ?? null,
      environment: candidate?.environment ?? null
    };

    if (!operatingCompany) {
      return { ...publicBase, status: "MISSING_OPERATING_COMPANY", candidate: null };
    }
    if (candidates.length > 1) {
      return { ...publicBase, status: "AMBIGUOUS", candidate: null };
    }
    if (!candidate) {
      return { ...publicBase, status: "MISSING_CONNECTION", candidate: null };
    }

    const exactAssociation =
      operatingCompany.quickBooksCredentialId === candidate.id &&
      operatingCompany.quickBooksRealmId === candidate.realmId;
    if (exactAssociation) {
      return { ...publicBase, status: "ASSOCIATED", candidate };
    }

    const hasDifferentAssociation = Boolean(
      operatingCompany.quickBooksCredentialId || operatingCompany.quickBooksRealmId
    );
    const claimedElsewhere = operatingCompanies.some(
      (other) =>
        other.id !== operatingCompany.id &&
        (other.quickBooksCredentialId === candidate.id ||
          other.quickBooksRealmId === candidate.realmId)
    );
    if (hasDifferentAssociation || claimedElsewhere) {
      return { ...publicBase, status: "CONFLICT", candidate: null };
    }

    return { ...publicBase, status: "AVAILABLE", candidate };
  });
}

export async function getExistingQuickBooksAssociationOptions(
  ctx: AuthenticatedContext
): Promise<ExistingQuickBooksAssociationOption[]> {
  const resolved = await resolveExistingQuickBooksAssociations(ctx);
  return resolved.map((option) => ({
    operatingCompanyId: option.operatingCompanyId,
    operatingCompanySlug: option.operatingCompanySlug,
    status: option.status,
    companyName: option.companyName,
    environment: option.environment
  }));
}
