import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  Prisma
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

/**
 * Shared identity-approval invariants used by both automatic approval
 * (proposeIdentityMatch) and manual approval (reviewIdentityMatch) so the two
 * paths enforce the same rules where practical.
 *
 * Difference between paths: an automatic proposal DEFERS to PROPOSED when the
 * canonical company is missing or a conflicting approval exists (the ingestion
 * review workflow), while manual approval REJECTS the same situations with a
 * clear validation error.
 */

export type IdentityTargetInput = {
  companyId: string | null;
  operatingCompanyId?: string | null;
  candidateCompanyId?: string | null;
};

type IdentityApprovalClient = Pick<
  Prisma.TransactionClient,
  "company" | "operatingCompany" | "customerIdentityMatch"
>;

/**
 * Validates that every referenced canonical company (target, candidate, and
 * operating company) exists within the authenticated tenant. Cross-tenant
 * references are rejected. Nullable company references are allowed here
 * because PROPOSED matches may not yet have a canonical target.
 */
export async function validateReferencedCompanies(
  ctx: AuthenticatedContext,
  input: IdentityTargetInput,
  client: IdentityApprovalClient = prisma
): Promise<void> {
  if (input.companyId) {
    const company = await client.company.findFirst({
      where: tenantWhere(ctx, { id: input.companyId })
    });
    if (!company) {
      throw new Error("Company does not exist in this tenant.");
    }
  }
  if (input.candidateCompanyId) {
    const candidate = await client.company.findFirst({
      where: tenantWhere(ctx, { id: input.candidateCompanyId })
    });
    if (!candidate) {
      throw new Error("Candidate company does not exist in this tenant.");
    }
  }
  if (input.operatingCompanyId) {
    const operatingCompany = await client.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: input.operatingCompanyId })
    });
    if (!operatingCompany) {
      throw new Error("Operating company does not exist in this tenant.");
    }
  }
}

/**
 * The full approval invariant: a canonical company is required, a
 * QUICKBOOKS_ACCOUNT approval requires an operating company, and every
 * referenced company must belong to the tenant. Throws on violation.
 */
export async function assertCanApproveIdentityMatch(
  ctx: AuthenticatedContext,
  input: IdentityTargetInput & { kind: CustomerIdentityMatchKind },
  client: IdentityApprovalClient = prisma
): Promise<void> {
  if (!input.companyId) {
    throw new Error("Cannot approve an identity match without a canonical company.");
  }
  if (
    input.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT &&
    !input.operatingCompanyId
  ) {
    throw new Error("operatingCompanyId is required for QUICKBOOKS_ACCOUNT identity matches.");
  }
  await validateReferencedCompanies(ctx, input, client);
}

/**
 * Finds an existing APPROVED match for the same kind/source record that points
 * at a different canonical company. `selfId` excludes the match currently being
 * reviewed/updated from the conflict lookup.
 */
export async function findApprovedConflict(
  ctx: AuthenticatedContext,
  input: {
    kind: CustomerIdentityMatchKind;
    sourceRecordKey: string | null;
    companyId: string;
    selfId?: string;
  },
  client: IdentityApprovalClient = prisma
) {
  if (!input.sourceRecordKey) {
    return null;
  }
  return client.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, {
      kind: input.kind,
      sourceRecordKey: input.sourceRecordKey,
      status: CustomerIdentityMatchStatus.APPROVED,
      ...(input.selfId ? { id: { not: input.selfId } } : {}),
      companyId: { not: input.companyId }
    })
  });
}
