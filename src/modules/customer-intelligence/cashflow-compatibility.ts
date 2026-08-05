import { CashflowLegalEntity } from "@prisma/client";

import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

/**
 * Additive transition from the legacy two-company finance enum to tenant-scoped
 * OperatingCompany records. CashflowLegalEntity is preserved and its existing
 * CashflowCustomer rows are not rewritten by the Customer Intelligence
 * foundation. New Customer Intelligence records resolve the operating company
 * through these slugs; a later reviewed migration may backfill
 * CompanyOperatingRelationship rows from CashflowCustomer.legalEntity.
 */
export function cashflowLegalEntityToOperatingCompanySlug(
  legalEntity: CashflowLegalEntity
): string {
  switch (legalEntity) {
    case CashflowLegalEntity.NEWL_WORLDWIDE:
      return "newl-worldwide";
    case CashflowLegalEntity.NEWL_USA:
      return "newl-usa";
  }
}

/** Tenant-scoped lookup of the OperatingCompany that maps to a legacy legal entity. */
export async function resolveOperatingCompanyForLegalEntity(
  tenant: TenantContext,
  legalEntity: CashflowLegalEntity
) {
  const slug = cashflowLegalEntityToOperatingCompanySlug(legalEntity);
  return prisma.operatingCompany.findFirst({
    where: tenantWhere(tenant, { slug })
  });
}
