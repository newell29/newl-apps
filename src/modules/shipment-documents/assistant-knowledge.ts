import { AssistantMemoryKind, AssistantSourceKind } from "@prisma/client";

import type { AssistantKnowledgeAdapterResult } from "@/modules/assistant/knowledge-registry";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

export async function getShipmentDocumentsAssistantKnowledge(
  tenant: TenantContext
): Promise<AssistantKnowledgeAdapterResult> {
  const [recentRuns, openOrdersByStatus, recentUpdateJobs, recentEmailSyncs, dimensionCount] = await Promise.all([
    prisma.teamshipReviewRun.findMany({
      where: tenantWhere(tenant, { deletedAt: null }),
      orderBy: [{ shipmentDate: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        documentLabel: true,
        shipmentDate: true,
        pdfOrderCount: true,
        teamshipMatchedCount: true,
        passedCount: true,
        failedCount: true,
        missingTeamshipCount: true,
        pendingTeamshipCount: true,
        noPdfCount: true,
        alertDigestOrderCount: true,
        updatedAt: true
      }
    }),
    prisma.teamshipReviewOrder.groupBy({
      by: ["workflowStatus"],
      where: tenantWhere(tenant),
      _count: { _all: true }
    }),
    prisma.teamshipUpdateJob.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ shipmentDate: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        documentLabel: true,
        shipmentDate: true,
        status: true,
        agentMode: true,
        dryRun: true,
        errorMessage: true,
        updatedAt: true
      }
    }),
    prisma.garlandEmailSyncRun.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ startedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        mailboxAddress: true,
        status: true,
        messageCount: true,
        candidateMessageCount: true,
        storedEmailCount: true,
        storedAttachmentCount: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true
      }
    }),
    prisma.garlandProductDimensionObservation.count({ where: tenantWhere(tenant) })
  ]);

  const documents = [
    {
      sourceKind: AssistantSourceKind.OTHER,
      sourceSystem: "NEWL_SHIPMENT_DOCUMENTS",
      externalId: "shipment-documents-operational-summary",
      title: "Shipment documents assistant summary",
      sourceUpdatedAt: recentRuns[0]?.updatedAt ?? recentUpdateJobs[0]?.updatedAt ?? new Date(),
      metadata: {
        module: "SHIPMENT_DOCUMENTS",
        recentRunCount: recentRuns.length,
        recentUpdateJobCount: recentUpdateJobs.length,
        dimensionObservationCount: dimensionCount
      },
      content: [
        "Shipment documents module capability: Garland PDF/email intake, Teamship review, Teamship update jobs, and learned product dimensions.",
        `Learned Garland product dimension observations: ${dimensionCount}.`,
        "Open Teamship review orders by workflow status:",
        ...openOrdersByStatus.map((row) => `- ${row.workflowStatus}: ${row._count._all}`),
        "Recent Teamship review runs:",
        ...recentRuns.map((run) =>
          `- ${run.documentLabel} (${formatDate(run.shipmentDate)}): ${run.passedCount} passed, ${run.failedCount} failed, ${run.missingTeamshipCount} missing Teamship, ${run.pendingTeamshipCount} pending, ${run.noPdfCount} no PDF, ${run.alertDigestOrderCount} alert digest orders out of ${run.pdfOrderCount} PDF orders.`
        ),
        "Recent Teamship update jobs:",
        ...recentUpdateJobs.map((job) =>
          `- ${job.documentLabel} (${formatDate(job.shipmentDate)}): status ${job.status}, mode ${job.agentMode}, dry run ${job.dryRun ? "yes" : "no"}${job.errorMessage ? `, error: ${job.errorMessage}` : ""}.`
        ),
        "Recent Garland email syncs:",
        ...recentEmailSyncs.map((sync) =>
          `- ${sync.mailboxAddress} at ${formatDateTime(sync.startedAt)}: ${sync.status}, ${sync.candidateMessageCount}/${sync.messageCount} candidate messages, ${sync.storedEmailCount} stored emails, ${sync.storedAttachmentCount} stored attachments${sync.errorMessage ? `, error: ${sync.errorMessage}` : ""}.`
        )
      ].join("\n")
    }
  ];

  return {
    documents,
    memories: [
      {
        kind: AssistantMemoryKind.TENANT_FACT,
        subjectType: "Module",
        subjectId: "SHIPMENT_DOCUMENTS",
        title: "Shipment documents assistant coverage",
        summary:
          "Shipment documents exposes Garland/Teamship review runs, workflow status counts, update jobs, email syncs, and product dimension observations to the assistant when the module is enabled.",
        confidence: 95,
        lastObservedAt: new Date()
      }
    ]
  };
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date) {
  return value.toISOString();
}
