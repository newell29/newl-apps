"use server";

import {
  CashflowBillingTrigger,
  CashflowCustomerTier,
  CashflowFollowUpStatus,
  ModuleKey,
  PlatformRole
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

async function authorizeCashflowMutation() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  await requireMutationAccess(context);
  return context;
}

export async function saveCashflowThresholdsAction(formData: FormData) {
  const context = await authorizeCashflowMutation();
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

  await prisma.cashflowSettings.upsert({
    where: { tenantId: context.tenantId },
    update: {
      goodGrossMarginPercent: readNumber(formData, "goodGrossMarginPercent"),
      lowMarginWarningPercent: readNumber(formData, "lowMarginWarningPercent"),
      negativeMarginCriticalPercent: readNumber(formData, "negativeMarginCriticalPercent"),
      collectionWarningDaysBeyondTerms: readInt(formData, "collectionWarningDaysBeyondTerms"),
      highExposureWarningPercent: readNumber(formData, "highExposureWarningPercent"),
      creditBreachPercent: readNumber(formData, "creditBreachPercent"),
      costNotBilledBusinessDays: readInt(formData, "costNotBilledBusinessDays"),
      deliveredNotBilledBusinessDays: readInt(formData, "deliveredNotBilledBusinessDays"),
      defaultBillingTrigger: readBillingTrigger(formData, "defaultBillingTrigger"),
      notes: readOptional(formData, "notes")
    },
    create: {
      tenantId: context.tenantId,
      goodGrossMarginPercent: readNumber(formData, "goodGrossMarginPercent"),
      lowMarginWarningPercent: readNumber(formData, "lowMarginWarningPercent"),
      negativeMarginCriticalPercent: readNumber(formData, "negativeMarginCriticalPercent"),
      collectionWarningDaysBeyondTerms: readInt(formData, "collectionWarningDaysBeyondTerms"),
      highExposureWarningPercent: readNumber(formData, "highExposureWarningPercent"),
      creditBreachPercent: readNumber(formData, "creditBreachPercent"),
      costNotBilledBusinessDays: readInt(formData, "costNotBilledBusinessDays"),
      deliveredNotBilledBusinessDays: readInt(formData, "deliveredNotBilledBusinessDays"),
      defaultBillingTrigger: readBillingTrigger(formData, "defaultBillingTrigger"),
      notes: readOptional(formData, "notes")
    }
  });

  revalidateCashflow();
}

export async function saveCustomerCreditSettingsAction(formData: FormData) {
  const context = await authorizeCashflowMutation();
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);
  const customerId = readRequired(formData, "customerId");

  await prisma.cashflowCustomer.update({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: customerId
      }
    },
    data: {
      customerTermsDays: readInt(formData, "customerTermsDays"),
      creditLimit: readNumber(formData, "creditLimit"),
      alertThresholdPercent: readNumber(formData, "alertThresholdPercent"),
      billingTrigger: readBillingTrigger(formData, "billingTrigger"),
      vendorPaymentTrigger: readBillingTrigger(formData, "vendorPaymentTrigger"),
      requiresApprovalOverLimit: formData.get("requiresApprovalOverLimit") === "true",
      customerTier: readCustomerTier(formData, "customerTier"),
      assignedSalesRep: readOptional(formData, "assignedSalesRep"),
      assignedCollectionsOwner: readOptional(formData, "assignedCollectionsOwner"),
      notes: readOptional(formData, "notes")
    }
  });

  revalidateCashflow();
  revalidatePath(`/finance/customer-cashflow/customers/${customerId}`);
}

export async function addCashflowFollowUpAction(formData: FormData) {
  const context = await authorizeCashflowMutation();
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE, PlatformRole.OPERATIONS]);
  const customerId = readRequired(formData, "customerId");
  const invoiceId = readOptional(formData, "invoiceId");
  const fileId = readOptional(formData, "fileId");

  await prisma.cashflowFollowUp.create({
    data: {
      tenantId: context.tenantId,
      customerId,
      invoiceId,
      fileId,
      status: readFollowUpStatus(formData, "status"),
      note: readRequired(formData, "note"),
      nextFollowUpDate: readDate(formData, "nextFollowUpDate"),
      promisedPaymentDate: readDate(formData, "promisedPaymentDate"),
      escalatedTo: readOptional(formData, "escalatedTo"),
      createdByUserId: context.userId
    }
  });

  revalidateCashflow();
  revalidatePath(`/finance/customer-cashflow/customers/${customerId}`);
}

function revalidateCashflow() {
  revalidatePath("/finance/customer-cashflow");
  revalidatePath("/finance/customer-cashflow/summary");
  revalidatePath("/finance/customer-cashflow/files");
  revalidatePath("/finance/customer-cashflow/collections");
  revalidatePath("/finance/customer-cashflow/settings");
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

function readNumber(formData: FormData, key: string) {
  const value = Number(readRequired(formData, key));
  if (!Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`);
  }

  return value;
}

function readInt(formData: FormData, key: string) {
  return Math.trunc(readNumber(formData, key));
}

function readDate(formData: FormData, key: string) {
  const value = readOptional(formData, key);
  return value ? new Date(`${value}T00:00:00`) : null;
}

function readBillingTrigger(formData: FormData, key: string) {
  const value = readRequired(formData, key);
  if (!Object.values(CashflowBillingTrigger).includes(value as CashflowBillingTrigger)) {
    throw new Error("Select a valid billing trigger.");
  }

  return value as CashflowBillingTrigger;
}

function readCustomerTier(formData: FormData, key: string) {
  const value = readRequired(formData, key);
  if (!Object.values(CashflowCustomerTier).includes(value as CashflowCustomerTier)) {
    throw new Error("Select a valid customer tier.");
  }

  return value as CashflowCustomerTier;
}

function readFollowUpStatus(formData: FormData, key: string) {
  const value = readRequired(formData, key);
  if (!Object.values(CashflowFollowUpStatus).includes(value as CashflowFollowUpStatus)) {
    throw new Error("Select a valid follow-up status.");
  }

  return value as CashflowFollowUpStatus;
}
