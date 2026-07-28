"use server";

import { createHash } from "node:crypto";
import {
  HunterAutomationMode,
  HunterServiceLine,
  HunterSignalStatus,
  HunterSignalType,
  ModuleKey
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  enqueueHunterCompanyOutreachHandoff,
  processNextHunterOutreachHandoff,
  queueCurrentHunterOutreachHandoff
} from "@/modules/lead-gen/hunter-outreach-handoff";
import { normalizeHunterCompanyKey } from "@/modules/lead-gen/hunter-company-key";
import { runHunterDryPlan } from "@/modules/lead-gen/hunter-planner";
import { validateHunterAllocation } from "@/modules/lead-gen/hunter-planning-policy";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

const HUNTER_PATH = "/lead-gen/hunter";
const HUNTER_SETTINGS_PATH = "/lead-gen/automation-settings";

export async function saveHunterPolicyAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  requireAdmin(context);

  const mode = parseHunterMode(formData.get("mode"));
  const allocation = {
    [HunterServiceLine.WAREHOUSING]: parseBoundedInteger(formData, "warehousingPercent", 0, 100),
    [HunterServiceLine.OCEAN_AIR]: parseBoundedInteger(formData, "oceanAirPercent", 0, 100),
    [HunterServiceLine.TRUCKING]: parseBoundedInteger(formData, "truckingPercent", 0, 100)
  };
  validateHunterAllocation(allocation);
  const data = {
    mode,
    killSwitch: formData.get("killSwitch") === "on",
    dailyCompanyLimit: parseBoundedInteger(formData, "dailyCompanyLimit", 1, 100),
    maxContactsPerCompany: parseBoundedInteger(formData, "maxContactsPerCompany", 1, 3),
    warehousingPercent: allocation[HunterServiceLine.WAREHOUSING],
    oceanAirPercent: allocation[HunterServiceLine.OCEAN_AIR],
    truckingPercent: allocation[HunterServiceLine.TRUCKING],
    minimumPriorityScore: parseBoundedInteger(formData, "minimumPriorityScore", 0, 100),
    minimumSignalConfidence: parseBoundedInteger(formData, "minimumSignalConfidence", 0, 100),
    scheduleTimezone: parseTimeZone(requiredText(formData, "scheduleTimezone", 100))
  };

  await prisma.$transaction([
    prisma.hunterAutomationPolicy.upsert({
      where: { tenantId: context.tenantId },
      create: { tenantId: context.tenantId, ...data },
      update: data
    }),
    prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "lead-gen.hunter-policy.updated",
        entityType: "HunterAutomationPolicy",
        entityId: context.tenantId,
        after: data
      }
    })
  ]);
  revalidatePath(HUNTER_PATH);
}

export async function addHunterOpportunitySignalAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  await requireMutationAccess(context);

  const companyName = requiredText(formData, "companyName", 200);
  const normalizedCompanyName = normalizeHunterCompanyKey(companyName);
  if (!normalizedCompanyName) {
    throw new Error("Enter a recognizable company name.");
  }
  const title = requiredText(formData, "title", 300);
  const summary = requiredText(formData, "summary", 2_000);
  const signalType = parseEnum(formData.get("signalType"), HunterSignalType, "signal type");
  const serviceLine = parseEnum(formData.get("serviceLine"), HunterServiceLine, "service line");
  const sourceUrl = optionalUrl(formData.get("sourceUrl"));
  const sourceName = optionalText(formData.get("sourceName"), 200);
  const geography = optionalText(formData.get("geography"), 200);
  const confidence = parseBoundedInteger(formData, "confidence", 0, 100);
  const dedupeKey = createHash("sha256")
    .update([normalizedCompanyName, signalType, title.toLowerCase(), sourceUrl ?? ""].join("|"))
    .digest("hex");
  const company = await prisma.company.findUnique({
    where: {
      tenantId_normalizedName: {
        tenantId: context.tenantId,
        normalizedName: normalizedCompanyName
      }
    },
    select: { id: true }
  });

  const signal = await prisma.hunterOpportunitySignal.upsert({
    where: {
      tenantId_dedupeKey: {
        tenantId: context.tenantId,
        dedupeKey
      }
    },
    create: {
      tenantId: context.tenantId,
      companyId: company?.id,
      companyName,
      normalizedCompanyName,
      signalType,
      serviceLine,
      status: HunterSignalStatus.NEW,
      title,
      summary,
      geography,
      sourceName,
      sourceUrl,
      confidence,
      dedupeKey,
      createdByUserId: context.userId
    },
    update: {
      companyId: company?.id,
      companyName,
      serviceLine,
      status: HunterSignalStatus.ACTIVE,
      summary,
      geography,
      sourceName,
      sourceUrl,
      confidence,
      observedAt: new Date()
    },
    select: { id: true }
  });
  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "lead-gen.hunter-signal.upserted",
      entityType: "HunterOpportunitySignal",
      entityId: signal.id,
      after: { companyName, signalType, serviceLine, confidence, sourceUrl }
    }
  });
  revalidatePath(HUNTER_PATH);
}

