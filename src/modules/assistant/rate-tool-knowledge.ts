import { AssistantSourceKind } from "@prisma/client";

import type { AssistantKnowledgeAdapterResult } from "@/modules/assistant/knowledge-registry";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

export async function getRateToolAssistantKnowledge(tenant: TenantContext): Promise<AssistantKnowledgeAdapterResult> {
  const rateJobs = await prisma.automationJobRun.findMany({
    where: tenantWhere(tenant, {
      jobType: {
        in: ["ups-tools.bulk-rate-quote", "ltl-rate-portal.bulk-quote"]
      }
    }),
    orderBy: {
      startedAt: "desc"
    },
    take: 100,
    select: {
      id: true,
      jobType: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true
    }
  });

  return {
    documents: rateJobs.map((job) => ({
      sourceKind: AssistantSourceKind.RATE_TOOL,
      sourceSystem: "NEWL_RATE_JOB",
      externalId: job.id,
      title: `${job.jobType} ${job.startedAt.toISOString()}`,
      sourceUpdatedAt: job.finishedAt ?? job.startedAt,
      metadata: {
        jobType: job.jobType,
        status: job.status
      },
      content: joinKnowledgeParts([
        `Rate tool job ${job.jobType}.`,
        `Status: ${job.status}.`,
        `Started at: ${job.startedAt.toISOString()}.`,
        job.finishedAt ? `Finished at: ${job.finishedAt.toISOString()}.` : "This job has not finished yet.",
        job.errorMessage ? `Error message: ${job.errorMessage}.` : null
      ])
    }))
  };
}

function joinKnowledgeParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
