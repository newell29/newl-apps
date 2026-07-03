"use server";

import {
  ApolloCompanyMatchClassification,
  ApolloStatus,
  ContactOutreachDraftSource,
  CandidateStatus,
  ContactStatus,
  ContactOutreachDraftStatus,
  JobStatus,
  LeadPipelineStage,
  ModuleKey,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { EMPTY_APOLLO_QUEUE_SUMMARY, type ApolloQueueSummary } from "@/modules/lead-gen/apollo-queue-summary";
import {
  APOLLO_PUSH_JOB_TYPE,
  createApolloPushJobOutput,
  type ApolloPushJobInput,
  type ApolloPushJobOutput
} from "@/modules/lead-gen/apollo-push-jobs";
import {
  EMPTY_CONTACT_BULK_ACTION_SUMMARY,
  type ContactBulkActionSummary
} from "@/modules/lead-gen/contact-bulk-action-summary";
import { calculateLeadPipelineScoreForCompany, scoreCandidate, summarizeTradeMiningEvidence } from "@/modules/lead-gen/queries";
import {
  assertValidTradeMiningSearchProfile,
  defaultTradeMiningCompanyIdentityRoles,
  tradeMiningCompanyIdentityRoleOptions
} from "@/modules/lead-gen/search-profile-validation";
import { scoreContact } from "@/modules/lead-gen/contact-scoring";
import { buildSequenceCatalogItems, recommendSequenceForContact } from "@/modules/lead-gen/sequence-catalog";
import {
  buildApolloSequenceMappingsWithDefaults,
  parseApolloSequenceDirectory,
  parseApolloSequenceMapping,
  parseSearchProfileApolloSequenceMapping,
  resolveApolloSequenceMappings
} from "@/modules/settings/apollo-sequence-mapping";
import { parseApolloRepMapping } from "@/modules/settings/apollo-rep-mapping";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import {
  ApolloRateLimitError,
  fetchApolloEmailAccountDirectory,
  fetchApolloContactsForCompany,
  syncApolloContactTypedCustomFields,
  type ApolloEmailAccountDirectoryEntry,
  type ApolloContactRecord,
  pushApolloContactsToSequence,
  type ApolloContactLookupResult
} from "@/server/integrations/apollo";
import {
  generateApolloCompanyNameSuggestion,
  generateTier1SequenceDraft,
  isOpenAiDraftGenerationConfigured
} from "@/server/integrations/openai";
import { getAuthenticatedContext } from "@/server/tenant-context";

type SearchProfileMutationClient = typeof prisma & {
  tradeMiningSearchProfile?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      name?: string;
      enabled?: boolean;
    } | null>;
  };
  automationJobRun: {
    findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; select?: Record<string, boolean> }): Promise<{
      id: string;
      status?: string;
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
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
    upsert(args: {
      where: { tenantId_contactId_sequenceName: { tenantId: string; contactId: string; sequenceName: string } };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

async function authorizeLeadGenAdminMutation() {
  const context = await getAuthenticatedContext();
  requireAdmin(context);
  return context;
}

async function authorizeLeadGenMutation() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  await requireMutationAccess(context);
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

export async function requestTradeMiningSearchProfileRunAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const profileId = readRequired(formData, "profileId");
  const profile = await client.tradeMiningSearchProfile.findFirst({
    where: {
      id: profileId,
      tenantId: context.tenantId
    },
    select: {
      id: true,
      name: true,
      enabled: true
    }
  });

  if (!profile) {
    throw new Error("Search profile not found for this tenant.");
  }

  if (!profile.enabled) {
    throw new Error("Enable this search profile before requesting an immediate run.");
  }

  const existingRequest = await client.automationJobRun.findFirst({
    where: {
      tenantId: context.tenantId,
      jobType: "trademining.run_request",
      status: {
        in: ["QUEUED", "RUNNING"]
      },
      input: {
        path: ["searchProfileId"],
        equals: profileId
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true
    }
  });

  if (existingRequest) {
    revalidateTradeMiningProfileSurfaces();
    revalidatePath("/operations/logs");
    return;
  }

  await client.automationJobRun.create({
    data: {
      tenantId: context.tenantId,
      jobType: "trademining.run_request",
      status: "QUEUED",
      input: {
        source: "APP_UI",
        searchProfileId: profile.id,
        searchProfileName: profile.name ?? null,
        requestedByUserId: context.userId,
        requestedByName: context.userName ?? context.userEmail ?? "Unknown user",
        requestedAt: new Date().toISOString()
      }
    }
  });

  await client.auditLog.create({
    data: {
      tenantId: context.tenantId,
      action: "trademining.run.requested",
      entityType: "TradeMiningSearchProfile",
      entityId: profile.id,
      after: {
        searchProfileId: profile.id,
        searchProfileName: profile.name ?? null,
        requestedByUserId: context.userId,
        requestedByName: context.userName ?? context.userEmail ?? "Unknown user"
      }
    }
  });

  revalidateTradeMiningProfileSurfaces();
  revalidatePath("/operations/logs");
}

export async function updateCandidateStatusAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const companyId = readRequired(formData, "companyId");
  const status = readCandidateStatus(formData.get("status"));
  await setCandidateStatusForCompany(client, context.tenantId, companyId, status);

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateCandidateStatusAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
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
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const leadId = readRequired(formData, "leadId");
  const stage = readLeadStage(formData.get("stage"));
  await setLeadStageForTenant(client, context.tenantId, leadId, stage);

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateLeadStageAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const stage = readLeadStage(formData.get("stage"));
  const leadIds = readSelectedIds(formData, "leadId");

  for (const leadId of leadIds) {
    await setLeadStageForTenant(client, context.tenantId, leadId, stage);
  }

  revalidateLeadGenSurfaces();
}

export async function bulkQueueApolloEnrichmentAction(formData: FormData): Promise<ApolloQueueSummary>;
export async function bulkQueueApolloEnrichmentAction(
  previousState: ApolloQueueSummary,
  formData: FormData
): Promise<ApolloQueueSummary>;
export async function bulkQueueApolloEnrichmentAction(
  firstArg: ApolloQueueSummary | FormData,
  secondArg?: FormData
): Promise<ApolloQueueSummary> {
  const formData = firstArg instanceof FormData ? firstArg : secondArg;

  if (!formData) {
    return {
      ...EMPTY_APOLLO_QUEUE_SUMMARY,
      status: "error",
      message: "Apollo enrichment request did not include form data.",
      completedAt: new Date().toISOString()
    };
  }

  try {
    const context = await authorizeLeadGenMutation();
    const leadIds = readSelectedIds(formData, "leadId");
    const queuedAt = new Date().toISOString();
    const requestNote = `Apollo enrichment requested on ${queuedAt}.`;
    const summary: ApolloQueueSummary = {
      status: "success",
      message: null,
      requestedCompanies: leadIds.length,
      processedCompanies: 0,
      matchedCompanies: 0,
      reviewNeededCompanies: 0,
      companiesWithContacts: 0,
      companiesWithoutContacts: 0,
      contactsImported: 0,
      completedAt: null
    };

    for (const leadId of leadIds) {
      const lead = await prisma.lead.findFirst({
        where: {
          id: leadId,
          tenantId: context.tenantId
        },
        select: {
          id: true,
          companyId: true,
          contactId: true,
          ownerUserId: true,
          notes: true,
          company: {
            select: {
              id: true,
              name: true,
              domain: true,
              linkedinUrl: true,
              apolloOrganizationId: true
            }
          }
        }
      });

      if (!lead) {
        throw new Error("Lead not found for this tenant.");
      }

      if (!lead.ownerUserId) {
        throw new Error("Assign a sales rep before queueing Apollo enrichment.");
      }

      const assignedOwnerUserId = lead.ownerUserId;

      const existingContacts = await prisma.contact.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: lead.companyId
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          fullName: true,
          title: true,
          department: true,
          seniority: true,
          email: true,
          phone: true,
          linkedinUrl: true,
          source: true,
          contactStatus: true,
          apolloContactId: true,
          apolloPersonId: true,
          apolloStatus: true,
          sequenceStatus: true,
          replyStatus: true,
          recommendedSequenceName: true,
          recommendedSequenceId: true,
          selectedSequenceName: true,
          selectedSequenceId: true,
          sequenceRecommendationReason: true,
          sequenceOverrideReason: true,
          sequenceManuallyOverridden: true,
          lastTouchAt: true,
          lastReplyAt: true,
          assignedRep: true,
          rawJson: true
        }
      });

      const queuedNotes = appendLeadNote(lead.notes ?? null, requestNote);

      await prisma.lead.update({
        where: {
          id: leadId
        },
        data: {
          notes: queuedNotes
        }
      });

      const lookup = await fetchApolloContactsForCompany({
        companyName: lead.company.name,
        domain: lead.company.domain,
        apolloOrganizationId: lead.company.apolloOrganizationId
      });

      await recordApolloCompanyMatch({
        tenantId: context.tenantId,
        companyId: lead.companyId,
        lookup
      });

      summary.processedCompanies += 1;

      if (lookup.match.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY) {
        summary.reviewNeededCompanies += 1;

        await prisma.lead.update({
          where: {
            id: leadId
          },
          data: {
            notes: appendLeadNote(
              queuedNotes,
              `Apollo company review needed on ${new Date().toISOString()}. ${lookup.match.matchReason}`
            )
          }
        });

        continue;
      }

      summary.matchedCompanies += 1;

      const importedContacts = await finalizeApolloEnrichmentForLead({
        tenantId: context.tenantId,
        lead: {
          ...lead,
          ownerUserId: assignedOwnerUserId
        },
        existingContacts,
        lookup,
        baseNotes: queuedNotes
      });

      if (importedContacts > 0) {
        summary.companiesWithContacts += 1;
        summary.contactsImported += importedContacts;
      } else {
        summary.companiesWithoutContacts += 1;
      }
    }

    revalidateLeadGenSurfaces();

    return {
      ...summary,
      message: `Apollo enrichment finished for ${summary.processedCompanies} compan${summary.processedCompanies === 1 ? "y" : "ies"}.`,
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...EMPTY_APOLLO_QUEUE_SUMMARY,
      status: "error",
      message: error instanceof Error ? error.message : "Apollo enrichment failed.",
      completedAt: new Date().toISOString()
    };
  }
}

export async function retryApolloCompanyReviewAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const leadId = readRequired(formData, "leadId");
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      tenantId: context.tenantId
    },
    select: {
      id: true,
      companyId: true,
      contactId: true,
      ownerUserId: true,
      notes: true,
      company: {
        select: {
          id: true,
          name: true,
          normalizedName: true,
          domain: true,
          linkedinUrl: true,
          apolloOrganizationId: true,
          importRecords: {
            orderBy: [
              {
                arrivalDate: "desc"
              },
              {
                createdAt: "desc"
              }
            ],
            take: 25,
            select: {
              rawJson: true,
              arrivalDate: true,
              sourcePort: true,
              destinationCity: true,
              destinationState: true,
              originCountry: true,
              productDescription: true
            }
          },
          apolloCompanyMatches: {
            orderBy: {
              createdAt: "desc"
            },
            take: 1,
            select: {
              classification: true,
              matchReason: true
            }
          }
        }
      }
    }
  });

  if (!lead) {
    throw new Error("Lead not found for this tenant.");
  }

  if (!lead.ownerUserId) {
    throw new Error("Assign a sales rep before retrying the Apollo company match.");
  }

  const assignedOwnerUserId = lead.ownerUserId;

  const latestMatch = lead.company.apolloCompanyMatches[0] ?? null;
  const shipmentContext = buildShipmentDraftContext(lead.company.importRecords);
  const suggestion = await generateApolloCompanyNameSuggestion({
    model: await loadTier1DraftModel(context.tenantId),
    companyName: lead.company.name,
    companyDomain: lead.company.domain ?? null,
    latestMatchClassification: latestMatch?.classification ?? null,
    latestMatchReason: latestMatch?.matchReason ?? null,
    recurringOrigins: shipmentContext.recurringOrigins,
    recurringDestinationPorts: shipmentContext.recurringDestinationPorts,
    recurringProducts: shipmentContext.recurringProducts,
    recentShipmentHighlights: shipmentContext.recentShipmentHighlights
  });

  const suggestionTimestamp = new Date().toISOString();
  const suggestionNotes = appendLeadNote(
    lead.notes ?? null,
    `Apollo company suggestion on ${suggestionTimestamp}. Suggested "${suggestion.suggestedCompanyName}" (${suggestion.source}, ${suggestion.confidence.toLowerCase()} confidence). ${suggestion.rationale}`
  );

  await prisma.lead.update({
    where: {
      id: lead.id
    },
    data: {
      notes: suggestionNotes
    }
  });

  const existingContacts = await prisma.contact.findMany({
    where: {
      tenantId: context.tenantId,
      companyId: lead.companyId
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      title: true,
      department: true,
      seniority: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      source: true,
      contactStatus: true,
      apolloContactId: true,
      apolloPersonId: true,
      apolloStatus: true,
      sequenceStatus: true,
      replyStatus: true,
      recommendedSequenceName: true,
      recommendedSequenceId: true,
      selectedSequenceName: true,
      selectedSequenceId: true,
      sequenceRecommendationReason: true,
      sequenceOverrideReason: true,
      sequenceManuallyOverridden: true,
      lastTouchAt: true,
      lastReplyAt: true,
      assignedRep: true,
      rawJson: true
    }
  });

  const lookup = await fetchApolloContactsForCompany({
    companyName: suggestion.suggestedCompanyName,
    domain: lead.company.domain,
    apolloOrganizationId: null
  });

  await recordApolloCompanyMatch({
    tenantId: context.tenantId,
    companyId: lead.companyId,
    lookup
  });

  if (lookup.match.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY) {
    await prisma.lead.update({
      where: {
        id: lead.id
      },
      data: {
        notes: appendLeadNote(
          suggestionNotes,
          `Apollo company review needed on ${new Date().toISOString()}. Tried "${suggestion.suggestedCompanyName}". ${lookup.match.matchReason}`
        )
      }
    });

    revalidateLeadGenSurfaces();
    return;
  }

  const resolvedNotes = appendLeadNote(
    suggestionNotes,
    `Apollo company review resolved on ${new Date().toISOString()}. Retried with "${suggestion.suggestedCompanyName}".`
  );

  await finalizeApolloEnrichmentForLead({
    tenantId: context.tenantId,
    lead: {
      ...lead,
      ownerUserId: assignedOwnerUserId
    },
    existingContacts,
    lookup,
    baseNotes: resolvedNotes
  });

  revalidateLeadGenSurfaces();
}

export async function bulkAssignLeadOwnerAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const leadIds = readSelectedIds(formData, "leadId");
  const ownerUserId = readBulkOwnerValue(formData.get("ownerUserId"));

  await updateLeadOwnersForTenant(context.tenantId, leadIds, ownerUserId);
  revalidateLeadGenSurfaces();
}

export async function bulkUnassignLeadOwnerAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
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
  const context = await authorizeLeadGenMutation();
  const contactId = readRequired(formData, "contactId");
  const sequenceId = readRequired(formData, "sequenceId");
  const overrideReason = readOptional(formData, "sequenceOverrideReason") ?? null;
  const confirmExistingSequenceOverride = readConfirmationBoolean(formData, "confirmExistingSequenceOverride");
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!contact) {
    throw new Error("Contact not found for this tenant.");
  }

  await applySequenceSelectionToContacts({
    tenantId: context.tenantId,
    contactIds: [contactId],
    sequenceId,
    overrideReason,
    confirmExistingSequenceOverride
  });

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateContactSequenceAction(formData: FormData): Promise<ContactBulkActionSummary>;
export async function bulkUpdateContactSequenceAction(
  previousState: ContactBulkActionSummary,
  formData: FormData
): Promise<ContactBulkActionSummary>;
export async function bulkUpdateContactSequenceAction(
  firstArg: ContactBulkActionSummary | FormData,
  secondArg?: FormData
): Promise<ContactBulkActionSummary> {
  const context = await authorizeLeadGenMutation();
  const formData = firstArg instanceof FormData ? firstArg : secondArg;

  if (!formData) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "sequence",
      message: "No cadence update payload was provided.",
      completedAt: new Date().toISOString()
    };
  }

  try {
    const contactIds = readSelectedIds(formData, "contactId");
    const sequenceId = readRequired(formData, "sequenceId");
    const overrideReason = readOptional(formData, "sequenceOverrideReason") ?? null;
    const confirmExistingSequenceOverride = readConfirmationBoolean(formData, "confirmExistingSequenceOverride");

    const result = await applySequenceSelectionToContacts({
      tenantId: context.tenantId,
      contactIds,
      sequenceId,
      overrideReason,
      confirmExistingSequenceOverride
    });

    revalidateLeadGenSurfaces();

    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "success",
      operation: "sequence",
      message:
        `Updated cadence selection for ${result.updatedContacts} contact${result.updatedContacts === 1 ? "" : "s"}. ` +
        "This updated Newl Apps only; no Apollo sequence enrollment was sent from the Contacts screen yet.",
      completedAt: new Date().toISOString(),
      selectedContacts: contactIds.length,
      updatedContacts: result.updatedContacts,
      readyContacts: result.readyContacts,
      protectedContacts: result.protectedContacts,
      pushedToApollo: false
    };
  } catch (error) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "sequence",
      message: error instanceof Error ? error.message : "Cadence update failed.",
      completedAt: new Date().toISOString()
    };
  }
}

export async function bulkRemoveContactsAction(formData: FormData): Promise<ContactBulkActionSummary>;
export async function bulkRemoveContactsAction(
  previousState: ContactBulkActionSummary,
  formData: FormData
): Promise<ContactBulkActionSummary>;
export async function bulkRemoveContactsAction(
  firstArg: ContactBulkActionSummary | FormData,
  secondArg?: FormData
): Promise<ContactBulkActionSummary> {
  const context = await authorizeLeadGenMutation();
  const formData = firstArg instanceof FormData ? firstArg : secondArg;

  if (!formData) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "remove",
      message: "No contact removal payload was provided.",
      completedAt: new Date().toISOString()
    };
  }

  try {
    const contactIds = readSelectedIds(formData, "contactId");
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId: context.tenantId,
        id: {
          in: contactIds
        }
      },
      select: {
        id: true
      }
    });

    if (contacts.length !== contactIds.length) {
      throw new Error("One or more contacts were not found for this tenant.");
    }

    const drafts = await prisma.contactOutreachDraft.findMany({
      where: {
        tenantId: context.tenantId,
        contactId: {
          in: contactIds
        }
      },
      select: {
        id: true
      }
    });

    await prisma.lead.updateMany({
      where: {
        tenantId: context.tenantId,
        contactId: {
          in: contactIds
        }
      },
      data: {
        contactId: null
      }
    });

    await prisma.contactOutreachDraft.deleteMany({
      where: {
        tenantId: context.tenantId,
        contactId: {
          in: contactIds
        }
      }
    });

    await prisma.contact.deleteMany({
      where: {
        tenantId: context.tenantId,
        id: {
          in: contactIds
        }
      }
    });

    revalidateLeadGenSurfaces();

    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "success",
      operation: "remove",
      message:
        `Removed ${contacts.length} contact${contacts.length === 1 ? "" : "s"} from the Newl Apps contact directory. ` +
        "This does not delete anything from Apollo.",
      completedAt: new Date().toISOString(),
      selectedContacts: contactIds.length,
      removedContacts: contacts.length,
      removedDrafts: drafts.length,
      pushedToApollo: false
    };
  } catch (error) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "remove",
      message: error instanceof Error ? error.message : "Contact removal failed.",
      completedAt: new Date().toISOString()
    };
  }
}

export async function bulkPushContactsToApolloAction(formData: FormData): Promise<ContactBulkActionSummary>;
export async function bulkPushContactsToApolloAction(
  previousState: ContactBulkActionSummary,
  formData: FormData
): Promise<ContactBulkActionSummary>;
export async function bulkPushContactsToApolloAction(
  firstArg: ContactBulkActionSummary | FormData,
  secondArg?: FormData
): Promise<ContactBulkActionSummary> {
  const context = await authorizeLeadGenMutation();
  const formData = firstArg instanceof FormData ? firstArg : secondArg;

  if (!formData) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "apollo_push",
      message: "No Apollo push payload was provided.",
      completedAt: new Date().toISOString()
    };
  }

  try {
    const contactIds = readSelectedIds(formData, "contactId");
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId: context.tenantId,
        id: {
          in: contactIds
        }
      },
      select: {
        companyId: true
      }
    });

    if (contacts.length !== contactIds.length) {
      throw new Error("One or more selected contacts were not found for this tenant.");
    }

    const jobInput: ApolloPushJobInput = {
      contactIds,
      selectedContacts: contactIds.length,
      requestedAt: new Date().toISOString()
    };
    const jobOutput = createApolloPushJobOutput(
      contactIds.length,
      new Set(contacts.map((contact) => contact.companyId)).size
    );

    const jobRun = await prisma.automationJobRun.create({
      data: {
        tenantId: context.tenantId,
        jobType: APOLLO_PUSH_JOB_TYPE,
        status: JobStatus.QUEUED,
        input: jobInput,
        output: jobOutput
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "lead-gen.apollo-push.queued",
        entityType: "AutomationJobRun",
        entityId: jobRun.id,
        after: {
          selectedContacts: contactIds.length,
          companiesTouched: jobOutput.companiesTouched
        }
      }
    });

    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "success",
      operation: "apollo_push",
      message: `Queued Apollo push job for ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}.`,
      completedAt: new Date().toISOString(),
      jobRunId: jobRun.id,
      jobStatus: JobStatus.QUEUED,
      selectedContacts: contactIds.length,
      companiesTouched: jobOutput.companiesTouched
    };
  } catch (error) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "apollo_push",
      message: error instanceof Error ? error.message : "Apollo push failed.",
      completedAt: new Date().toISOString()
    };
  }
}

