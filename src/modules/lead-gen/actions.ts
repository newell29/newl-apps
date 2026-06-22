"use server";

import {
  CandidateStatus,
  ContactOutreachDraftStatus,
  LeadPipelineStage,
  Prisma,
  SequenceStatus
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { assertValidTradeMiningSearchProfile } from "@/modules/lead-gen/search-profile-validation";
import { sequenceCatalog } from "@/modules/lead-gen/sequence-catalog";
import { requireAdmin } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

type SearchProfileMutationClient = typeof prisma & {
  tradeMiningSearchProfile?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  company: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  lead: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      companyId: string;
      notes?: string | null;
    } | null>;
    upsert(args: {
      where: { tenantId_companyId: { tenantId: string; companyId: string } };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  contact: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      companyId: string;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
  contactOutreachDraft: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

async function authorizeLeadGenAdminMutation() {
  const context = await getAuthenticatedContext();
  requireAdmin(context);
  return context;
}

export async function createTradeMiningSearchProfileAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const payload = readSearchProfilePayload(formData);

  await client.tradeMiningSearchProfile.create({
    data: {
      tenantId: context.tenantId,
      ...payload
    }
  });

  revalidateTradeMiningProfileSurfaces();
}

export async function updateTradeMiningSearchProfileAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const profileId = readRequired(formData, "profileId");
  const payload = readSearchProfilePayload(formData);

  await client.tradeMiningSearchProfile.update({
    where: {
      id: profileId
    },
    data: {
      tenantId: context.tenantId,
      ...payload
    }
  });

  revalidateTradeMiningProfileSurfaces();
}

export async function deleteTradeMiningSearchProfileAction(formData: FormData) {
  await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const profileId = readRequired(formData, "profileId");

  await client.tradeMiningSearchProfile.delete({
    where: {
      id: profileId
    }
  });

  revalidateTradeMiningProfileSurfaces();
}

export async function updateCandidateStatusAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;
  const companyId = readRequired(formData, "companyId");
  const status = readCandidateStatus(formData.get("status"));
  await setCandidateStatusForCompany(client, context.tenantId, companyId, status);

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateCandidateStatusAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;
  const status = readCandidateStatus(formData.get("status"));
  const companyIds = formData
    .getAll("companyId")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (companyIds.length === 0) {
    throw new Error("Select at least one company.");
  }

  for (const companyId of companyIds) {
    await setCandidateStatusForCompany(client, context.tenantId, companyId, status);
  }

  revalidateLeadGenSurfaces();
}

export async function updateLeadStageAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;
  const leadId = readRequired(formData, "leadId");
  const stage = readLeadStage(formData.get("stage"));
  await setLeadStageForTenant(client, context.tenantId, leadId, stage);

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateLeadStageAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;
  const stage = readLeadStage(formData.get("stage"));
  const leadIds = readSelectedIds(formData, "leadId");

  for (const leadId of leadIds) {
    await setLeadStageForTenant(client, context.tenantId, leadId, stage);
  }

  revalidateLeadGenSurfaces();
}

export async function bulkQueueApolloEnrichmentAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;
  const leadIds = readSelectedIds(formData, "leadId");
  const queuedAt = new Date().toISOString();

  for (const leadId of leadIds) {
    const lead = await client.lead.findFirst({
      where: {
        id: leadId,
        tenantId: context.tenantId
      },
      select: {
        id: true,
        notes: true
      }
    });

    if (!lead) {
      throw new Error("Lead not found for this tenant.");
    }

    await client.lead.update({
      where: {
        id: leadId
      },
      data: {
        notes: appendLeadNote(lead.notes ?? null, `Apollo enrichment requested on ${queuedAt}.`)
      }
    });
  }

  revalidateLeadGenSurfaces();
}

export async function bulkAssignLeadOwnerAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const leadIds = readSelectedIds(formData, "leadId");
  const ownerUserId = readBulkOwnerValue(formData.get("ownerUserId"));

  await updateLeadOwnersForTenant(context.tenantId, leadIds, ownerUserId);
  revalidateLeadGenSurfaces();
}

export async function bulkUnassignLeadOwnerAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const leadIds = readSelectedIds(formData, "leadId");

  await updateLeadOwnersForTenant(context.tenantId, leadIds, null);
  revalidateLeadGenSurfaces();
}

