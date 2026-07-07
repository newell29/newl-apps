"use server";

import { ModuleKey, OceanEquipmentType, OceanRateSourceType, OceanRateStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function requiredText(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}
function dateValue(formData: FormData, key: string) {
  const value = text(formData, key);
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}
function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-");
}
function listValue(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) {
    return Prisma.JsonNull;
  }

  const values = value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? Array.from(new Set(values)) : Prisma.JsonNull;
}
async function authorize() {
  const ctx = await getAuthenticatedContext();
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  await requireMutationAccess(ctx);
  return ctx;
}
async function refreshAgentCounts(tenantId: string, agentId: string) {
  const now = new Date();
  const [activeRateCount, historicalRateCount, lastRate] = await Promise.all([
    prisma.oceanFreightRate.count({ where: { tenantId, agentId, status: OceanRateStatus.ACTIVE, OR: [{ validityEndDate: null }, { validityEndDate: { gte: now } }] } }),
    prisma.oceanFreightRate.count({ where: { tenantId, agentId } }),
    prisma.oceanFreightRate.findFirst({ where: { tenantId, agentId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
  ]);
  await prisma.oceanFreightAgent.update({ where: { tenantId_id: { tenantId, id: agentId } }, data: { activeRateCount, historicalRateCount, lastRateReceivedAt: lastRate?.createdAt ?? null } });
}
function revalidateOceanFreightPricing() {
  revalidatePath("/ocean-freight-pricing");
  revalidatePath("/ocean-freight-pricing/agents");
}

export async function createOceanFreightAgentAction(formData: FormData) {
  const ctx = await authorize();
  const name = requiredText(formData, "agentName");
  const agent = await prisma.oceanFreightAgent.create({
    data: {
      tenantId: ctx.tenantId,
      name,
      normalizedName: normalizeName(name),
      website: text(formData, "website"),
      primaryEmailDomain: text(formData, "primaryEmailDomain"),
      primaryCountry: text(formData, "primaryCountry"),
      countriesServed: listValue(formData, "countriesServed"),
      portsServed: listValue(formData, "portsServed"),
      internalRating: text(formData, "internalRating") ? Number(text(formData, "internalRating")) : null,
      reliabilityNotes: text(formData, "reliabilityNotes"),
      serviceNotes: text(formData, "serviceNotes"),
      internalNotes: text(formData, "internalNotes")
    }
  });
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.agent.created", entityType: "OceanFreightAgent", entityId: agent.id, after: agent } });
  revalidateOceanFreightPricing();
}

export async function updateOceanFreightAgentAction(formData: FormData) {
  const ctx = await authorize();
  const id = requiredText(formData, "agentId");
  const before = await prisma.oceanFreightAgent.findUniqueOrThrow({ where: { tenantId_id: { tenantId: ctx.tenantId, id } } });
  const name = text(formData, "agentName") ?? before.name;
  const after = await prisma.oceanFreightAgent.update({
    where: { tenantId_id: { tenantId: ctx.tenantId, id } },
    data: {
      name,
      normalizedName: normalizeName(name),
      website: text(formData, "website"),
      primaryEmailDomain: text(formData, "primaryEmailDomain"),
      primaryCountry: text(formData, "primaryCountry"),
      countriesServed: listValue(formData, "countriesServed"),
      portsServed: listValue(formData, "portsServed"),
      internalRating: text(formData, "internalRating") ? Number(text(formData, "internalRating")) : null,
      reliabilityNotes: text(formData, "reliabilityNotes"),
      serviceNotes: text(formData, "serviceNotes"),
      internalNotes: text(formData, "internalNotes")
    }
  });
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.agent.updated", entityType: "OceanFreightAgent", entityId: id, before, after } });
  revalidateOceanFreightPricing();
}

export async function createOceanFreightContactAction(formData: FormData) {
  const ctx = await authorize();
  const contact = await prisma.oceanFreightAgentContact.create({ data: { tenantId: ctx.tenantId, agentId: requiredText(formData, "agentId"), fullName: requiredText(formData, "fullName"), email: requiredText(formData, "email").toLowerCase(), phone: text(formData, "phone"), title: text(formData, "title"), notes: text(formData, "notes"), lastObservedAt: new Date() } });
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.agent.updated", entityType: "OceanFreightAgentContact", entityId: contact.id, after: contact } });
  revalidateOceanFreightPricing();
}

export async function updateOceanFreightContactAction(formData: FormData) {
  const ctx = await authorize();
  const id = requiredText(formData, "contactId");
  const before = await prisma.oceanFreightAgentContact.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id
      }
    }
  });
  const after = await prisma.oceanFreightAgentContact.update({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id
      }
    },
    data: {
      fullName: requiredText(formData, "fullName"),
      email: requiredText(formData, "email").toLowerCase(),
      phone: text(formData, "phone"),
      title: text(formData, "title"),
      notes: text(formData, "notes"),
      lastObservedAt: new Date()
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: "ocean-freight.agent-contact.updated",
      entityType: "OceanFreightAgentContact",
      entityId: id,
      before,
      after
    }
  });
  revalidateOceanFreightPricing();
}