export async function runApolloPushJob({
  tenantId,
  userId,
  jobRunId,
  contactIds
}: {
  tenantId: string;
  userId: string | null;
  jobRunId: string;
  contactIds: string[];
}) {
  const output = createApolloPushJobOutput(contactIds.length);
  const failureReasons = new Set<string>();
  const companyLookupCache = new Map<string, Promise<ApolloContactLookupResult>>();
  let batchRateLimitReason: string | null = null;

  try {
    await prisma.automationJobRun.update({
      where: {
        id: jobRunId
      },
      data: {
        status: JobStatus.RUNNING,
        output: {
          ...output,
          startedProcessingAt: new Date().toISOString()
        }
      }
    });

    const contacts = await prisma.contact.findMany({
      where: {
        tenantId,
        id: {
          in: contactIds
        }
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            domain: true,
            linkedinUrl: true,
            apolloOrganizationId: true
          }
        },
        outreachDrafts: {
          where: {
            tenantId
          },
          orderBy: {
            updatedAt: "desc"
          },
          take: 1
        }
      }
    });

    const [repMappings, emailAccounts] = await Promise.all([
      loadApolloRepMappings(tenantId),
      fetchApolloEmailAccountDirectory().catch(() => [])
    ]);
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    output.companiesTouched = new Set(contacts.map((contact) => contact.companyId)).size;
    const groups = new Map<string, ApolloPushGroup>();

    for (const contact of contacts) {
      const companyLookup = shouldRefreshApolloSequenceStatus(contact.sequenceStatus)
        ? await getApolloCompanyLookupForContact(contact, companyLookupCache)
        : undefined;
      const validation = await validateApolloPushCandidate({
        tenantId,
        contact,
        repMappings,
        emailAccounts,
        companyLookup
      });

      if (!validation.ok) {
        output.skippedContacts += 1;
        output.processedContacts += 1;
        failureReasons.add(validation.reason);
        output.details.push({
          contactId: contact.id,
          contactName: contact.fullName,
          companyName: contact.company.name,
          outcome: "skipped",
          reason: validation.reason
        });
        await appendApolloContactActivity({
          tenantId,
          contactId: contact.id,
          note: `Apollo sequence push skipped on ${new Date().toISOString()}. ${validation.reason}`
        });
        await persistApolloPushBlocker({
          tenantId,
          contactId: contact.id,
          reason: validation.reason
        });
        await persistApolloPushJobProgress(jobRunId, output);
        continue;
      }

      await persistApolloPushBlocker({
        tenantId,
        contactId: contact.id,
        reason: null
      });

      try {
        const customFieldSync = await syncApolloCustomFieldsForContactPush({
          tenantId,
          contactId: contact.id,
          apolloContactId: validation.apolloContactId
        });

        if (customFieldSync.missingFields.length > 0) {
          await appendApolloContactActivity({
            tenantId,
            contactId: contact.id,
            note:
              `Apollo custom field sync completed on ${new Date().toISOString()} with partial coverage. ` +
              `Missing Apollo field definitions: ${customFieldSync.missingFields.join(", ")}.`
          });
        }
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Apollo custom field sync failed before sequence push.";
        output.skippedContacts += 1;
        output.processedContacts += 1;
        failureReasons.add(reason);
        output.details.push({
          contactId: contact.id,
          contactName: contact.fullName,
          companyName: contact.company.name,
          outcome: "skipped",
          reason
        });
        await appendApolloContactActivity({
          tenantId,
          contactId: contact.id,
          note: `Apollo custom field sync failed on ${new Date().toISOString()}. ${reason}`
        });
        await persistApolloPushBlocker({
          tenantId,
          contactId: contact.id,
          reason
        });
        await persistApolloPushJobProgress(jobRunId, output);
        continue;
      }

      const key = [
        validation.sequenceId,
        validation.apolloOwnerUserId,
        validation.sendFromEmailAccountId,
        validation.companyId
      ].join("|");
      const existingGroup = groups.get(key);
      if (existingGroup) {
        existingGroup.contacts.push(validation);
      } else {
        groups.set(key, {
          companyId: validation.companyId,
          companyName: validation.companyName,
          companyDomain: validation.companyDomain,
          apolloOrganizationId: validation.apolloOrganizationId,
          sequenceId: validation.sequenceId,
          sequenceName: validation.sequenceName,
          apolloOwnerUserId: validation.apolloOwnerUserId,
          sendFromEmailAccountId: validation.sendFromEmailAccountId,
          contacts: [validation]
        });
      }
    }

    const groupedPushes = [...groups.values()];

    for (let index = 0; index < groupedPushes.length; index += 1) {
      const group = groupedPushes[index]!;
      try {
        const pushResult = await pushApolloContactsToSequence({
          sequenceId: group.sequenceId,
          apolloContactIds: group.contacts.map((contact) => contact.apolloContactId),
          sequenceOwnerUserId: group.apolloOwnerUserId,
          sendFromEmailAccountId: group.sendFromEmailAccountId,
          initialStatus: "active"
        });

        let verificationLookup: ApolloContactLookupResult | null = null;
        let verificationWasRateLimited = false;
        try {
          verificationLookup = await verifyApolloSequencePush({
            companyName: group.companyName,
            companyDomain: group.companyDomain,
            apolloOrganizationId: group.apolloOrganizationId,
            targetContacts: group.contacts,
            sequenceId: group.sequenceId
          });
        } catch (error) {
          if (error instanceof ApolloRateLimitError) {
            verificationWasRateLimited = true;
            batchRateLimitReason =
              "Apollo rate limit reached while verifying cadence enrollment. Wait a moment, then use Sync Apollo status instead of re-pushing the same contacts.";
            failureReasons.add(batchRateLimitReason);
          } else {
            throw error;
          }
        }

        const verificationContacts: ApolloSyncContactRecord[] = group.contacts
          .map((contact) => contactsById.get(contact.contactId))
          .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact))
          .map((contact) => ({
            id: contact.id,
            companyId: contact.companyId,
            firstName: contact.firstName,
            lastName: contact.lastName,
            fullName: contact.fullName,
            title: contact.title,
            department: contact.department,
            seniority: contact.seniority,
            email: contact.email,
            phone: contact.phone,
            linkedinUrl: contact.linkedinUrl,
            contactStatus: contact.contactStatus,
            apolloContactId: contact.apolloContactId,
            apolloPersonId: contact.apolloPersonId,
            sequenceStatus: contact.sequenceStatus,
            replyStatus: contact.replyStatus,
            recommendedSequenceName: contact.recommendedSequenceName,
            recommendedSequenceId: contact.recommendedSequenceId,
            selectedSequenceName: contact.selectedSequenceName,
            selectedSequenceId: contact.selectedSequenceId,
            sequenceRecommendationReason: contact.sequenceRecommendationReason,
            sequenceOverrideReason: contact.sequenceOverrideReason,
            sequenceManuallyOverridden: contact.sequenceManuallyOverridden,
            lastTouchAt: contact.lastTouchAt,
            lastReplyAt: contact.lastReplyAt,
            assignedRep: contact.assignedRep,
            rawJson: contact.rawJson,
            company: {
              id: contact.company.id,
              name: contact.company.name,
              domain: contact.company.domain,
              linkedinUrl: contact.company.linkedinUrl,
              apolloOrganizationId: contact.company.apolloOrganizationId
            }
          }));

        if (verificationLookup) {
          await syncExistingApolloContactsForCompany({
            tenantId,
            companyId: group.companyId,
            existingContacts: verificationContacts,
            lookup: verificationLookup
          });
        }

        const pushedAt = new Date();
        const pushedAtIso = pushedAt.toISOString();
        const verifiedResults = new Map<string, boolean>();
        for (const contact of group.contacts) {
          if (!verificationLookup) {
            verifiedResults.set(contact.contactId, false);
            continue;
          }

          const existingContact = contactsById.get(contact.contactId);
          const incoming = existingContact ? matchIncomingApolloContact(verificationLookup.contacts, existingContact) : null;
          verifiedResults.set(contact.contactId, isApolloContactEnrolledInSequence(incoming, group.sequenceId));
        }

        const enrolledIds = group.contacts
          .filter((contact) => verifiedResults.get(contact.contactId))
          .map((contact) => contact.contactId);

        if (enrolledIds.length > 0) {
          await prisma.contact.updateMany({
            where: {
              tenantId,
              id: {
                in: enrolledIds
              }
            },
            data: {
              apolloStatus: ApolloStatus.ENRICHED,
              sequenceStatus: SequenceStatus.ENROLLED,
              lastTouchAt: pushedAt
            }
          });
        }

        for (const contact of group.contacts) {
          const verified = verifiedResults.get(contact.contactId) ?? false;
          if (!verified) {
            const reason = verificationWasRateLimited
              ? "Apollo accepted the push, but Newl Apps hit Apollo rate limits before verification finished. Use Sync Apollo status shortly instead of re-pushing this contact."
              : "Apollo accepted the push, but the cadence enrollment is still propagating in Apollo and was not yet visible during Newl Apps verification.";
            output.skippedContacts += 1;
            output.processedContacts += 1;
            failureReasons.add(reason);
            output.details.push({
              contactId: contact.contactId,
              contactName: contact.fullName,
              companyName: group.companyName,
              outcome: "skipped",
              reason
            });
            await appendApolloContactActivity({
              tenantId,
              contactId: contact.contactId,
              note: verificationWasRateLimited
                ? `Apollo accepted the sequence push on ${pushedAtIso}, but Newl Apps hit Apollo rate limits before verification finished for "${group.sequenceName}". Use Sync Apollo status instead of re-pushing. ${summarizeApolloSequencePushResponse(pushResult.rawPayload)}`
                : `Apollo accepted the sequence push on ${pushedAtIso}, but the cadence enrollment was still propagating and was not yet visible in "${group.sequenceName}" during Newl Apps verification. ${summarizeApolloSequencePushResponse(pushResult.rawPayload)}`
            });
            await storeApolloSequencePushSnapshot({
              tenantId,
              contactId: contact.contactId,
              sequenceId: group.sequenceId,
              sequenceName: group.sequenceName,
              payload: pushResult.rawPayload
            });
            if (verificationWasRateLimited) {
              await persistApolloPushBlocker({
                tenantId,
                contactId: contact.contactId,
                reason
              });
            }
            await persistApolloPushJobProgress(jobRunId, output);
            continue;
          }

          output.enrolledContacts += 1;
          output.processedContacts += 1;
          output.details.push({
            contactId: contact.contactId,
            contactName: contact.fullName,
            companyName: group.companyName,
            outcome: "enrolled",
            reason: `Enrolled in "${group.sequenceName}".`
          });
          await appendApolloContactActivity({
            tenantId,
            contactId: contact.contactId,
            note:
              `Apollo sequence push completed on ${pushedAtIso}. Enrolled in "${group.sequenceName}" as ${contact.fullName}. ` +
              `${summarizeApolloSequencePushResponse(pushResult.rawPayload)}`
          });
          await storeApolloSequencePushSnapshot({
            tenantId,
            contactId: contact.contactId,
            sequenceId: group.sequenceId,
            sequenceName: group.sequenceName,
            payload: pushResult.rawPayload
          });

          if (contact.draftId && contact.requiresAiDraft) {
            await prisma.contactOutreachDraft.update({
              where: {
                id: contact.draftId
              },
              data: {
                status: ContactOutreachDraftStatus.PUSHED_TO_APOLLO
              }
            });
          }

          await persistApolloPushBlocker({
            tenantId,
            contactId: contact.contactId,
            reason: null
          });

          await persistApolloPushJobProgress(jobRunId, output);
        }
      } catch (error) {
        const isRateLimited = error instanceof ApolloRateLimitError;
        const reason = isRateLimited
          ? "Apollo rate limit reached during sequence push. Wait a moment, then retry the blocked contacts instead of immediately re-running the whole batch."
          : error instanceof Error
            ? error.message
            : "Apollo sequence push failed.";
        failureReasons.add(reason);
        if (isRateLimited) {
          batchRateLimitReason = reason;
        }

        for (const contact of group.contacts) {
          if (isRateLimited) {
            output.skippedContacts += 1;
          } else {
            output.failedContacts += 1;
          }
          output.processedContacts += 1;
          output.details.push({
            contactId: contact.contactId,
            contactName: contact.fullName,
            companyName: group.companyName,
            outcome: isRateLimited ? "skipped" : "failed",
            reason
          });
          await appendApolloContactActivity({
            tenantId,
            contactId: contact.contactId,
            note: `Apollo sequence push ${isRateLimited ? "paused" : "failed"} on ${new Date().toISOString()}. ${reason}`
          });
          await persistApolloPushBlocker({
            tenantId,
            contactId: contact.contactId,
            reason
          });
        }

        await persistApolloPushJobProgress(jobRunId, output);

        if (isRateLimited) {
          for (let pendingIndex = index + 1; pendingIndex < groupedPushes.length; pendingIndex += 1) {
            const pendingGroup = groupedPushes[pendingIndex]!;
            for (const pendingContact of pendingGroup.contacts) {
              output.skippedContacts += 1;
              output.processedContacts += 1;
              output.details.push({
                contactId: pendingContact.contactId,
                contactName: pendingContact.fullName,
                companyName: pendingGroup.companyName,
                outcome: "skipped",
                reason
              });
              await appendApolloContactActivity({
                tenantId,
                contactId: pendingContact.contactId,
                note: `Apollo sequence push paused on ${new Date().toISOString()}. ${reason}`
              });
              await persistApolloPushBlocker({
                tenantId,
                contactId: pendingContact.contactId,
                reason
              });
            }
          }

          await persistApolloPushJobProgress(jobRunId, output);
          break;
        }
      }
    }

    output.completedAt = new Date().toISOString();
    await prisma.automationJobRun.update({
      where: {
        id: jobRunId
      },
      data: {
        status: output.failedContacts > 0 && output.enrolledContacts === 0 ? JobStatus.ERROR : JobStatus.SUCCESS,
        finishedAt: new Date(),
        output,
        errorMessage:
          output.failedContacts > 0 && output.enrolledContacts === 0
            ? [...failureReasons][0] ?? "Apollo push failed."
            : batchRateLimitReason ?? null,
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: userId,
        action: "lead-gen.apollo-push.completed",
        entityType: "AutomationJobRun",
        entityId: jobRunId,
        after: output
      }
    });

    revalidateLeadGenSurfaces();
  } catch (error) {
    output.completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Apollo push failed.";

    await prisma.automationJobRun.update({
      where: {
        id: jobRunId
      },
      data: {
        status: JobStatus.ERROR,
        finishedAt: new Date(),
        output,
        errorMessage: message
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: userId,
        action: "lead-gen.apollo-push.failed",
        entityType: "AutomationJobRun",
        entityId: jobRunId,
        after: {
          errorMessage: message,
          ...output
        }
      }
    });
  }
}

async function persistApolloPushJobProgress(jobRunId: string, output: ApolloPushJobOutput) {
  await prisma.automationJobRun.update({
    where: {
      id: jobRunId
    },
    data: {
      output
    }
  });
}

export async function syncSelectedApolloStatusesAction(formData: FormData): Promise<ContactBulkActionSummary>;
export async function syncSelectedApolloStatusesAction(
  previousState: ContactBulkActionSummary,
  formData: FormData
): Promise<ContactBulkActionSummary>;
export async function syncSelectedApolloStatusesAction(
  firstArg: ContactBulkActionSummary | FormData,
  secondArg?: FormData
): Promise<ContactBulkActionSummary> {
  const context = await authorizeLeadGenMutation();
  const formData = firstArg instanceof FormData ? firstArg : secondArg;

  if (!formData) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "apollo_sync",
      message: "No Apollo sync payload was provided.",
      completedAt: new Date().toISOString()
    };
  }

  try {
    const contactIds = readSelectedIds(formData, "contactId");
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId: context.tenantId,
        id: {
          in: contactIds
        }
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            domain: true,
            linkedinUrl: true,
            apolloOrganizationId: true
          }
        }
      }
    });

    if (contacts.length !== contactIds.length) {
      throw new Error("One or more selected contacts were not found for this tenant.");
    }

    const companies = new Map<
      string,
      {
        id: string;
        name: string;
        domain: string | null;
        linkedinUrl: string | null;
        apolloOrganizationId: string | null;
        contacts: typeof contacts;
      }
    >();

    for (const contact of contacts) {
      const existing = companies.get(contact.companyId);
      if (existing) {
        existing.contacts.push(contact);
      } else {
        companies.set(contact.companyId, {
          id: contact.company.id,
          name: contact.company.name,
          domain: contact.company.domain,
          linkedinUrl: contact.company.linkedinUrl,
          apolloOrganizationId: contact.company.apolloOrganizationId,
          contacts: [contact]
        });
      }
    }

    let syncedContacts = 0;
    let failedContacts = 0;
    let skippedContacts = 0;
    const failureReasons = new Set<string>();

    for (const company of companies.values()) {
      try {
        const lookup = await fetchApolloContactsForCompany({
          companyName: company.name,
          domain: company.domain,
          apolloOrganizationId: company.apolloOrganizationId
        });

        const updatedCount = await syncExistingApolloContactsForCompany({
          tenantId: context.tenantId,
          companyId: company.id,
          existingContacts: company.contacts,
          lookup
        });

        syncedContacts += updatedCount;
        skippedContacts += Math.max(0, company.contacts.length - updatedCount);
      } catch (error) {
        failedContacts += company.contacts.length;
        failureReasons.add(error instanceof Error ? error.message : "Apollo status sync failed.");
      }
    }

    revalidateLeadGenSurfaces();

    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: failedContacts > 0 && syncedContacts === 0 ? "error" : "success",
      operation: "apollo_sync",
      message:
        syncedContacts > 0
          ? `Apollo status sync updated ${syncedContacts} contact${syncedContacts === 1 ? "" : "s"} across ${companies.size} compan${companies.size === 1 ? "y" : "ies"}.`
          : [...failureReasons][0] ?? "Apollo status sync did not find any matching contacts to refresh.",
      completedAt: new Date().toISOString(),
      selectedContacts: contactIds.length,
      syncedContacts,
      skippedContacts,
      failedContacts,
      companiesTouched: companies.size
    };
  } catch (error) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "apollo_sync",
      message: error instanceof Error ? error.message : "Apollo status sync failed.",
      completedAt: new Date().toISOString()
    };
  }
}