async function updateLeadOwnersForTenant(
  tenantId: string,
  leadIds: string[],
  ownerUserId: string | null
) {
  const client = prisma as SearchProfileMutationClient;

  for (const leadId of leadIds) {
    const lead = await client.lead.findFirst({
      where: {
        id: leadId,
        tenantId
      },
      select: {
        id: true,
        companyId: true
      }
    });

    if (!lead) {
      throw new Error("Lead not found for this tenant.");
    }

    await client.lead.update({
      where: {
        id: leadId
      },
      data: {
        ownerUserId
      }
    });

    await client.contact.updateMany({
      where: {
        tenantId,
        companyId: lead.companyId
      },
      data: {
        assignedRep: ownerUserId
      }
    });
  }
}

export async function updateContactSequenceAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;
  const contactId = readRequired(formData, "contactId");
  const sequenceId = readRequired(formData, "sequenceId");
  const overrideReason = readOptional(formData, "sequenceOverrideReason") ?? null;
  const sequence = sequenceCatalog.find((item) => item.id === sequenceId);

  if (!sequence) {
    throw new Error("Selected sequence is not recognized.");
  }

  const contact = await client.contact.findFirst({
    where: {
      id: contactId,
      tenantId: context.tenantId
    },
    select: {
      id: true,
      companyId: true
    }
  });

  if (!contact) {
    throw new Error("Contact not found for this tenant.");
  }

  await client.contact.update({
    where: {
      id: contactId
    },
    data: {
      selectedSequenceId: sequence.id,
      selectedSequenceName: sequence.name,
      sequenceOverrideReason: overrideReason,
      sequenceManuallyOverridden: true,
      sequenceStatus: SequenceStatus.READY
    }
  });

  revalidateLeadGenSurfaces();
}