export async function deleteOceanFreightContactAction(formData: FormData) {
  const ctx = await authorize();
  const id = requiredText(formData, "contactId");
  const before = await prisma.oceanFreightAgentContact.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id
      }
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.oceanFreightRate.updateMany({
      where: {
        tenantId: ctx.tenantId,
        agentContactId: id
      },
      data: {
        agentContactId: null,
        updatedByUserId: ctx.userId
      }
    });
    await tx.oceanFreightRateCandidate.updateMany({
      where: {
        tenantId: ctx.tenantId,
        agentContactId: id
      },
      data: {
        agentContactId: null
      }
    });
    await tx.oceanFreightAgentContact.delete({
      where: {
        tenantId_id: {
          tenantId: ctx.tenantId,
          id
        }
      }
    });
  });

  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: "ocean-freight.agent-contact.deleted",
      entityType: "OceanFreightAgentContact",
      entityId: id,
      before
    }
  });
  revalidateOceanFreightPricing();
}

export async function createOceanFreightBranchAction(formData: FormData) {
  const ctx = await authorize();
  const branch = await prisma.oceanFreightAgentBranch.create({
    data: {
      tenantId: ctx.tenantId,
      agentId: requiredText(formData, "agentId"),
      name: requiredText(formData, "branchName"),
      country: requiredText(formData, "country"),
      region: text(formData, "region"),
      city: text(formData, "city"),
      port: text(formData, "port"),
      address: text(formData, "address"),
      notes: text(formData, "notes")
    }
  });
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.agent-branch.created", entityType: "OceanFreightAgentBranch", entityId: branch.id, after: branch } });
  revalidateOceanFreightPricing();
}

export async function updateOceanFreightBranchAction(formData: FormData) {
  const ctx = await authorize();
  const id = requiredText(formData, "branchId");
  const before = await prisma.oceanFreightAgentBranch.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id
      }
    }
  });
  const after = await prisma.oceanFreightAgentBranch.update({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id
      }
    },
    data: {
      name: requiredText(formData, "branchName"),
      country: requiredText(formData, "country"),
      region: text(formData, "region"),
      city: text(formData, "city"),
      port: text(formData, "port"),
      address: text(formData, "address"),
      notes: text(formData, "notes")
    }
  });
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.agent-branch.updated", entityType: "OceanFreightAgentBranch", entityId: id, before, after } });
  revalidateOceanFreightPricing();
}

export async function deleteOceanFreightBranchAction(formData: FormData) {
  const ctx = await authorize();
  const id = requiredText(formData, "branchId");
  const before = await prisma.oceanFreightAgentBranch.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id
      }
    }
  });

  await prisma.oceanFreightAgentBranch.delete({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id
      }
    }
  });
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.agent-branch.deleted", entityType: "OceanFreightAgentBranch", entityId: id, before } });
  revalidateOceanFreightPricing();
}