export async function saveContactDraftAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
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
      status: ContactOutreachDraftStatus.APPROVED,
      editedAt: new Date(),
      approvedAt: new Date()
    }
  });

  revalidateLeadGenSurfaces();
}

export async function approveContactDraftAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
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
      status: ContactOutreachDraftStatus.APPROVED,
      editedAt: new Date(),
      approvedAt: new Date()
    }
  });

  revalidateLeadGenSurfaces();
}

export async function generateContactDraftAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();

  if (!isOpenAiDraftGenerationConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to enable live Tier 1 draft generation.");
  }

  if (!(await isLeadGenAiEnabled(context.tenantId))) {
    throw new Error("Lead-generation AI is disabled in Settings. Enable it before generating drafts.");
  }

  const contactId = readRequired(formData, "contactId");
  await generateAiDraftForContact({
    tenantId: context.tenantId,
    contactId,
    forceRegenerate: true
  });

  revalidateLeadGenSurfaces();
}

function revalidateTradeMiningProfileSurfaces() {
  revalidatePath("/lead-gen/search-profiles");
  revalidatePath("/lead-gen/candidates");
  revalidatePath("/dashboard");
  revalidatePath("/operations/logs");
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
      doNotProspect: status === CandidateStatus.DISQUALIFIED ? true : status === CandidateStatus.REJECTED ? false : false,
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
    const score = (await calculateLeadPipelineScoreForCompany({ tenantId }, companyId)) ?? 0;

    await client.lead.upsert({
      where: {
        tenantId_companyId: {
          tenantId,
          companyId
        }
      },
      update: {
        stage: LeadPipelineStage.NEW,
        score
      },
      create: {
        tenantId,
        companyId,
        stage: LeadPipelineStage.NEW,
        score
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
        doNotProspect: true,
        candidateStatusUpdatedAt: new Date(),
        candidateStatusReason: "Pipeline account was disqualified."
      }
    });
  }
}

async function applySequenceSelectionToContacts({
  tenantId,
  contactIds,
  sequenceId,
  overrideReason,
  confirmExistingSequenceOverride
}: {
  tenantId: string;
  contactIds: string[];
  sequenceId: string;
  overrideReason: string | null;
  confirmExistingSequenceOverride: boolean;
}) {
  const sequence = await resolveTenantSequenceOption(tenantId, sequenceId);

  if (!sequence) {
    throw new Error("Selected sequence is not recognized.");
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      id: {
        in: contactIds
      }
    },
    select: {
      id: true,
      sequenceStatus: true
    }
  });

  if (contacts.length !== contactIds.length) {
    throw new Error("One or more contacts were not found for this tenant.");
  }

  const protectedContacts = contacts.filter((contact) => requiresSequenceOverrideConfirmation(contact.sequenceStatus));

  if (protectedContacts.length > 0 && !confirmExistingSequenceOverride) {
    throw new Error(
      "One or more selected contacts already show Apollo sequence history. Confirm the override before assigning a new cadence."
    );
  }

  const eligibleContactIds = contacts
    .filter((contact) => canBulkUpdateContactSequence(contact.sequenceStatus))
    .map((contact) => contact.id);
  const protectedContactIds = protectedContacts.map((contact) => contact.id);

  await prisma.contact.updateMany({
    where: {
      tenantId,
      id: {
        in: contactIds
      }
    },
    data: {
      selectedSequenceId: sequence.id,
      selectedSequenceName: sequence.name,
      sequenceOverrideReason: overrideReason,
      sequenceManuallyOverridden: true
    }
  });

  if (eligibleContactIds.length > 0) {
    await prisma.contact.updateMany({
      where: {
        tenantId,
        id: {
          in: eligibleContactIds
        }
      },
      data: {
        sequenceStatus: SequenceStatus.READY
      }
    });
  }

  if (protectedContactIds.length > 0) {
    await prisma.contact.updateMany({
      where: {
        tenantId,
        id: {
          in: protectedContactIds
        }
      },
      data: {
        sequenceOverrideReason:
          overrideReason ?? "User confirmed a new cadence selection despite existing Apollo sequence history."
      }
    });
  }

  return {
    updatedContacts: contactIds.length,
    readyContacts: eligibleContactIds.length,
    protectedContacts: protectedContactIds.length
  };
}

async function resolveTenantSequenceOption(tenantId: string, sequenceId: string) {
  const apolloCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      provider: "APOLLO"
    },
    select: {
      publicConfig: true
    }
  });

  return buildSequenceCatalogItems(parseApolloSequenceDirectory(apolloCredential?.publicConfig)).find(
    (item) => item.id === sequenceId
  ) ?? null;
}

type ApolloPushGroup = {
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  apolloOrganizationId: string | null;
  sequenceId: string;
  sequenceName: string;
  apolloOwnerUserId: string;
  sendFromEmailAccountId: string;
  contacts: ApolloPushReadyContact[];
};

type ApolloPushContactRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  fullName: string;
  email: string | null;
  assignedRep: string | null;
  recommendedSequenceId: string | null;
  recommendedSequenceName: string | null;
  selectedSequenceId: string | null;
  selectedSequenceName: string | null;
  apolloContactId: string | null;
  sequenceStatus: SequenceStatus;
  company: {
    id: string;
    name: string;
    domain: string | null;
    linkedinUrl: string | null;
    apolloOrganizationId: string | null;
  };
  outreachDrafts: Array<{
    id: string;
    status: ContactOutreachDraftStatus;
  }>;
};

type ApolloSyncContactRecord = {
  id: string;
  companyId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  contactStatus: ContactStatus;
  apolloContactId: string | null;
  apolloPersonId: string | null;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
  recommendedSequenceName: string | null;
  recommendedSequenceId: string | null;
  selectedSequenceName: string | null;
  selectedSequenceId: string | null;
  sequenceRecommendationReason: string | null;
  sequenceOverrideReason: string | null;
  sequenceManuallyOverridden: boolean;
  lastTouchAt: Date | null;
  lastReplyAt: Date | null;
  assignedRep: string | null;
  rawJson: Prisma.JsonValue | null;
  company: {
    id: string;
    name: string;
    domain: string | null;
    linkedinUrl: string | null;
    apolloOrganizationId: string | null;
  };
};

type ApolloPushReadyContact = {
  contactId: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  apolloOrganizationId: string | null;
  fullName: string;
  apolloContactId: string;
  sequenceId: string;
  sequenceName: string;
  apolloOwnerUserId: string;
  sendFromEmailAccountId: string;
  requiresAiDraft: boolean;
  draftId: string | null;
};

function resolveEffectiveApolloSequence(contact: ApolloPushContactRecord) {
  return {
    id: contact.selectedSequenceId ?? contact.recommendedSequenceId ?? null,
    name: contact.selectedSequenceName ?? contact.recommendedSequenceName ?? null,
    usedRecommendationFallback: !contact.selectedSequenceId || !contact.selectedSequenceName
  };
}

async function loadApolloRepMappings(tenantId: string) {
  const credential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      provider: "APOLLO"
    },
    select: {
      publicConfig: true
    }
  });

  return parseApolloRepMapping(credential?.publicConfig);
}

async function resolveAssignedRepUser({
  tenantId,
  assignedRep
}: {
  tenantId: string;
  assignedRep: string;
}) {
  const normalizedAssignedRep = assignedRep.trim();

  if (!normalizedAssignedRep) {
    return null;
  }

  const byId = await prisma.user.findUnique({
    where: {
      id: normalizedAssignedRep
    },
    select: {
      id: true,
      email: true,
      name: true
    }
  });

  if (byId) {
    return byId;
  }

  const membershipMatch = await prisma.membership.findFirst({
    where: {
      tenantId,
      user: {
        OR: [
          {
            email: {
              equals: normalizedAssignedRep,
              mode: "insensitive"
            }
          },
          {
            name: {
              equals: normalizedAssignedRep,
              mode: "insensitive"
            }
          }
        ]
      }
    },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          name: true
        }
      }
    }
  });

  return membershipMatch?.user ?? null;
}

async function validateApolloPushCandidate({
  tenantId,
  contact,
  repMappings,
  emailAccounts,
  companyLookup
}: {
  tenantId: string;
  contact: ApolloPushContactRecord;
  repMappings: ReturnType<typeof parseApolloRepMapping>;
  emailAccounts: ApolloEmailAccountDirectoryEntry[];
  companyLookup?: ApolloContactLookupResult;
}): Promise<{ ok: true } & ApolloPushReadyContact | { ok: false; reason: string }> {
  let effectiveSequence = resolveEffectiveApolloSequence(contact);

  if (!contact.apolloContactId) {
    return { ok: false, reason: "Apollo contact ID is missing. Enrich the company again before pushing." };
  }

  if (!contact.email) {
    return { ok: false, reason: "Contact email is missing, so this contact stays out of sequence push." };
  }

  if (!effectiveSequence.id || !effectiveSequence.name) {
    const draftContext = await loadAiDraftContactContext({
      tenantId,
      contactId: contact.id
    });

    if (draftContext?.selectedSequenceId && draftContext.selectedSequenceName) {
      effectiveSequence = {
        id: draftContext.selectedSequenceId,
        name: draftContext.selectedSequenceName,
        usedRecommendationFallback: true
      };
    }
  }

  if (!effectiveSequence.id || !effectiveSequence.name) {
    return { ok: false, reason: "No Apollo cadence is selected for this contact yet." };
  }

  if (
    contact.sequenceStatus !== SequenceStatus.NOT_STARTED &&
    contact.sequenceStatus !== SequenceStatus.READY
  ) {
    const liveSequenceStatus = await refreshApolloSequenceStatusForPush({
      tenantId,
      contact,
      companyLookup
    });

    if (!canBulkUpdateContactSequence(liveSequenceStatus)) {
      return {
        ok: false,
        reason: "This contact already shows Apollo sequence history. Review it before pushing again."
      };
    }
  }

  if (!contact.assignedRep) {
    return { ok: false, reason: "Assign a sales rep before pushing this contact to Apollo." };
  }

  const localOwner = await resolveAssignedRepUser({
    tenantId,
    assignedRep: contact.assignedRep
  });

  if (!localOwner) {
    return { ok: false, reason: "Assigned rep no longer exists in Newl Apps." };
  }

  if (contact.assignedRep !== localOwner.id) {
    await prisma.contact.update({
      where: {
        id: contact.id
      },
      data: {
        assignedRep: localOwner.id
      }
    });
  }

  const repMapping = repMappings.find(
    (entry) =>
      entry.active &&
      ((entry.sendFromEmail && localOwner.email && entry.sendFromEmail.toLowerCase() === localOwner.email.toLowerCase()) ||
        (entry.sequenceOwnerName && localOwner.name && entry.sequenceOwnerName.toLowerCase() === localOwner.name.toLowerCase()))
  );

  if (!repMapping?.apolloUserId) {
    return {
      ok: false,
      reason: `Apollo rep mapping is missing for ${localOwner.name ?? localOwner.email ?? "the assigned rep"}.`
    };
  }

  const resolvedSendFromEmailAccountId = resolveApolloSendFromEmailAccountId({
    repMapping,
    localOwner,
    emailAccounts
  });

  if (!resolvedSendFromEmailAccountId) {
    return {
      ok: false,
      reason: `Apollo send-from email account is missing for ${localOwner.name ?? localOwner.email ?? "the assigned rep"}.`
    };
  }

  const latestDraft = contact.outreachDrafts[0] ?? null;
  const requiresAiDraft = await contactRequiresApprovedDraft(tenantId, contact.id);

  if (requiresAiDraft && latestDraft?.status !== ContactOutreachDraftStatus.APPROVED) {
    return {
      ok: false,
      reason: "This cadence requires an approved AI draft before Apollo push."
    };
  }

  if (effectiveSequence.usedRecommendationFallback) {
    await prisma.contact.update({
      where: {
        id: contact.id
      },
      data: {
        selectedSequenceId: effectiveSequence.id,
        selectedSequenceName: effectiveSequence.name
      }
    });
  }

  if (repMapping.sendFromEmailAccountId !== resolvedSendFromEmailAccountId) {
    await persistApolloRepEmailAccountId({
      tenantId,
      repEntryId: repMapping.id,
      sendFromEmailAccountId: resolvedSendFromEmailAccountId
    });
  }

  return {
    ok: true,
    contactId: contact.id,
    companyId: contact.companyId,
    companyName: contact.company.name,
    companyDomain: contact.company.domain,
    apolloOrganizationId: contact.company.apolloOrganizationId,
    fullName: contact.fullName,
    apolloContactId: contact.apolloContactId,
    sequenceId: effectiveSequence.id,
    sequenceName: effectiveSequence.name,
    apolloOwnerUserId: repMapping.apolloUserId,
    sendFromEmailAccountId: resolvedSendFromEmailAccountId,
    requiresAiDraft,
    draftId: latestDraft?.id ?? null
  };
}

