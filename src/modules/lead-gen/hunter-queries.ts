import { HunterDecisionStatus } from "@prisma/client";
import { DEFAULT_HUNTER_POLICY, HUNTER_DRY_RUN_JOB_TYPE } from "@/modules/lead-gen/hunter-planner";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

export async function getHunterControlPlane(tenant: Pick<TenantContext, "tenantId">) {
  const [storedPolicy, latestRuns, signals, decisionCount, activeSuppressionCount] = await Promise.all([
    prisma.hunterAutomationPolicy.findUnique({
      where: { tenantId: tenant.tenantId }
    }),
    prisma.automationJobRun.findMany({
      where: {
        tenantId: tenant.tenantId,
        jobType: HUNTER_DRY_RUN_JOB_TYPE
      },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: {
        hunterProspectingDecisions: {
          orderBy: { rank: "asc" }
        }
      }
    }),
    prisma.hunterOpportunitySignal.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
      take: 30
    }),
    prisma.hunterProspectingDecision.count({
      where: {
        tenantId: tenant.tenantId,
        status: HunterDecisionStatus.WOULD_PURSUE
      }
    }),
    prisma.hunterOutreachSuppression.count({
      where: {
        tenantId: tenant.tenantId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    })
  ]);

  return {
    policy: storedPolicy ?? {
      id: null,
      tenantId: tenant.tenantId,
      ...DEFAULT_HUNTER_POLICY,
      allowedJurisdictions: null,
      createdAt: null,
      updatedAt: null
    },
    policyIsStored: Boolean(storedPolicy),
    latestRuns,
    latestRun: latestRuns[0] ?? null,
    signals,
    decisionCount,
    activeSuppressionCount
  };
}
