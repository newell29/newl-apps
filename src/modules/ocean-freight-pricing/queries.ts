import { ModuleKey, OceanRateStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { requireModule } from "@/server/auth/authorization";

export type OceanRateView = Awaited<ReturnType<typeof getOceanFreightPricingShell>>["rates"][number];

export function getComputedOceanRateStatus(rate: { status: OceanRateStatus; validityStartDate: Date | null; validityEndDate: Date | null }, today = new Date()) {
  if (rate.status === OceanRateStatus.INACTIVE || rate.status === OceanRateStatus.SUPERSEDED) return rate.status;
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!rate.validityEndDate) return "NEEDS_VALIDITY" as const;
  if (rate.validityStartDate && rate.validityStartDate > day) return "FUTURE" as const;
  if (rate.validityEndDate < day) return OceanRateStatus.EXPIRED;
  return OceanRateStatus.ACTIVE;
}

export async function getOceanFreightPricingShell(ctx: AuthenticatedContext, filters?: { status?: string }) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  const today = new Date();
  const includeHistorical = filters?.status === "all";
  const where: Prisma.OceanFreightRateWhereInput = { tenantId: ctx.tenantId };
  if (!includeHistorical) {
    where.status = OceanRateStatus.ACTIVE;
    where.OR = [{ validityEndDate: null }, { validityEndDate: { gte: today } }];
  }

  const [rates, agents, candidates, sources, jobs] = await Promise.all([
    prisma.oceanFreightRate.findMany({
      where,
      orderBy: [{ validityEndDate: "asc" }, { updatedAt: "desc" }],
      include: { agent: true, agentContact: true },
      take: 100
    }),
    prisma.oceanFreightAgent.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ name: "asc" }],
      include: { contacts: { orderBy: { fullName: "asc" } } }
    }),
    prisma.oceanFreightRateCandidate.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
      take: 25
    }),
    prisma.oceanFreightSourceEmail.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { receivedAt: "desc" },
      take: 25
    }),
    prisma.automationJobRun.findMany({
      where: { tenantId: ctx.tenantId, jobType: { startsWith: "ocean-freight-pricing." } },
      orderBy: { startedAt: "desc" },
      take: 10
    })
  ]);

  return {
    rates: rates.map((rate) => ({ ...rate, computedStatus: getComputedOceanRateStatus(rate) })),
    agents,
    candidates,
    sources,
    jobs,
    summary: {
      activeRates: rates.filter((rate) => getComputedOceanRateStatus(rate) === OceanRateStatus.ACTIVE).length,
      agentCount: agents.length,
      reviewQueueCount: candidates.length,
      sourceCount: sources.length
    }
  };
}