function resolveApolloSendFromEmailAccountId({
  repMapping,
  localOwner,
  emailAccounts
}: {
  repMapping: ReturnType<typeof parseApolloRepMapping>[number];
  localOwner: { id: string; email: string | null; name: string | null };
  emailAccounts: ApolloEmailAccountDirectoryEntry[];
}) {
  if (repMapping.sendFromEmailAccountId && !repMapping.sendFromEmailAccountId.includes("@")) {
    return repMapping.sendFromEmailAccountId;
  }

  const normalizedEmail = (repMapping.sendFromEmail ?? localOwner.email)?.trim().toLowerCase() ?? null;
  if (!normalizedEmail) {
    return null;
  }

  const exact = emailAccounts.find(
    (entry) =>
      entry.active &&
      entry.email?.toLowerCase() === normalizedEmail &&
      (!repMapping.apolloUserId || !entry.userId || entry.userId === repMapping.apolloUserId)
  );

  if (exact) {
    return exact.id;
  }

  const fallback = emailAccounts.find(
    (entry) => entry.active && entry.email?.toLowerCase() === normalizedEmail
  );

  return fallback?.id ?? null;
}

async function persistApolloRepEmailAccountId({
  tenantId,
  repEntryId,
  sendFromEmailAccountId
}: {
  tenantId: string;
  repEntryId: string;
  sendFromEmailAccountId: string;
}) {
  const credential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      provider: "APOLLO"
    },
    select: {
      id: true,
      publicConfig: true
    }
  });

  if (!credential) {
    return;
  }

  const entries = parseApolloRepMapping(credential.publicConfig);
  const updatedEntries = entries.map((entry) =>
    entry.id === repEntryId ? { ...entry, sendFromEmailAccountId } : entry
  );

  if (!updatedEntries.some((entry) => entry.id === repEntryId)) {
    return;
  }

  await prisma.integrationCredential.update({
    where: {
      id: credential.id
    },
    data: {
      publicConfig: {
        ...(credential.publicConfig && typeof credential.publicConfig === "object"
          ? (credential.publicConfig as Record<string, unknown>)
          : {}),
        apolloUserMapping: updatedEntries.map((entry) => ({
          id: entry.id,
          sequence_owner_name: entry.sequenceOwnerName,
          active: entry.active,
          apollo_user_id: entry.apolloUserId,
          send_from_email: entry.sendFromEmail,
          send_from_email_account_id: entry.sendFromEmailAccountId
        }))
      }
    }
  });
}

async function contactRequiresApprovedDraft(tenantId: string, contactId: string) {
  const contactContext = await loadAiDraftContactContext({
    tenantId,
    contactId
  });

  return contactContext?.requiresAiDraft ?? false;
}

async function syncExistingApolloContactsForCompany({
  tenantId,
  companyId,
  existingContacts,
  lookup
}: {
  tenantId: string;
  companyId: string;
  existingContacts: ApolloSyncContactRecord[];
  lookup: ApolloContactLookupResult;
}) {
  const lead = await prisma.lead.findFirst({
    where: {
      tenantId,
      companyId
    },
    select: {
      id: true
    }
  });
  let updatedCount = 0;

  for (const existing of existingContacts) {
    const incoming = matchIncomingApolloContact(
      lookup.contacts,
      {
        id: existing.id,
        firstName: existing.firstName,
        lastName: existing.lastName,
        fullName: existing.fullName,
        title: existing.title,
        department: existing.department,
        seniority: existing.seniority,
        email: existing.email,
        phone: existing.phone,
        linkedinUrl: existing.linkedinUrl,
        contactStatus: existing.contactStatus,
        apolloContactId: existing.apolloContactId,
        apolloPersonId: existing.apolloPersonId,
        sequenceStatus: existing.sequenceStatus,
        replyStatus: existing.replyStatus,
        recommendedSequenceName: existing.recommendedSequenceName,
        recommendedSequenceId: existing.recommendedSequenceId,
        selectedSequenceName: existing.selectedSequenceName,
        selectedSequenceId: existing.selectedSequenceId,
        sequenceRecommendationReason: existing.sequenceRecommendationReason,
        sequenceOverrideReason: existing.sequenceOverrideReason,
        sequenceManuallyOverridden: existing.sequenceManuallyOverridden,
        lastTouchAt: existing.lastTouchAt,
        lastReplyAt: existing.lastReplyAt,
        assignedRep: existing.assignedRep,
        rawJson: existing.rawJson
      }
    );

    if (!incoming) {
      continue;
    }

    const merged = buildApolloContactMutation({
      tenantId,
      companyId,
      leadId: lead?.id ?? existing.id,
      assignedRep: existing.assignedRep ?? "",
      existing: {
        id: existing.id,
        firstName: existing.firstName,
        lastName: existing.lastName,
        fullName: existing.fullName,
        title: existing.title,
        department: existing.department,
        seniority: existing.seniority,
        email: existing.email,
        phone: existing.phone,
        linkedinUrl: existing.linkedinUrl,
        contactStatus: existing.contactStatus,
        apolloContactId: existing.apolloContactId,
        apolloPersonId: existing.apolloPersonId,
        sequenceStatus: existing.sequenceStatus,
        replyStatus: existing.replyStatus,
        recommendedSequenceName: existing.recommendedSequenceName,
        recommendedSequenceId: existing.recommendedSequenceId,
        selectedSequenceName: existing.selectedSequenceName,
        selectedSequenceId: existing.selectedSequenceId,
        sequenceRecommendationReason: existing.sequenceRecommendationReason,
        sequenceOverrideReason: existing.sequenceOverrideReason,
        sequenceManuallyOverridden: existing.sequenceManuallyOverridden,
        lastTouchAt: existing.lastTouchAt,
        lastReplyAt: existing.lastReplyAt,
        assignedRep: existing.assignedRep,
        rawJson: existing.rawJson
      },
      incoming
    });

    await prisma.contact.update({
      where: {
        id: existing.id
      },
      data: merged
    });

    updatedCount += 1;
    await appendApolloContactActivity({
      tenantId,
      contactId: existing.id,
      note: `Apollo status sync refreshed on ${new Date().toISOString()}. Sequence ${incoming.sequenceName ?? "status"} now reads ${incoming.sequenceStatus.toLowerCase()}.`
    });
  }

  return updatedCount;
}

function matchIncomingApolloContact(
  incomingContacts: ApolloContactRecord[],
  existingContact: Parameters<typeof matchExistingApolloContact>[0][number]
) {
  const normalizedEmail = existingContact.email?.trim().toLowerCase() ?? null;
  const normalizedLinkedin = existingContact.linkedinUrl?.trim().toLowerCase() ?? null;
  const normalizedFullName = existingContact.fullName.trim().toLowerCase();
  const normalizedTitle = existingContact.title?.trim().toLowerCase() ?? null;

  return (
    incomingContacts.find(
      (incoming) =>
        (existingContact.apolloContactId && incoming.apolloContactId === existingContact.apolloContactId) ||
        (existingContact.apolloPersonId && incoming.apolloPersonId === existingContact.apolloPersonId)
    ) ??
    incomingContacts.find((incoming) => normalizedEmail && incoming.email?.trim().toLowerCase() === normalizedEmail) ??
    incomingContacts.find(
      (incoming) => normalizedLinkedin && incoming.linkedinUrl?.trim().toLowerCase() === normalizedLinkedin
    ) ??
    incomingContacts.find(
      (incoming) =>
        incoming.fullName.trim().toLowerCase() === normalizedFullName &&
        (incoming.title?.trim().toLowerCase() ?? null) === normalizedTitle
    ) ??
    null
  );
}

function isApolloContactEnrolledInSequence(
  incoming: ApolloContactRecord | null,
  sequenceId: string
) {
  if (!incoming) {
    return false;
  }

  return incoming.sequenceId === sequenceId && incoming.sequenceStatus !== SequenceStatus.NOT_STARTED;
}

async function verifyApolloSequencePush({
  companyName,
  companyDomain,
  apolloOrganizationId,
  targetContacts,
  sequenceId
}: {
  companyName: string;
  companyDomain: string | null;
  apolloOrganizationId: string | null;
  targetContacts: ApolloPushReadyContact[];
  sequenceId: string;
}) {
  const delaysMs = [0, 1500, 3000, 5000];
  let latestLookup: ApolloContactLookupResult | null = null;

  for (const delayMs of delaysMs) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    latestLookup = await fetchApolloContactsForCompany(
      {
        companyName,
        domain: companyDomain,
        apolloOrganizationId
      },
      {
        allowPeopleSearchFallback: false,
        keywordSearchLimit: 0
      }
    );
    const currentLookup = latestLookup;

    const allVerified = targetContacts.every((target) => {
      const incoming = matchIncomingApolloPushTarget(currentLookup.contacts, target);
      return isApolloContactEnrolledInSequence(incoming, sequenceId);
    });

    if (allVerified) {
      return latestLookup;
    }
  }

  return (
    latestLookup ??
    (await fetchApolloContactsForCompany(
      {
        companyName,
        domain: companyDomain,
        apolloOrganizationId
      },
      {
        allowPeopleSearchFallback: false,
        keywordSearchLimit: 0
      }
    ))
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function matchIncomingApolloPushTarget(
  incomingContacts: ApolloContactRecord[],
  targetContact: ApolloPushReadyContact
) {
  const normalizedFullName = targetContact.fullName.trim().toLowerCase();

  return (
    incomingContacts.find((incoming) => incoming.apolloContactId === targetContact.apolloContactId) ??
    incomingContacts.find((incoming) => incoming.fullName.trim().toLowerCase() === normalizedFullName) ??
    null
  );
}

async function storeApolloSequencePushSnapshot({
  tenantId,
  contactId,
  sequenceId,
  sequenceName,
  payload
}: {
  tenantId: string;
  contactId: string;
  sequenceId: string;
  sequenceName: string;
  payload: Record<string, unknown>;
}) {
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId
    },
    select: {
      id: true,
      rawJson: true
    }
  });

  if (!contact) {
    return;
  }

  const currentRawJson = isJsonObject(contact.rawJson) ? contact.rawJson : {};
  const apolloData = isJsonObject(currentRawJson.apollo) ? currentRawJson.apollo : {};

  await prisma.contact.update({
    where: {
      id: contactId
    },
    data: {
      rawJson: toInputJsonValue({
        ...currentRawJson,
        apollo: {
          ...apolloData,
          lastSequencePush: {
            capturedAt: new Date().toISOString(),
            sequenceId,
            sequenceName,
            responseSummary: summarizeApolloSequencePushResponse(payload),
            response: payload
          }
        }
      })
    }
  });
}

function summarizeApolloSequencePushResponse(payload: Record<string, unknown>) {
  const directMessage = extractApolloPushSummaryMessage(payload);
  const keys = Object.keys(payload).slice(0, 8);
  const summaryParts = [directMessage, keys.length > 0 ? `Apollo response keys: ${keys.join(", ")}` : null].filter(Boolean);
  return summaryParts.length > 0 ? summaryParts.join(". ") : "Apollo returned a response, but it did not include a readable summary message.";
}

function extractApolloPushSummaryMessage(payload: Record<string, unknown>) {
  const direct = readStringFromUnknown(payload["message"]) ?? readStringFromUnknown(payload["error"]) ?? readStringFromUnknown(payload["detail"]);
  if (direct) {
    return `Apollo response: ${direct}`;
  }

  const errors = payload["errors"];
  if (errors && typeof errors === "object") {
    const nested = errors as Record<string, unknown>;
    const nestedMessage =
      readStringFromUnknown(nested["message"]) ??
      readStringFromUnknown(nested["base"]) ??
      readStringFromUnknown(nested["detail"]);
    if (nestedMessage) {
      return `Apollo response: ${nestedMessage}`;
    }
  }

  return null;
}

function readStringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function appendApolloContactActivity({
  tenantId,
  contactId,
  note
}: {
  tenantId: string;
  contactId: string;
  note: string;
}) {
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId
    },
    select: {
      id: true,
      rawJson: true
    }
  });

  if (!contact) {
    return;
  }

  const currentRawJson = isJsonObject(contact.rawJson) ? contact.rawJson : {};
  const apolloData = isJsonObject(currentRawJson.apollo) ? currentRawJson.apollo : {};
  const activity = Array.isArray(apolloData.activity) ? apolloData.activity.filter((entry) => typeof entry === "string") : [];

  await prisma.contact.update({
    where: {
      id: contactId
    },
    data: {
      rawJson: toInputJsonValue({
        ...currentRawJson,
        apollo: {
          ...apolloData,
          activity: [note, ...activity].slice(0, 25)
        }
      })
    }
  });
}