export async function runHunterDryPlanAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  await requireMutationAccess(context);
  await runHunterDryPlan({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    trigger: "MANUAL"
  });
  revalidatePath(HUNTER_PATH);
}

export async function queueCurrentHunterOutreachHandoffAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  requireAdmin(context);

  const result = await queueCurrentHunterOutreachHandoff({
    tenantId: context.tenantId,
    actorUserId: context.userId
  });
  revalidatePath(HUNTER_PATH);
  revalidatePath(HUNTER_SETTINGS_PATH);
  revalidatePath("/lead-gen/outreach");

  const count = "companyCount" in result ? `&count=${result.companyCount}` : "";
  redirect(`${HUNTER_SETTINGS_PATH}?handoff=${encodeURIComponent(result.state)}${count}`);
}

export async function recheckHunterCompanyContactsAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  requireAdmin(context);
  const companyId = requiredText(formData, "companyId", 100);

  const queued = await enqueueHunterCompanyOutreachHandoff({
    tenantId: context.tenantId,
    companyId,
    forceContactReview: true
  });
  let message: string =
    "message" in queued
      ? queued.message ?? "Hunter could not queue contact review for this company."
      : queued.state === "already_queued"
        ? "Hunter contact review is already queued for this company."
        : "Hunter contact review was queued.";

  if (queued.state === "queued") {
    const processed = await processNextHunterOutreachHandoff({
      tenantId: context.tenantId,
      runId: queued.runId
    });
    const result = "result" in processed ? processed.result : null;
    if (result) {
      message =
        `${result.apolloContactsFound} Apollo employee${result.apolloContactsFound === 1 ? "" : "s"} found; ` +
        `${result.contactsRanked} evaluated; ${result.actionablePlans} QA-passed plan${result.actionablePlans === 1 ? "" : "s"} ready. ` +
        `Hunter selected no more than three contacts. ${result.message}`;
    } else if (processed.state === "retry_scheduled") {
      message = "Apollo or model review was temporarily unavailable. Hunter queued a protected retry.";
    }
  }

  revalidatePath(HUNTER_PATH);
  revalidatePath(HUNTER_SETTINGS_PATH);
  revalidatePath("/lead-gen/apollo-review");
  revalidatePath("/lead-gen/outreach");
  redirect(
    `/lead-gen/outreach?company=${encodeURIComponent(companyId)}&contactReview=${encodeURIComponent(message)}`
  );
}

function parseHunterMode(value: FormDataEntryValue | null) {
  if (value === HunterAutomationMode.OFF) return HunterAutomationMode.OFF;
  if (value === HunterAutomationMode.DRY_RUN) return HunterAutomationMode.DRY_RUN;
  if (value === HunterAutomationMode.ASSISTED) return HunterAutomationMode.ASSISTED;
  throw new Error("Select OFF, DRY_RUN, or ASSISTED.");
}

function parseBoundedInteger(formData: FormData, key: string, minimum: number, maximum: number) {
  const value = Number(formData.get(key));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requiredText(formData: FormData, key: string, maximumLength: number) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maximumLength) {
    throw new Error(`${key} is required and must be ${maximumLength} characters or fewer.`);
  }
  return value;
}

function optionalText(value: FormDataEntryValue | null, maximumLength: number) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > maximumLength) {
    throw new Error(`Optional text must be ${maximumLength} characters or fewer.`);
  }
  return normalized;
}

function optionalUrl(value: FormDataEntryValue | null) {
  const normalized = optionalText(value, 2_000);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Source URL must use http or https.");
  }
  return url.toString();
}

function parseEnum<T extends string>(
  value: FormDataEntryValue | null,
  values: Record<string, T>,
  label: string
) {
  if (typeof value !== "string" || !Object.values(values).includes(value as T)) {
    throw new Error(`Select a valid ${label}.`);
  }
  return value as T;
}

function parseTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error("Select a valid IANA timezone, such as America/Toronto.");
  }
}