export async function saveContactDraftAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;
  const draftId = readRequired(formData, "draftId");
  const draft = await client.contactOutreachDraft.findFirst({
    where: {
      id: draftId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!draft) {
    throw new Error("Draft not found for this tenant.");
  }

  await client.contactOutreachDraft.update({
    where: {
      id: draftId
    },
    data: {
      subject: readRequired(formData, "subject"),
      body: readRequired(formData, "body"),
      status: ContactOutreachDraftStatus.EDITED,
      editedAt: new Date()
    }
  });

  revalidateLeadGenSurfaces();
}

function revalidateTradeMiningProfileSurfaces() {
  revalidatePath("/lead-gen/search-profiles");
  revalidatePath("/lead-gen/candidates");
  revalidatePath("/dashboard");
}

function revalidateLeadGenSurfaces() {
  revalidatePath("/lead-gen/candidates");
  revalidatePath("/lead-gen/pipeline");
  revalidatePath("/lead-gen/contacts");
  revalidatePath("/dashboard");
}

async function setCandidateStatusForCompany(
  client: SearchProfileMutationClient,
  tenantId: string,
  companyId: string,
  status: CandidateStatus
) {
  const company = await client.company.findFirst({
    where: {
      id: companyId,
      tenantId
    },
    select: {
      id: true
    }
  });

  if (!company) {
    throw new Error("Company not found for this tenant.");
  }

  await client.company.update({
    where: {
      id: companyId
    },
    data: {
      candidateStatus: status,
      candidateStatusUpdatedAt: new Date(),
      candidateStatusReason:
        status === CandidateStatus.APPROVED_FOR_PIPELINE
          ? "Approved from found company review queue."
          : status === CandidateStatus.REVIEWING
            ? "Moved into active review."
            : status === CandidateStatus.REJECTED
              ? "Rejected from review queue."
              : status === CandidateStatus.DISQUALIFIED
                ? "Disqualified from review queue."
                : "Reset to new."
    }
  });

  if (status === CandidateStatus.APPROVED_FOR_PIPELINE) {
    await client.lead.upsert({
      where: {
        tenantId_companyId: {
          tenantId,
          companyId
        }
      },
      update: {
        stage: LeadPipelineStage.NEW
      },
      create: {
        tenantId,
        companyId,
        stage: LeadPipelineStage.NEW
      }
    });
  }
}

async function setLeadStageForTenant(
  client: SearchProfileMutationClient,
  tenantId: string,
  leadId: string,
  stage: LeadPipelineStage
) {
  const lead = await client.lead.findFirst({
    where: {
      id: leadId,
      tenantId
    },
    select: {
      id: true,
      companyId: true
    }
  });

  if (!lead) {
    throw new Error("Lead not found for this tenant.");
  }

  await client.lead.update({
    where: {
      id: leadId
    },
    data: {
      stage
    }
  });

  if (stage === LeadPipelineStage.DISQUALIFIED) {
    await client.company.update({
      where: {
        id: lead.companyId
      },
      data: {
        candidateStatus: CandidateStatus.DISQUALIFIED,
        candidateStatusUpdatedAt: new Date(),
        candidateStatusReason: "Pipeline account was disqualified."
      }
    });
  }
}

function appendLeadNote(existingNotes: string | null, nextNote: string) {
  if (!existingNotes || existingNotes.trim().length === 0) {
    return nextNote;
  }

  return `${existingNotes}\n\n${nextNote}`;
}

function readSearchProfilePayload(formData: FormData) {
  const minShipmentVolumeNumber = readOptionalNumber(formData, "minShipmentVolume");
  const payload = {
    name: readRequired(formData, "name"),
    destinationMarkets: readStringList(formData, "destinationMarkets"),
    destinationPorts: readStringList(formData, "destinationPorts"),
    originPorts: readStringList(formData, "originPorts"),
    shipFromPorts: readStringList(formData, "shipFromPorts"),
    originCountries: readStringList(formData, "originCountries"),
    productKeywords: readStringList(formData, "productKeywords"),
    hsCodes: readStringList(formData, "hsCodes"),
    lookbackWindowDays: readRequiredInteger(formData, "lookbackWindowDays", 1, 365),
    minShipmentCount: readRequiredInteger(formData, "minShipmentCount", 0, 100000),
    minShipmentVolume: minShipmentVolumeNumber,
    scheduleFrequency: readScheduleFrequency(formData.get("scheduleFrequency")),
    priorityWeight: readRequiredInteger(formData, "priorityWeight", 0, 100)
  };

  assertValidTradeMiningSearchProfile(payload);

  return {
    ...payload,
    minShipmentVolume:
      minShipmentVolumeNumber === null ? null : new Prisma.Decimal(minShipmentVolumeNumber.toString()),
    description: readOptional(formData, "description") ?? null,
    enabled: formData.get("enabled") === "true",
    scheduleTimezone: readOptional(formData, "scheduleTimezone") ?? "America/Toronto"
  };
}

function readRequired(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }

  return value.trim();
}

function readOptional(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRequiredInteger(formData: FormData, field: string, min: number, max: number) {
  const value = readRequired(formData, field);
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid integer for ${field}. Expected a value between ${min} and ${max}.`);
  }

  return parsed;
}

function readOptionalNumber(formData: FormData, field: string) {
  const value = readOptional(formData, field);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${field}.`);
  }

  return parsed;
}

function readStringList(formData: FormData, field: string) {
  const value = readOptional(formData, field);
  if (!value) {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

function readSelectedIds(formData: FormData, field: string) {
  const values = formData
    .getAll(field)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (values.length === 0) {
    throw new Error("Select at least one account.");
  }

  return values;
}

function readBulkOwnerValue(value: FormDataEntryValue | null) {
  if (value === "UNASSIGNED") {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Select a sales rep.");
  }

  return value.trim();
}

function readScheduleFrequency(value: FormDataEntryValue | null) {
  return value === "weekly" || value === "manual" ? value : "daily";
}

function readCandidateStatus(value: FormDataEntryValue | null) {
  if (
    value === CandidateStatus.NEW ||
    value === CandidateStatus.REVIEWING ||
    value === CandidateStatus.APPROVED_FOR_PIPELINE ||
    value === CandidateStatus.REJECTED ||
    value === CandidateStatus.DISQUALIFIED
  ) {
    return value;
  }

  throw new Error("Invalid candidate status.");
}

function readLeadStage(value: FormDataEntryValue | null) {
  if (typeof value === "string" && Object.values(LeadPipelineStage).includes(value as LeadPipelineStage)) {
    return value as LeadPipelineStage;
  }

  throw new Error("Invalid lead stage.");
}