async function persistApolloPushBlocker({
  tenantId,
  contactId,
  reason
}: {
  tenantId: string;
  contactId: string;
  reason: string | null;
}) {
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId
    },
    select: {
      id: true,
      rawJson: true
    }
  });

  if (!contact) {
    return;
  }

  const currentRawJson = isJsonObject(contact.rawJson) ? contact.rawJson : {};
  const apolloData = isJsonObject(currentRawJson.apollo) ? currentRawJson.apollo : {};
  const existingBlocker = isJsonObject(apolloData.pushBlocker) ? apolloData.pushBlocker : null;

  const nextApolloData =
    reason && reason.trim().length > 0
      ? {
          ...apolloData,
          pushBlocker: {
            reason: reason.trim(),
            blockedAt:
              readString(existingBlocker ?? {}, "blockedAt") ??
              new Date().toISOString()
          }
        }
      : Object.fromEntries(Object.entries(apolloData).filter(([key]) => key !== "pushBlocker"));

  await prisma.contact.update({
    where: {
      id: contactId
    },
    data: {
      rawJson: toInputJsonValue({
        ...currentRawJson,
        apollo: nextApolloData
      })
    }
  });
}

function canBulkUpdateContactSequence(sequenceStatus: SequenceStatus) {
  return sequenceStatus === SequenceStatus.NOT_STARTED || sequenceStatus === SequenceStatus.READY;
}

function shouldRefreshApolloSequenceStatus(sequenceStatus: SequenceStatus) {
  return !canBulkUpdateContactSequence(sequenceStatus);
}

function requiresSequenceOverrideConfirmation(sequenceStatus: SequenceStatus) {
  return !canBulkUpdateContactSequence(sequenceStatus);
}

async function getApolloCompanyLookupForContact(
  contact: ApolloPushContactRecord,
  cache: Map<string, Promise<ApolloContactLookupResult>>
) {
  const cacheKey = [
    contact.companyId,
    contact.company.apolloOrganizationId ?? "",
    contact.company.domain ?? "",
    contact.company.name
  ].join("|");

  const existing = cache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const lookupPromise = fetchApolloContactsForCompany({
    companyName: contact.company.name,
    domain: contact.company.domain,
    apolloOrganizationId: contact.company.apolloOrganizationId
  }, {
    allowPeopleSearchFallback: false,
    keywordSearchLimit: 0
  });
  cache.set(cacheKey, lookupPromise);
  return lookupPromise;
}

async function refreshApolloSequenceStatusForPush({
  tenantId,
  contact,
  companyLookup
}: {
  tenantId: string;
  contact: ApolloPushContactRecord;
  companyLookup?: ApolloContactLookupResult;
}) {
  const lookup =
    companyLookup ??
    (await fetchApolloContactsForCompany({
      companyName: contact.company.name,
      domain: contact.company.domain,
      apolloOrganizationId: contact.company.apolloOrganizationId
    }, {
      allowPeopleSearchFallback: false,
      keywordSearchLimit: 0
    }));

  const incoming = matchIncomingApolloContact(lookup.contacts, {
    id: contact.id,
    firstName: null,
    lastName: null,
    fullName: contact.fullName,
    title: null,
    department: null,
    seniority: null,
    email: contact.email,
    phone: null,
    linkedinUrl: null,
    contactStatus: ContactStatus.REVIEWING,
    apolloContactId: contact.apolloContactId,
    apolloPersonId: null,
    sequenceStatus: contact.sequenceStatus,
    replyStatus: ReplyStatus.NO_REPLY,
    recommendedSequenceName: contact.recommendedSequenceName,
    recommendedSequenceId: contact.recommendedSequenceId,
    selectedSequenceName: contact.selectedSequenceName,
    selectedSequenceId: contact.selectedSequenceId,
    sequenceRecommendationReason: null,
    sequenceOverrideReason: null,
    sequenceManuallyOverridden: false,
    lastTouchAt: null,
    lastReplyAt: null,
    assignedRep: contact.assignedRep,
    rawJson: null
  });

  const resolvedSequenceStatus = incoming?.sequenceStatus ?? SequenceStatus.NOT_STARTED;

  if (resolvedSequenceStatus !== contact.sequenceStatus) {
    await prisma.contact.update({
      where: {
        id: contact.id
      },
      data: {
        sequenceStatus: resolvedSequenceStatus
      }
    });

    await appendApolloContactActivity({
      tenantId,
      contactId: contact.id,
      note:
        `Apollo push validation refreshed sequence status on ${new Date().toISOString()}. ` +
        `Status now reads ${resolvedSequenceStatus.toLowerCase()}.`
    });
  }

  return resolvedSequenceStatus;
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
    allowedCompanyIdentityRoles: readSelectedCompanyIdentityRoles(formData),
    excludedCompanyKeywords: readStringList(formData, "excludedCompanyKeywords"),
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

function readSelectedCompanyIdentityRoles(formData: FormData) {
  const values = formData
    .getAll("allowedCompanyIdentityRole")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (values.length === 0) {
    return defaultTradeMiningCompanyIdentityRoles;
  }

  const allowed = new Set(tradeMiningCompanyIdentityRoleOptions.map((option) => option.value));
  return values.filter(
    (value, index, array): value is (typeof tradeMiningCompanyIdentityRoleOptions)[number]["value"] =>
      allowed.has(value as (typeof tradeMiningCompanyIdentityRoleOptions)[number]["value"]) &&
      array.indexOf(value) === index
  );
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

function readConfirmationBoolean(formData: FormData, field: string) {
  const value = formData.get(field);
  return value === "true" || value === "on" || value === "yes";
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

async function syncApolloContactsForLead({
  tenantId,
  leadId,
  companyId,
  assignedRep,
  existingContacts,
  lookup
}: {
  tenantId: string;
  leadId: string;
  companyId: string;
  assignedRep: string;
  existingContacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    title: string | null;
    department: string | null;
    seniority: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    source: unknown;
    contactStatus: ContactStatus;
    apolloContactId: string | null;
    apolloPersonId: string | null;
    apolloStatus: unknown;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
    recommendedSequenceName: string | null;
    recommendedSequenceId: string | null;
    selectedSequenceName: string | null;
    selectedSequenceId: string | null;
    sequenceRecommendationReason: string | null;
    sequenceOverrideReason: string | null;
    sequenceManuallyOverridden: boolean;
    lastTouchAt: Date | null;
    lastReplyAt: Date | null;
    assignedRep: string | null;
    rawJson: Prisma.JsonValue | null;
  }>;
  lookup: ApolloContactLookupResult;
}) {
  const syncedContacts: Array<{ id: string } & ApolloContactRecord> = [];

  for (const incoming of lookup.contacts) {
    const existing = matchExistingApolloContact(existingContacts, incoming);
    const merged = buildApolloContactMutation({
      tenantId,
      companyId,
      leadId,
      assignedRep,
      existing,
      incoming
    });

    if (existing) {
      await prisma.contact.update({
        where: {
          id: existing.id
        },
        data: merged
      });

      syncedContacts.push({
        id: existing.id,
        ...incoming
      });
      continue;
    }

    const created = await prisma.contact.create({
      data: merged
    });

    syncedContacts.push({
      id: created.id,
      ...incoming
    });
  }

  return syncedContacts;
}

async function finalizeApolloEnrichmentForLead({
  tenantId,
  lead,
  existingContacts,
  lookup,
  baseNotes
}: {
  tenantId: string;
  lead: {
    id: string;
    companyId: string;
    contactId: string | null;
    ownerUserId: string;
    company: {
      id: string;
      domain: string | null;
      linkedinUrl: string | null;
      apolloOrganizationId: string | null;
    };
  };
  existingContacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    title: string | null;
    department: string | null;
    seniority: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    source: unknown;
    contactStatus: ContactStatus;
    apolloContactId: string | null;
    apolloPersonId: string | null;
    apolloStatus: unknown;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
    recommendedSequenceName: string | null;
    recommendedSequenceId: string | null;
    selectedSequenceName: string | null;
    selectedSequenceId: string | null;
    sequenceRecommendationReason: string | null;
    sequenceOverrideReason: string | null;
    sequenceManuallyOverridden: boolean;
    lastTouchAt: Date | null;
    lastReplyAt: Date | null;
    assignedRep: string | null;
    rawJson: Prisma.JsonValue | null;
  }>;
  lookup: ApolloContactLookupResult;
  baseNotes: string;
}) {
  const syncedContacts = await syncApolloContactsForLead({
    tenantId,
    leadId: lead.id,
    companyId: lead.companyId,
    assignedRep: lead.ownerUserId,
    existingContacts,
    lookup
  });

  await prisma.company.update({
    where: {
      id: lead.company.id
    },
    data: {
      apolloOrganizationId: lookup.organizationId ?? lead.company.apolloOrganizationId,
      domain: lookup.domain ?? lead.company.domain,
      linkedinUrl: lookup.linkedinUrl ?? lead.company.linkedinUrl
    }
  });

  if (!lead.contactId) {
    const primaryContactId = pickPrimaryApolloContactId(syncedContacts);
    if (primaryContactId) {
      await prisma.lead.update({
        where: {
          id: lead.id
        },
        data: {
          contactId: primaryContactId
        }
      });
    }
  }

  await autoGenerateAiDraftsForContacts({
    tenantId,
    contactIds: syncedContacts.map((contact) => contact.id)
  });

  const completionNote =
    syncedContacts.length > 0
      ? `Apollo enrichment completed on ${new Date().toISOString()}. Imported ${syncedContacts.length} contacts.`
      : `Apollo enrichment completed with no contacts on ${new Date().toISOString()}.`;

  await prisma.lead.update({
    where: {
      id: lead.id
    },
    data: {
      notes: appendLeadNote(baseNotes, completionNote)
    }
  });

  return syncedContacts.length;
}

async function recordApolloCompanyMatch({
  tenantId,
  companyId,
  lookup
}: {
  tenantId: string;
  companyId: string;
  lookup: ApolloContactLookupResult;
}) {
  await prisma.apolloCompanyMatch.create({
    data: {
      tenantId,
      companyId,
      apolloOrganizationId: lookup.match.organizationId,
      apolloCompanyName: lookup.match.companyName,
      apolloDomain: lookup.match.domain,
      apolloLinkedinUrl: lookup.match.linkedinUrl,
      score: lookup.match.score,
      classification: lookup.match.classification,
      nameMatchType: lookup.match.nameMatchType,
      domainMatch: lookup.match.domainMatch,
      logisticsProviderMatch: lookup.match.logisticsProviderMatch,
      branchLocationMatch: lookup.match.branchLocationMatch,
      matchReason: lookup.match.matchReason,
      queryJson: toInputJsonValue(lookup.match.query),
      rawJson: lookup.match.rawPayload ? toInputJsonValue(lookup.match.rawPayload) : Prisma.JsonNull
    }
  });
}

function matchExistingApolloContact(
  existingContacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    title: string | null;
    department: string | null;
    seniority: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    contactStatus: ContactStatus;
    apolloContactId: string | null;
    apolloPersonId: string | null;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
    recommendedSequenceName: string | null;
    recommendedSequenceId: string | null;
    selectedSequenceName: string | null;
    selectedSequenceId: string | null;
    sequenceRecommendationReason: string | null;
    sequenceOverrideReason: string | null;
    sequenceManuallyOverridden: boolean;
    lastTouchAt: Date | null;
    lastReplyAt: Date | null;
    assignedRep: string | null;
    rawJson: Prisma.JsonValue | null;
  }>,
  incoming: ApolloContactRecord
) {
  const normalizedEmail = incoming.email?.trim().toLowerCase() ?? null;
  const normalizedLinkedin = incoming.linkedinUrl?.trim().toLowerCase() ?? null;
  const normalizedFullName = incoming.fullName.trim().toLowerCase();
  const normalizedTitle = incoming.title?.trim().toLowerCase() ?? null;

  return (
    existingContacts.find(
      (contact) =>
        (incoming.apolloContactId && contact.apolloContactId === incoming.apolloContactId) ||
        (incoming.apolloPersonId && contact.apolloPersonId === incoming.apolloPersonId)
    ) ??
    existingContacts.find((contact) => normalizedEmail && contact.email?.trim().toLowerCase() === normalizedEmail) ??
    existingContacts.find(
      (contact) => normalizedLinkedin && contact.linkedinUrl?.trim().toLowerCase() === normalizedLinkedin
    ) ??
    existingContacts.find(
      (contact) =>
        contact.fullName.trim().toLowerCase() === normalizedFullName &&
        (contact.title?.trim().toLowerCase() ?? null) === normalizedTitle
    ) ??
    null
  );
}

