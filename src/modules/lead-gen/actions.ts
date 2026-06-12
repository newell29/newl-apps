"use server";

import { CandidateStatus, ContactOutreachDraftStatus, LeadPipelineStage, ModuleKey } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getSequenceById } from "@/modules/lead-gen/sequence-catalog";

// All lead-gen mutations require: a valid authenticated context, the LEAD_GEN
// module enabled for the tenant + accessible to the role, and write permission
// (READ_ONLY users are blocked). Audit writes record the acting user.
async function authorizeLeadGenMutation() {
  const ctx = await getAuthenticatedContext();
  await requireModule(ctx, ModuleKey.LEAD_GEN);
  requireMutationAccess(ctx);
  return ctx;
}

const statusActions = {
  [CandidateStatus.NEW]: "leadgen.candidate.new",
  [CandidateStatus.REVIEWING]: "leadgen.candidate.reviewing",
  [CandidateStatus.APPROVED_FOR_PIPELINE]: "leadgen.candidate.approved",
  [CandidateStatus.REJECTED]: "leadgen.candidate.rejected",
  [CandidateStatus.DISQUALIFIED]: "leadgen.candidate.disqualified"
} satisfies Record<CandidateStatus, string>;

const pipelineStageActions = {
  [LeadPipelineStage.NEW]: "leadgen.pipeline.stage.new",
  [LeadPipelineStage.RESEARCHING]: "leadgen.pipeline.stage.researching",
  [LeadPipelineStage.ENRICHED]: "leadgen.pipeline.stage.enriched",
  [LeadPipelineStage.QUALIFIED]: "leadgen.pipeline.stage.qualified",
  [LeadPipelineStage.CONTACTED]: "leadgen.pipeline.stage.contacted",
  [LeadPipelineStage.REPLIED]: "leadgen.pipeline.stage.replied",
  [LeadPipelineStage.MEETING_BOOKED]: "leadgen.pipeline.stage.meeting_booked",
  [LeadPipelineStage.QUOTED]: "leadgen.pipeline.stage.quoted",
  [LeadPipelineStage.WON]: "leadgen.pipeline.stage.won",
  [LeadPipelineStage.LOST]: "leadgen.pipeline.stage.lost",
  [LeadPipelineStage.DISQUALIFIED]: "leadgen.pipeline.stage.disqualified"
} satisfies Record<LeadPipelineStage, string>;

export async function updateCandidateStatusAction(formData: FormData) {
  const tenant = await authorizeLeadGenMutation();
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
    const existingLead = await tx.lead.findUnique({
      where: {
        tenantId_companyId: {
          tenantId: tenant.tenantId,
          companyId: company.id
        }
      },
      select: {
        id: true
      }
    });

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

    if (nextStatus === CandidateStatus.APPROVED_FOR_PIPELINE) {
      await tx.lead.upsert({
        where: {
          tenantId_companyId: {
            tenantId: tenant.tenantId,
            companyId: company.id
          }
        },
        update: {},
        create: {
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
        actorUserId: tenant.userId,
        action: statusActions[nextStatus],
        entityType: "Company",
        entityId: company.id,
        before: {
          candidateStatus: company.candidateStatus,
          doNotProspect: company.doNotProspect,
          leadExists: Boolean(existingLead)
        },
        after: {
          candidateStatus: nextStatus,
          doNotProspect: nextStatus === CandidateStatus.DISQUALIFIED ? true : company.doNotProspect,
          leadCreated: nextStatus === CandidateStatus.APPROVED_FOR_PIPELINE && !existingLead,
          reason
        }
      }
    });
  });

  revalidatePath("/lead-gen/candidates");
  revalidatePath("/lead-gen/pipeline");
}

export async function updateLeadStageAction(formData: FormData) {
  const tenant = await authorizeLeadGenMutation();
  const leadId = readRequiredFormValue(formData, "leadId");
  const nextStage = parseLeadPipelineStage(readRequiredFormValue(formData, "stage"));
  const now = new Date();

  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      tenantId: tenant.tenantId
    },
    include: {
      company: true
    }
  });

  if (!lead) {
    throw new Error("Pipeline lead was not found for the current tenant.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: {
        id: lead.id
      },
      data: {
        stage: nextStage
      }
    });

    if (nextStage === LeadPipelineStage.DISQUALIFIED) {
      await tx.company.update({
        where: {
          id: lead.companyId
        },
        data: {
          candidateStatus: CandidateStatus.DISQUALIFIED,
          candidateStatusUpdatedAt: now,
          candidateStatusReason: "Disqualified from Pipeline.",
          doNotProspect: true
        }
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: pipelineStageActions[nextStage],
        entityType: "Lead",
        entityId: lead.id,
        before: {
          stage: lead.stage,
          companyId: lead.companyId,
          companyCandidateStatus: lead.company.candidateStatus
        },
        after: {
          stage: nextStage,
          companyId: lead.companyId,
          companyCandidateStatus:
            nextStage === LeadPipelineStage.DISQUALIFIED ? CandidateStatus.DISQUALIFIED : lead.company.candidateStatus
        }
      }
    });
  });

  revalidatePath("/lead-gen/pipeline");
  revalidatePath("/lead-gen/candidates");
}