export async function createOceanFreightRateAction(formData: FormData) {
  const ctx = await authorize();
  const agentId = requiredText(formData, "agentId");
  const equipmentType = requiredText(formData, "equipmentType") as OceanEquipmentType;
  const rate = await prisma.oceanFreightRate.create({ data: { tenantId: ctx.tenantId, agentId, agentContactId: text(formData, "agentContactId"), sourceType: OceanRateSourceType.MANUAL_ENTRY, originPort: requiredText(formData, "originPort"), originCountry: text(formData, "originCountry"), originRegion: text(formData, "originRegion"), destinationPort: requiredText(formData, "destinationPort"), destinationCountry: text(formData, "destinationCountry"), destinationRegion: text(formData, "destinationRegion"), equipmentType, equipmentLabel: text(formData, "equipmentLabel") ?? equipmentType, rateAmount: requiredText(formData, "rateAmount"), currency: requiredText(formData, "currency").toUpperCase(), shippingLine: text(formData, "shippingLine"), validityStartDate: dateValue(formData, "validityStartDate"), validityEndDate: dateValue(formData, "validityEndDate"), freeTimeNotes: text(formData, "freeTimeNotes"), detentionDemurrageNotes: text(formData, "detentionDemurrageNotes"), transitTimeDays: text(formData, "transitTimeDays") ? Number(text(formData, "transitTimeDays")) : null, transitTimeNotes: text(formData, "transitTimeNotes"), scheduleNotes: text(formData, "scheduleNotes") ?? "Schedule not provided", notes: text(formData, "notes"), correctionNotes: text(formData, "correctionNotes"), createdByUserId: ctx.userId, updatedByUserId: ctx.userId, approvedByUserId: ctx.userId, approvedAt: new Date() } });
  await refreshAgentCounts(ctx.tenantId, agentId);
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.rate.created", entityType: "OceanFreightRate", entityId: rate.id, after: rate } });
  revalidateOceanFreightPricing();
}

export async function updateOceanFreightRateAction(formData: FormData) {
  const ctx = await authorize();
  const id = requiredText(formData, "rateId");
  const before = await prisma.oceanFreightRate.findUniqueOrThrow({ where: { tenantId_id: { tenantId: ctx.tenantId, id } } });
  const after = await prisma.oceanFreightRate.update({ where: { tenantId_id: { tenantId: ctx.tenantId, id } }, data: { rateAmount: requiredText(formData, "rateAmount"), validityEndDate: dateValue(formData, "validityEndDate"), correctionNotes: requiredText(formData, "correctionNotes"), updatedByUserId: ctx.userId, notes: text(formData, "notes") } });
  await refreshAgentCounts(ctx.tenantId, after.agentId);
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.rate.updated", entityType: "OceanFreightRate", entityId: id, before, after } });
  revalidateOceanFreightPricing();
}

export async function inactivateOceanFreightRateAction(formData: FormData) {
  const ctx = await authorize();
  const id = requiredText(formData, "rateId");
  const before = await prisma.oceanFreightRate.findUniqueOrThrow({ where: { tenantId_id: { tenantId: ctx.tenantId, id } } });
  const after = await prisma.oceanFreightRate.update({ where: { tenantId_id: { tenantId: ctx.tenantId, id } }, data: { status: OceanRateStatus.INACTIVE, inactiveAt: new Date(), inactiveByUserId: ctx.userId, inactiveReason: requiredText(formData, "inactiveReason"), updatedByUserId: ctx.userId } });
  await refreshAgentCounts(ctx.tenantId, after.agentId);
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: "ocean-freight.rate.inactivated", entityType: "OceanFreightRate", entityId: id, before, after } });
  revalidateOceanFreightPricing();
}