function buildApolloContactMutation({
  tenantId,
  companyId,
  leadId,
  assignedRep,
  existing,
  incoming
}: {
  tenantId: string;
  companyId: string;
  leadId: string;
  assignedRep: string;
  existing:
    | {
        id: string;
        firstName: string | null;
        lastName: string | null;
        fullName: string;
        title: string | null;
        department: string | null;
        seniority: string | null;
        email: string | null;
        phone: string | null;
        linkedinUrl: string | null;
        contactStatus: ContactStatus;
        apolloContactId: string | null;
        apolloPersonId: string | null;
        sequenceStatus: SequenceStatus;
        replyStatus: ReplyStatus;
        recommendedSequenceName: string | null;
        recommendedSequenceId: string | null;
        selectedSequenceName: string | null;
        selectedSequenceId: string | null;
        sequenceRecommendationReason: string | null;
        sequenceOverrideReason: string | null;
        sequenceManuallyOverridden: boolean;
        lastTouchAt: Date | null;
        lastReplyAt: Date | null;
        assignedRep: string | null;
        rawJson: Prisma.JsonValue | null;
      }
    | null;
  incoming: ApolloContactRecord;
}) {
  const currentRawJson = isJsonObject(existing?.rawJson) ? existing.rawJson : {};

  return {
    tenantId,
    companyId,
    firstName: incoming.firstName,
    lastName: incoming.lastName,
    fullName: incoming.fullName,
    title: incoming.title,
    department: incoming.department,
    seniority: incoming.seniority,
    email: incoming.email,
    phone: incoming.phone,
    linkedinUrl: incoming.linkedinUrl,
    source: "APOLLO" as const,
    contactStatus: existing?.contactStatus ?? ContactStatus.REVIEWING,
    apolloContactId: incoming.apolloContactId,
    apolloPersonId: incoming.apolloPersonId,
    apolloStatus: "ENRICHED" as const,
    sequenceStatus: mergeSequenceStatus(existing?.sequenceStatus ?? null, incoming.sequenceStatus),
    replyStatus: mergeReplyStatus(existing?.replyStatus ?? null, incoming.replyStatus),
    recommendedSequenceName: existing?.recommendedSequenceName ?? null,
    recommendedSequenceId: existing?.recommendedSequenceId ?? null,
    selectedSequenceName: existing?.selectedSequenceName ?? incoming.sequenceName ?? null,
    selectedSequenceId: existing?.selectedSequenceId ?? incoming.sequenceId ?? null,
    sequenceRecommendationReason: existing?.sequenceRecommendationReason ?? null,
    sequenceOverrideReason: existing?.sequenceOverrideReason ?? null,
    sequenceManuallyOverridden: existing?.sequenceManuallyOverridden ?? false,
    lastTouchAt: incoming.lastTouchAt ?? existing?.lastTouchAt ?? null,
    lastReplyAt: incoming.lastReplyAt ?? existing?.lastReplyAt ?? null,
    assignedRep: existing?.assignedRep ?? assignedRep,
    rawJson: toInputJsonValue({
      ...currentRawJson,
      apollo: {
        importedAt: new Date().toISOString(),
        leadId,
        record: incoming.rawPayload
      }
    })
  };
}

function mergeSequenceStatus(existing: SequenceStatus | null, incoming: SequenceStatus) {
  if (!existing) {
    return incoming;
  }

  if (incoming === SequenceStatus.NOT_STARTED) {
    return existing;
  }

  return sequenceStatusRank(incoming) >= sequenceStatusRank(existing) ? incoming : existing;
}

function sequenceStatusRank(status: SequenceStatus) {
  switch (status) {
    case SequenceStatus.NOT_STARTED:
      return 0;
    case SequenceStatus.READY:
      return 1;
    case SequenceStatus.ENROLLED:
      return 2;
    case SequenceStatus.PAUSED:
      return 3;
    case SequenceStatus.REPLIED:
      return 4;
    case SequenceStatus.BOUNCED:
      return 5;
    case SequenceStatus.FINISHED:
      return 6;
    default:
      return 0;
  }
}

function mergeReplyStatus(existing: ReplyStatus | null, incoming: ReplyStatus) {
  if (!existing || existing === ReplyStatus.NO_REPLY) {
    return incoming;
  }

  if (incoming === ReplyStatus.NO_REPLY) {
    return existing;
  }

  return replyStatusRank(incoming) >= replyStatusRank(existing) ? incoming : existing;
}

function replyStatusRank(status: ReplyStatus) {
  switch (status) {
    case ReplyStatus.NO_REPLY:
      return 0;
    case ReplyStatus.OUT_OF_OFFICE:
      return 1;
    case ReplyStatus.REPLIED:
      return 2;
    case ReplyStatus.NEGATIVE:
      return 3;
    case ReplyStatus.POSITIVE:
      return 4;
    case ReplyStatus.MEETING_BOOKED:
      return 5;
    default:
      return 0;
  }
}

function pickPrimaryApolloContactId(contacts: Array<{ id: string } & ApolloContactRecord>) {
  return contacts
    .slice()
    .sort((left, right) => rankPrimaryApolloContact(right) - rankPrimaryApolloContact(left))[0]?.id ?? null;
}

function rankPrimaryApolloContact(contact: ApolloContactRecord) {
  let score = 0;
  if (contact.email) score += 6;
  if (contact.title) score += 3;
  if (/\b(director|head|chief|vp|vice president|president|owner|manager)\b/i.test(contact.title ?? "")) score += 4;
  if (/\b(logistics|supply|procurement|operations|import)\b/i.test(`${contact.title ?? ""} ${contact.department ?? ""}`)) score += 3;
  if (contact.sequenceStatus !== SequenceStatus.NOT_STARTED) score += 1;
  return score;
}

async function autoGenerateAiDraftsForContacts({
  tenantId,
  contactIds
}: {
  tenantId: string;
  contactIds: string[];
}) {
  if (!isOpenAiDraftGenerationConfigured() || contactIds.length === 0 || !(await isLeadGenAiEnabled(tenantId))) {
    return;
  }

  for (const contactId of [...new Set(contactIds)]) {
    try {
      await generateAiDraftForContact({
        tenantId,
        contactId,
        forceRegenerate: false
      });
    } catch {
      // Keep Apollo enrichment resilient; contacts can still be reviewed and
      // drafts can be regenerated manually if OpenAI drafting fails.
    }
  }
}

async function generateAiDraftForContact({
  tenantId,
  contactId,
  forceRegenerate
}: {
  tenantId: string;
  contactId: string;
  forceRegenerate: boolean;
}) {
  const draftContext = await loadAiDraftContactContext({ tenantId, contactId });

  if (!draftContext) {
    throw new Error("Contact not found for this tenant.");
  }

  if (!draftContext.requiresAiDraft) {
    if (forceRegenerate) {
      throw new Error("This tier does not currently require a Newl Apps AI draft.");
    }
    return;
  }

  if (!draftContext.selectedSequenceName) {
    if (forceRegenerate) {
      throw new Error("Select a cadence for this contact before generating the AI draft.");
    }
    return;
  }

  if (draftContext.contact.company.importRecords.length === 0) {
    if (forceRegenerate) {
      throw new Error("No TradeMining shipment history is available for this company yet.");
    }
    return;
  }

  if (draftContext.existingDraft && !forceRegenerate) {
    return;
  }

  const generatedDraft = await generateTier1SequenceDraft({
    model: draftContext.model,
    companyName: draftContext.contact.company.name,
    contactFirstName: draftContext.contact.firstName,
    contactFullName: draftContext.contact.fullName,
    contactTitle: draftContext.contact.title,
    contactDepartment: draftContext.contact.department,
    contactSeniority: draftContext.contact.seniority,
    selectedSequenceName: draftContext.selectedSequenceName,
    shipmentCount: draftContext.evidence.shipmentCount,
    latestShipmentDate: draftContext.evidence.latestShipmentDate?.toISOString() ?? null,
    arrivalPort: draftContext.evidence.destinationPort,
    destinationCity: draftContext.evidence.destinationCity,
    destinationState: draftContext.evidence.destinationState,
    destinationMarket: draftContext.evidence.destinationMarket,
    originCountry: draftContext.evidence.originCountry,
    originPort: draftContext.evidence.originPort,
    foreignPort: draftContext.evidence.foreignPort,
    shipFromPort: draftContext.evidence.shipFromPort,
    placeOfReceipt: draftContext.evidence.placeOfReceipt,
    productDescription: draftContext.evidence.productDescription,
    hsCode: draftContext.evidence.hsCode,
    totalTeu: draftContext.evidence.totalTeu,
    carrier: draftContext.evidence.carrier,
    vessel: draftContext.evidence.vessel,
    voyage: draftContext.evidence.voyage,
    searchProfileName: draftContext.evidence.searchProfile?.name ?? null,
    profileDestinationMarkets: draftContext.evidence.searchProfile?.destinationMarkets ?? [],
    profileProductKeywords: draftContext.evidence.searchProfile?.productKeywords ?? [],
    recurringOrigins: draftContext.shipmentDraftContext.recurringOrigins,
    recurringDestinationPorts: draftContext.shipmentDraftContext.recurringDestinationPorts,
    recurringCarriers: draftContext.shipmentDraftContext.recurringCarriers,
    recurringProducts: draftContext.shipmentDraftContext.recurringProducts,
    recentShipmentHighlights: draftContext.shipmentDraftContext.recentShipmentHighlights
  });

  const rawInputs = {
    model: draftContext.model,
    generatedAt: new Date().toISOString(),
    companyName: draftContext.contact.company.name,
    companyPriorityScore: draftContext.contact.company.priorityScore,
    leadScore: draftContext.leadScore,
    contactTier: draftContext.contactTier,
    selectedSequenceName: draftContext.selectedSequenceName,
    selectedSequenceId: draftContext.selectedSequenceId,
    evidence: {
      shipmentCount: draftContext.evidence.shipmentCount,
      latestShipmentDate: draftContext.evidence.latestShipmentDate?.toISOString() ?? null,
      arrivalPort: draftContext.evidence.destinationPort,
      destinationCity: draftContext.evidence.destinationCity,
      destinationState: draftContext.evidence.destinationState,
      destinationMarket: draftContext.evidence.destinationMarket,
      originCountry: draftContext.evidence.originCountry,
      originPort: draftContext.evidence.originPort,
      foreignPort: draftContext.evidence.foreignPort,
      shipFromPort: draftContext.evidence.shipFromPort,
      placeOfReceipt: draftContext.evidence.placeOfReceipt,
      productDescription: draftContext.evidence.productDescription,
      hsCode: draftContext.evidence.hsCode,
      totalTeu: draftContext.evidence.totalTeu,
      sourceRole: draftContext.evidence.sourceRole,
      carrier: draftContext.evidence.carrier,
      vessel: draftContext.evidence.vessel,
      voyage: draftContext.evidence.voyage,
      searchProfileName: draftContext.evidence.searchProfile?.name ?? null,
      recurringOrigins: draftContext.shipmentDraftContext.recurringOrigins,
      recurringDestinationPorts: draftContext.shipmentDraftContext.recurringDestinationPorts,
      recurringCarriers: draftContext.shipmentDraftContext.recurringCarriers,
      recurringProducts: draftContext.shipmentDraftContext.recurringProducts,
      recentShipmentHighlights: draftContext.shipmentDraftContext.recentShipmentHighlights
    }
  };

  await prisma.contactOutreachDraft.upsert({
    where: {
      tenantId_contactId_sequenceName: {
        tenantId,
        contactId: draftContext.contact.id,
        sequenceName: draftContext.selectedSequenceName
      }
    },
    update: {
      companyId: draftContext.contact.companyId,
      leadId: draftContext.leadId,
      sequenceId: draftContext.selectedSequenceId,
      subject: generatedDraft.subject,
      body: generatedDraft.body,
      status: ContactOutreachDraftStatus.APPROVED,
      source: ContactOutreachDraftSource.MOCK_AI,
      aiGenerated: true,
      personalizationNotes: generatedDraft.personalizationNotes,
      approvedAt: new Date(),
      rawInputs: toInputJsonValue(rawInputs),
      rawJson: toInputJsonValue({
        provider: "openai",
        response: generatedDraft.rawResponse
      })
    },
    create: {
      tenantId,
      contactId: draftContext.contact.id,
      companyId: draftContext.contact.companyId,
      leadId: draftContext.leadId,
      sequenceName: draftContext.selectedSequenceName,
      sequenceId: draftContext.selectedSequenceId,
      subject: generatedDraft.subject,
      body: generatedDraft.body,
      status: ContactOutreachDraftStatus.APPROVED,
      source: ContactOutreachDraftSource.MOCK_AI,
      aiGenerated: true,
      personalizationNotes: generatedDraft.personalizationNotes,
      approvedAt: new Date(),
      rawInputs: toInputJsonValue(rawInputs),
      rawJson: toInputJsonValue({
        provider: "openai",
        response: generatedDraft.rawResponse
      })
    }
  });
}