export async function updateContactSequenceAction(formData: FormData) {
  const tenant = await authorizeLeadGenMutation();
  const contactId = readRequiredFormValue(formData, "contactId");
  const sequenceId = readRequiredFormValue(formData, "sequenceId");
  const overrideReason = readOptionalFormValue(formData, "sequenceOverrideReason");
  const sequence = getSequenceById(sequenceId);

  if (!sequence) {
    throw new Error("Selected sequence is invalid.");
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId: tenant.tenantId,
      company: {
        leads: {
          some: {
            tenantId: tenant.tenantId
          }
        }
      }
    },
    select: {
      id: true,
      companyId: true,
      selectedSequenceId: true,
      selectedSequenceName: true,
      sequenceManuallyOverridden: true
    }
  });

  if (!contact) {
    throw new Error("Contact was not found for the current tenant.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: {
        tenantId_id: {
          tenantId: tenant.tenantId,
          id: contact.id
        }
      },
      data: {
        selectedSequenceId: sequence.id,
        selectedSequenceName: sequence.name,
        sequenceOverrideReason: overrideReason,
        sequenceManuallyOverridden: true
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "leadgen.contact.sequence_changed",
        entityType: "Contact",
        entityId: contact.id,
        before: {
          selectedSequenceId: contact.selectedSequenceId,
          selectedSequenceName: contact.selectedSequenceName,
          sequenceManuallyOverridden: contact.sequenceManuallyOverridden
        },
        after: {
          selectedSequenceId: sequence.id,
          selectedSequenceName: sequence.name,
          sequenceManuallyOverridden: true,
          sequenceOverrideReason: overrideReason
        }
      }
    });
  });

  revalidatePath("/lead-gen/contacts");
  revalidatePath("/lead-gen/pipeline");
}

export async function saveContactDraftAction(formData: FormData) {
  const tenant = await authorizeLeadGenMutation();
  const draftId = readRequiredFormValue(formData, "draftId");
  const subject = readRequiredFormValue(formData, "subject");
  const body = readRequiredFormValue(formData, "body");

  const draft = await prisma.contactOutreachDraft.findFirst({
    where: {
      id: draftId,
      tenantId: tenant.tenantId,
      contact: {
        company: {
          leads: {
            some: {
              tenantId: tenant.tenantId
            }
          }
        }
      }
    },
    select: {
      id: true,
      contactId: true,
      companyId: true,
      subject: true,
      body: true,
      status: true
    }
  });

  if (!draft) {
    throw new Error("Draft was not found for the current tenant.");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.contactOutreachDraft.update({
      where: {
        id: draft.id
      },
      data: {
        subject,
        body,
        status: ContactOutreachDraftStatus.EDITED,
        editedAt: now
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "leadgen.contact_draft.saved",
        entityType: "ContactOutreachDraft",
        entityId: draft.id,
        before: {
          status: draft.status,
          subjectLength: draft.subject.length,
          bodyLength: draft.body.length
        },
        after: {
          status: ContactOutreachDraftStatus.EDITED,
          subjectChanged: draft.subject !== subject,
          bodyChanged: draft.body !== body,
          subjectLength: subject.length,
          bodyLength: body.length
        }
      }
    });
  });

  revalidatePath("/lead-gen/contacts");
}

function readRequiredFormValue(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function readOptionalFormValue(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

function parseCandidateStatus(value: string) {
  if (!Object.values(CandidateStatus).includes(value as CandidateStatus)) {
    throw new Error("Candidate status is invalid.");
  }

  return value as CandidateStatus;
}

function parseLeadPipelineStage(value: string) {
  if (!Object.values(LeadPipelineStage).includes(value as LeadPipelineStage)) {
    throw new Error("Pipeline stage is invalid.");
  }

  return value as LeadPipelineStage;
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
