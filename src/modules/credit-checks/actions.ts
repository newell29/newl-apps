"use server";

import { CreditCheckStatus, ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { prisma } from "@/server/db";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function updateCreditCheckAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  await requireMutationAccess(context);
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

  const creditCheckId = readRequired(formData, "creditCheckId");
  const status = readStatus(formData, "status");
  const referencesContacted = formData.get("referencesContacted") === "true";
  const approvedCreditLimit = readOptional(formData, "approvedCreditLimit");

  await prisma.creditCheck.update({
    where: {
      id: creditCheckId,
      tenantId: context.tenantId
    },
    data: {
      status,
      referencesContacted,
      referenceNotes: readOptional(formData, "referenceNotes"),
      internalNotes: readOptional(formData, "internalNotes"),
      approvedCreditLimit,
      reviewedByUserId: context.userId,
      approvedByUserId: status === CreditCheckStatus.APPROVED ? context.userId : null,
      approvedAt: status === CreditCheckStatus.APPROVED ? new Date() : null
    }
  });

  revalidatePath("/finance/credit-checks");
}

function readRequired(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function readOptional(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function readStatus(formData: FormData, key: string) {
  const value = readRequired(formData, key);
  if (!Object.values(CreditCheckStatus).includes(value as CreditCheckStatus)) {
    throw new Error("Select a valid credit check status.");
  }

  return value as CreditCheckStatus;
}
