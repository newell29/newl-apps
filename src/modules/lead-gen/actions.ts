"use server";

import { CandidateStatus, LeadPipelineStage } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { getCurrentTenantContext } from "@/server/tenant-context";

const statusActions = {
  [CandidateStatus.NEW]: "leadgen.candidate.new",
  [CandidateStatus.REVIEWING]: "leadgen.candidate.reviewing",
  [CandidateStatus.APPROVED_FOR_PIPELINE]: "leadgen.candidate.approved",
  [CandidateStatus.REJECTED]: "leadgen.candidate.rejected",
  [CandidateStatus.DISQUALIFIED]: "leadgen.candidate.disqualified"
} satisfies Record<CandidateStatus, string>;

export async function updateCandidateStatusAction(formData: FormData) {
  const tenant = await getCurrentTenantContext();
  const companyId = readRequiredFormValue(formData, "companyId");
  const nextStatus = parseCandidateStatus(readRequiredFormValue(formData, "status"));

  if (nextStatus === CandidateStatus.NEW) {
    throw new Error("Candidate status actions cannot reset companies to NEW yet.");
  }

  const reason = getStatusReason(nextStatus);
  const now = new Date();

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      tenantId: tenant.tenantId
    },
    include: {
      leads: {
        where: {
          tenantId: tenant.tenantId
        },
        take: 1
      }
    }
  });

  if (!company) {
    throw new Error("Candidate was not found for the current tenant.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: {
        id: company.id
      },
      data: {
        candidateStatus: nextStatus,
        candidateStatusUpdatedAt: now,
        candidateStatusReason: reason,
        doNotProspect: nextStatus === CandidateStatus.DISQUALIFIED ? true : company.doNotProspect
      }
    });

    if (nextStatus === CandidateStatus.APPROVED_FOR_PIPELINE && company.leads.length === 0) {
      await tx.lead.create({
        data: {
          tenantId: tenant.tenantId,
          companyId: company.id,
          stage: LeadPipelineStage.NEW,
          score: company.priorityScore,
          notes: "Created from Candidate Feed approval."
        }
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        action: statusActions[nextStatus],
        entityType: "Company",
        entityId: company.id,
        before: {
          candidateStatus: company.candidateStatus,
          doNotProspect: company.doNotProspect,
          leadExists: company.leads.length > 0
        },
        after: {
          candidateStatus: nextStatus,
          doNotProspect: nextStatus === CandidateStatus.DISQUALIFIED ? true : company.doNotProspect,
          leadCreated: nextStatus === CandidateStatus.APPROVED_FOR_PIPELINE && company.leads.length === 0,
          reason
        }
      }
    });
  });

  revalidatePath("/lead-gen/candidates");
  revalidatePath("/lead-gen/pipeline");
}

function readRequiredFormValue(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function parseCandidateStatus(value: string) {
  if (!Object.values(CandidateStatus).includes(value as CandidateStatus)) {
    throw new Error("Candidate status is invalid.");
  }

  return value as CandidateStatus;
}

function getStatusReason(status: CandidateStatus) {
  switch (status) {
    case CandidateStatus.REVIEWING:
      return "Marked for manual review from Candidate Feed.";
    case CandidateStatus.APPROVED_FOR_PIPELINE:
      return "Approved from Candidate Feed for sales pipeline handoff.";
    case CandidateStatus.REJECTED:
      return "Rejected from Candidate Feed review.";
    case CandidateStatus.DISQUALIFIED:
      return "Disqualified from Candidate Feed review.";
    case CandidateStatus.NEW:
      return "New candidate.";
  }
}