async function loadAiDraftContactContext({
  tenantId,
  contactId
}: {
  tenantId: string;
  contactId: string;
}) {
  const [contact, apolloCredential, scoringConfigRecord, model] = await Promise.all([
    prisma.contact.findFirst({
      where: {
        id: contactId,
        tenantId
      },
      include: {
        leads: {
          where: {
            tenantId
          },
          select: {
            id: true
          },
          take: 1
        },
        company: {
          select: {
            id: true,
            name: true,
            priorityScore: true,
            candidateStatus: true,
            domain: true,
            apolloOrganizationId: true,
            importRecords: {
              orderBy: {
                arrivalDate: "desc"
              },
              take: 250,
              select: {
                rawJson: true,
                arrivalDate: true,
                sourcePort: true,
                destinationCity: true,
                destinationState: true,
                originCountry: true,
                productDescription: true
              }
            },
            leads: {
              where: {
                tenantId
              },
              orderBy: {
                updatedAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                score: true
              }
            }
          }
        },
        outreachDrafts: {
          where: {
            tenantId
          },
          orderBy: {
            updatedAt: "desc"
          },
          take: 1
        }
      }
    }),
    prisma.integrationCredential.findFirst({
      where: {
        tenantId,
        provider: "APOLLO"
      },
      select: {
        publicConfig: true
      }
    }),
    prisma.tradeMiningScoringConfig.findUnique({
      where: {
        tenantId
      }
    }),
    loadTier1DraftModel(tenantId)
  ]);

  if (!contact) {
    return null;
  }

  const scoringConfig = normalizeLeadGenAiScoringConfig(scoringConfigRecord);
  const companyLeadScore = contact.company.leads[0]?.score ?? null;
  const scoring = scoreContact(
    {
      fullName: contact.fullName,
      title: contact.title,
      department: contact.department,
      seniority: contact.seniority,
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      contactStatus: contact.contactStatus,
      replyStatus: contact.replyStatus,
      companyPriorityScore: contact.company.priorityScore,
      companyLeadScore,
      isPrimaryContact: contact.leads.length > 0
    },
    scoringConfig
  );

  const searchProfileIds = [
    ...new Set(
      contact.company.importRecords
        .map((record) => readString(asObject(record.rawJson), "searchProfileId"))
        .filter((value): value is string => Boolean(value))
    )
  ];
  const searchProfiles = searchProfileIds.length
    ? new Map(
        (
          await prisma.tradeMiningSearchProfile.findMany({
            where: {
              tenantId,
              id: {
                in: searchProfileIds
              }
            },
            select: {
              id: true,
              name: true,
              priorityWeight: true,
              destinationMarkets: true,
              destinationPorts: true,
              originPorts: true,
              shipFromPorts: true,
              originCountries: true,
              productKeywords: true,
              hsCodes: true,
              contactCadenceConfig: true
            }
          })
        ).map((profile) => [
          profile.id,
          {
            id: profile.id,
            name: profile.name,
            priorityWeight: profile.priorityWeight,
            destinationMarkets: asStringArray(profile.destinationMarkets),
            destinationPorts: asStringArray(profile.destinationPorts),
            originPorts: asStringArray(profile.originPorts),
            shipFromPorts: asStringArray(profile.shipFromPorts),
            originCountries: asStringArray(profile.originCountries),
            productKeywords: asStringArray(profile.productKeywords),
            hsCodes: asStringArray(profile.hsCodes),
            contactCadenceConfig: profile.contactCadenceConfig
          }
        ])
      )
    : new Map();

  const evidence = summarizeTradeMiningEvidence(contact.company.importRecords, searchProfiles);
  const apolloSequenceDirectory = parseApolloSequenceDirectory(apolloCredential?.publicConfig);
  const defaultSequenceMapping = buildApolloSequenceMappingsWithDefaults({
    existingMappings: parseApolloSequenceMapping(apolloCredential?.publicConfig),
    directory: apolloSequenceDirectory
  });
  const effectiveSequenceMappings = resolveApolloSequenceMappings({
    existingMappings: evidence.searchProfile
      ? parseSearchProfileApolloSequenceMapping(evidence.searchProfile.contactCadenceConfig)
      : defaultSequenceMapping,
    directory: apolloSequenceDirectory
  });
  const recommendation = recommendSequenceForContact({
    contactTier: scoring.tier,
    title: contact.title,
    department: contact.department,
    companyName: contact.company.name,
    sequenceMappings: effectiveSequenceMappings,
    sequenceDirectory: apolloSequenceDirectory
  });
  const tierMapping = effectiveSequenceMappings.find((entry) => entry.tier === scoring.tier) ?? null;

  return {
    model,
    contact,
    contactScore: scoring.score,
    contactScoreSummary: scoring.summary,
    contactTier: scoring.tier,
    scoringConfig,
    evidence,
    shipmentDraftContext: buildShipmentDraftContext(contact.company.importRecords),
    selectedSequenceName: contact.selectedSequenceName ?? contact.recommendedSequenceName ?? recommendation.name ?? null,
    selectedSequenceId: contact.selectedSequenceId ?? contact.recommendedSequenceId ?? recommendation.id ?? null,
    selectedSequenceReason: contact.sequenceRecommendationReason ?? recommendation.reason,
    requiresAiDraft: tierMapping?.requiresAiDraft ?? false,
    existingDraft: contact.outreachDrafts[0] ?? null,
    leadId: contact.company.leads[0]?.id ?? null,
    leadScore: companyLeadScore
  };
}

async function syncApolloCustomFieldsForContactPush({
  tenantId,
  contactId,
  apolloContactId
}: {
  tenantId: string;
  contactId: string;
  apolloContactId: string;
}) {
  const draftContext = await loadAiDraftContactContext({
    tenantId,
    contactId
  });

  if (!draftContext) {
    throw new Error("Contact context is unavailable for Apollo custom field sync.");
  }

  const customFieldValues = buildApolloCustomFieldValues(draftContext);
  return syncApolloContactTypedCustomFields({
    apolloContactId,
    fieldValues: customFieldValues
  });
}

function buildApolloCustomFieldValues(
  draftContext: NonNullable<Awaited<ReturnType<typeof loadAiDraftContactContext>>>
) {
  const companyScoring = scoreCandidate({
    companyPriorityScore: draftContext.contact.company.priorityScore,
    candidateStatus: draftContext.contact.company.candidateStatus,
    alreadyInPipeline: true,
    evidence: draftContext.evidence,
    config: draftContext.scoringConfig
  });
  const shipmentCount30d = countShipmentsWithinDays(draftContext.contact.company.importRecords, 30);
  const shipmentCount90d = countShipmentsWithinDays(draftContext.contact.company.importRecords, 90);
  const teu30d = sumTeuWithinDays(draftContext.contact.company.importRecords, 30);
  const originCountries = collectTopValues(
    draftContext.contact.company.importRecords,
    (record) => record.originCountry ?? readString(asObject(record.rawJson), "originCountry"),
    5
  );

  const values: Record<string, string> = {
    "NEWL Company Opportunity Score": String(Math.round(draftContext.leadScore ?? companyScoring.score)),
    "NEWL Contact Relevance Score": String(Math.round(draftContext.contactScore)),
    "NEWL Sequence Tier": formatContactTierLabel(draftContext.contactTier),
    "NEWL Cadence Recommendation": draftContext.selectedSequenceName ?? "No cadence selected",
    "NEWL Sequence Reason": draftContext.selectedSequenceReason ?? "No sequence recommendation reason available",
    "NEWL TradeMining Score Reason": companyScoring.reasoning || "No TradeMining score explanation available",
    "NEWL Shipment Count 30d": String(shipmentCount30d),
    "NEWL Shipment Count 90d": String(shipmentCount90d),
    "NEWL TEU 30d": formatDecimalValue(teu30d),
    "NEWL Arrival Port": draftContext.evidence.destinationPort ?? "Unknown",
    "NEWL Destination City": draftContext.evidence.destinationCity ?? "Unknown",
    "NEWL Destination State": draftContext.evidence.destinationState ?? "Unknown",
    "NEWL Origin Countries": originCountries.length > 0 ? originCountries.join(", ") : "Unknown",
    "NEWL Apollo Match Confidence": draftContext.contact.company.apolloOrganizationId ? "direct_company" : "not_recorded",
    "NEWL Apollo Domain": draftContext.contact.company.domain ?? "Unknown"
  };

  if (draftContext.existingDraft?.subject) {
    values["NEWL Email Subject Draft"] = draftContext.existingDraft.subject;
  }

  if (draftContext.existingDraft?.body) {
    values["NEWL Email Body Draft"] = draftContext.existingDraft.body;
  }

  return values;
}

async function loadTier1DraftModel(tenantId: string) {
  const config = await prisma.tradeMiningScoringConfig.findUnique({
    where: {
      tenantId
    },
    select: {
      aiModel: true
    }
  });

  return config?.aiModel?.trim() || DEFAULT_TRADEMINING_SCORING_SETTINGS.aiModel || "gpt-5.4-mini";
}

async function isLeadGenAiEnabled(tenantId: string) {
  const config = await prisma.tradeMiningScoringConfig.findUnique({
    where: {
      tenantId
    },
    select: {
      aiClassificationEnabled: true
    }
  });

  return config?.aiClassificationEnabled ?? DEFAULT_TRADEMINING_SCORING_SETTINGS.aiClassificationEnabled;
}

function countShipmentsWithinDays(
  importRecords: Array<{
    arrivalDate: Date | null;
  }>,
  days: number
) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return importRecords.filter((record) => record.arrivalDate && record.arrivalDate.getTime() >= cutoff).length;
}

function sumTeuWithinDays(
  importRecords: Array<{
    rawJson: unknown;
    arrivalDate: Date | null;
  }>,
  days: number
) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return importRecords.reduce((total, record) => {
    if (!record.arrivalDate || record.arrivalDate.getTime() < cutoff) {
      return total;
    }

    return total + readNumericValue(asObject(record.rawJson), ["teu"]);
  }, 0);
}

function formatContactTierLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatDecimalValue(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function normalizeLeadGenAiScoringConfig(
  config: Awaited<ReturnType<typeof prisma.tradeMiningScoringConfig.findUnique>>
) {
  return {
    ...DEFAULT_TRADEMINING_SCORING_SETTINGS,
    ...(config
      ? {
          contactDecisionMakerWeight: config.contactDecisionMakerWeight,
          contactManagerWeight: config.contactManagerWeight,
          contactLogisticsDepartmentWeight: config.contactLogisticsDepartmentWeight,
          contactWeakFunctionPenalty: config.contactWeakFunctionPenalty,
          contactCompanyContextWeight: config.contactCompanyContextWeight,
          contactEmailWeight: config.contactEmailWeight,
          contactLinkedinWeight: config.contactLinkedinWeight,
          contactPhoneWeight: config.contactPhoneWeight,
          contactPrimaryContactBoost: config.contactPrimaryContactBoost,
          contactApprovedStatusBoost: config.contactApprovedStatusBoost,
          contactReviewingStatusBoost: config.contactReviewingStatusBoost,
          contactTier1Threshold: config.contactTier1Threshold,
          contactTier2Threshold: config.contactTier2Threshold,
          contactTier3Threshold: config.contactTier3Threshold,
          preferredContactTitleKeywords: asStringArray(config.preferredContactTitleKeywords),
          penalizedContactTitleKeywords: asStringArray(config.penalizedContactTitleKeywords),
          preferredContactDepartments: asStringArray(config.preferredContactDepartments),
          penalizedContactDepartments: asStringArray(config.penalizedContactDepartments)
        }
      : {})
  };
}

function buildShipmentDraftContext(
  importRecords: Array<{
    rawJson: unknown;
    arrivalDate: Date | null;
    sourcePort: string | null;
    destinationCity: string | null;
    destinationState: string | null;
    originCountry: string | null;
    productDescription: string | null;
  }>
) {
  const recurringOrigins = collectTopValues(importRecords, (record) =>
    record.originCountry ?? readString(asObject(record.rawJson), "originCountry")
  );
  const recurringDestinationPorts = collectTopValues(importRecords, (record) =>
    readString(asObject(record.rawJson), "destinationPort") ?? readString(asObject(record.rawJson), "arrivalPort")
  );
  const recurringCarriers = collectTopValues(importRecords, (record) =>
    readString(asObject(record.rawJson), "carrier")
  );
  const recurringProducts = collectTopValues(importRecords, (record) =>
    record.productDescription ?? readString(asObject(record.rawJson), "productDescription")
  );
  const recentShipmentHighlights = importRecords
    .slice(0, 5)
    .map((record) => {
      const destination =
        readString(asObject(record.rawJson), "destinationMarket") ??
        formatShipmentLocation(record.destinationCity, record.destinationState);
      const arrivalPort =
        readString(asObject(record.rawJson), "destinationPort") ?? readString(asObject(record.rawJson), "arrivalPort");
      const originCountry = record.originCountry ?? readString(asObject(record.rawJson), "originCountry");
      const product = record.productDescription ?? readString(asObject(record.rawJson), "productDescription");
      const date = record.arrivalDate ? formatDraftDate(record.arrivalDate) : null;

      return [date, destination, arrivalPort, originCountry, product]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .join(" | ");
    })
    .filter((value) => value.length > 0);

  return {
    recurringOrigins,
    recurringDestinationPorts,
    recurringCarriers,
    recurringProducts,
    recentShipmentHighlights
  };
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Prisma.JsonObject) : {};
}

function readString(record: Prisma.JsonObject, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumericValue(record: Prisma.JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function asStringArray(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => entry.length > 0);
}

function collectTopValues<T>(items: T[], pick: (item: T) => string | null, limit = 3) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const value = pick(item)?.trim();
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function formatShipmentLocation(city: string | null, state: string | null) {
  if (city && state) {
    return `${city}, ${state}`;
  }

  return city ?? state ?? null;
}

function formatDraftDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
