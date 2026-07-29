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
  OutreachPlanStatus,
  OutreachQaStatus,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EMPTY_APOLLO_QUEUE_SUMMARY, type ApolloQueueSummary } from "@/modules/lead-gen/apollo-queue-summary";
import {
  type ApolloMatchReviewActionState
} from "@/modules/lead-gen/apollo-match-review-state";
import {
  APOLLO_ENROLLMENT_CONFIRMATION_FAILED_REASON,
  APOLLO_ENROLLMENT_CONFIRMATION_TIMEOUT_MS,
  APOLLO_PROPAGATION_PENDING_REASON,
  APOLLO_PUSH_JOB_TYPE,
  createApolloPushJobOutput,
  isApolloSequenceMembershipConfirmed,
  isApolloPushJobDetailPending,
  recalculateApolloPushJobOutput,
  resolveApolloEnrollmentConfirmationTarget,
  type ApolloPushJobInput,
  parseApolloPushJobOutput,
  type ApolloPushJobOutput
} from "@/modules/lead-gen/apollo-push-jobs";
import {
  EMPTY_CONTACT_BULK_ACTION_SUMMARY,
  type ContactBulkActionSummary
} from "@/modules/lead-gen/contact-bulk-action-summary";
import { getOutreachPlanApprovalBlockReason } from "@/modules/lead-gen/outreach-approval-reason";
import {
  buildTradeMiningEvidenceWhere,
  calculateLeadPipelineScoringForCompany,
  scoreCandidate,
  summarizeTradeMiningEvidence
} from "@/modules/lead-gen/queries";
import {
  COMPANY_SCORING_MODEL_VERSION,
  CONTACT_SCORING_MODEL_VERSION,
  recordLeadOutcomeEvent,
  recordLeadScoreSnapshot,
  type LeadScoreTrigger
} from "@/modules/lead-gen/score-history";
import { recordCurrentContactScoreSnapshot as recordContactScoreSnapshot } from "@/modules/lead-gen/contact-score-snapshot";
import { getNextApolloSyncAt } from "@/modules/lead-gen/apollo-status-sync-policy";
import {
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays
} from "@/modules/lead-gen/hunter-outreach-eligibility";
import {
  enqueueHunterCompanyOutreachHandoff,
  hasUsableHunterEmail,
  processNextHunterOutreachHandoff
} from "@/modules/lead-gen/hunter-outreach-handoff";
import { resolveApolloContactDiscoveryMatch } from "@/modules/lead-gen/apollo-contact-discovery-review";
import { prepareApolloContactForEnrollment } from "@/modules/lead-gen/apollo-contact-preparation";
import { canonicalizeTradeMiningDestinationPort } from "@/modules/lead-gen/search-profile-suggestions";
import {
  assertValidTradeMiningSearchProfile,
  defaultTradeMiningCompanyIdentityRoles,
  tradeMiningCompanyIdentityRoleOptions
} from "@/modules/lead-gen/search-profile-validation";
import {
  getContactApolloAssignmentBlockReason,
  getContactScoringBlockReason,
  getContactSequencePushBlockReason,
  scoreContact
} from "@/modules/lead-gen/contact-scoring";
import {
  buildSequenceCatalogItems,
  recommendSequenceForContact,
  shouldUseHunterSequenceRecommendation
} from "@/modules/lead-gen/sequence-catalog";
import {
  DEFAULT_OUTREACH_DRAFT_MODEL,
  DEFAULT_OUTREACH_QA_MODEL,
  DEFAULT_OUTREACH_STRATEGY_MODEL,
  fingerprintOutreachEvidence,
  getOutreachPlanApolloBlockReason,
  mergeOutreachQaResults,
  OUTREACH_PLAN_PROMPT_VERSION,
  runDeterministicOutreachQa,
  type OutreachEvidenceRecord,
  type OutreachQaIssue
} from "@/modules/lead-gen/outreach-plan";
import { persistOutreachPlanWithSteps } from "@/modules/lead-gen/outreach-plan-persistence";
import { buildApprovedOutreachEnrollment } from "@/modules/lead-gen/outreach-enrollment";
import {
  decideApolloSequenceTransition,
  resolveTrackedSequenceStatus
} from "@/modules/lead-gen/apollo-reengagement-policy";
import { resolveLiveApolloSequence } from "@/modules/lead-gen/apollo-sequence-resolution";
import {
  generateOutreachPlanForContact as generateSharedOutreachPlanForContact
} from "@/modules/lead-gen/outreach-plan-generation";
import {
  buildApolloSequenceMappingsWithDefaults,
  parseApolloSequenceDirectory,
  parseApolloSequenceMapping,
  parseSearchProfileApolloSequenceMapping,
  resolveApolloSequenceMappings
} from "@/modules/settings/apollo-sequence-mapping";
import { selectApolloMailboxForCompany } from "@/modules/settings/apollo-mailbox-routing";
import { parseApolloRepMapping } from "@/modules/settings/apollo-rep-mapping";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import {
  ApolloRateLimitError,
  createApolloContactForEnrollment,
  fetchApolloEmailAccountDirectory,
  fetchApolloContactsForCompany,
  fetchApolloOrganizationForMapping,
  fetchApolloSequenceDirectory,
  parseApolloCompanyReference,
  syncApolloContactTypedCustomFields,
  type ApolloEmailAccountDirectoryEntry,
  type ApolloContactRecord,
  type ApolloSequenceDirectoryEntry,
  transitionApolloContactsToSequence,
  type ApolloContactLookupResult
} from "@/server/integrations/apollo";
import {
  generateApolloCompanyNameSuggestion,
  generateCompleteOutreachSequence,
  generateOutreachStrategy,
  isOpenAiDraftGenerationConfigured,
  reviewOutreachSequenceGrounding
} from "@/server/integrations/openai";
import { getAuthenticatedContext } from "@/server/tenant-context";

const APOLLO_ENROLLMENT_CONFIRMATION_RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000] as const;

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
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  company: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      candidateStatus?: CandidateStatus;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  lead: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      companyId: string;
      notes?: string | null;
      stage?: LeadPipelineStage;
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

async function ensureCurrentHunterApolloReviewLead({
  tenantId,
  companyId,
  ownerUserId,
  ownerEmail
}: {
  tenantId: string;
  companyId: string;
  ownerUserId: string;
  ownerEmail: string;
}) {
  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      tenantId,
      doNotProspect: false,
      candidateStatus: {
        notIn: [CandidateStatus.REJECTED, CandidateStatus.DISQUALIFIED]
      }
    },
    select: {
      id: true,
      name: true,
      leads: {
        orderBy: {
          updatedAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          ownerUserId: true
        }
      },
      apolloCompanyMatches: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          classification: true
        }
      },
      hunterOpportunitySignals: {
        where: {
          sourceName: "Hunter company research"
        },
        orderBy: {
          observedAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          sourceName: true,
          serviceLine: true,
          observedAt: true,
          evidence: true
        }
      },
      hunterProspectingDecisions: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          status: true,
          serviceLine: true,
          opportunityType: true,
          rationale: true,
          recommendedPersona: true,
          recommendedSender: true,
          recommendedCadence: true,
          createdAt: true
        }
      }
    }
  });

  if (!company) {
    throw new Error("This company is no longer available for Apollo review.");
  }

  const latestMatch = company.apolloCompanyMatches[0] ?? null;
  if (
    !latestMatch ||
    latestMatch.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY
  ) {
    throw new Error("This company no longer has an unresolved Apollo match.");
  }

  const eligibility = evaluateHunterOutreachEligibility({
    researchSignal: company.hunterOpportunitySignals[0] ?? null,
    prospectingDecision: company.hunterProspectingDecisions[0] ?? null,
    maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
  });
  if (eligibility.status !== "ELIGIBLE") {
    throw new Error(
      `${company.name} is no longer a current Qwen/Kimi-vetted Hunter opportunity. Refresh Apollo Exceptions before continuing.`
    );
  }

  const existingLead = company.leads[0] ?? null;
  if (existingLead) {
    if (!existingLead.ownerUserId) {
      await prisma.lead.update({
        where: {
          id: existingLead.id
        },
        data: {
          ownerUserId
        }
      });
    }
    return existingLead.id;
  }

  const lead = await prisma.lead.upsert({
    where: {
      tenantId_companyId: {
        tenantId,
        companyId
      }
    },
    update: {},
    create: {
      tenantId,
      companyId,
      ownerUserId,
      notes: `Hunter Apollo exception assigned to ${ownerEmail} on ${new Date().toISOString()}.`
    },
    select: {
      id: true
    }
  });
  return lead.id;
}

async function attachCurrentHunterApolloReviewLead(
  context: Awaited<ReturnType<typeof authorizeLeadGenMutation>>,
  formData: FormData
) {
  const companyId = readRequired(formData, "companyId");
  const leadId = await ensureCurrentHunterApolloReviewLead({
    tenantId: context.tenantId,
    companyId,
    ownerUserId: context.userId,
    ownerEmail: context.userEmail
  });
  formData.set("leadId", leadId);
  return leadId;
}

async function cancelTradeMiningProfileRunRequests(
  client: SearchProfileMutationClient,
  tenantId: string,
  profileId: string,
  cancellationReason: string
) {
  await client.automationJobRun.updateMany({
    where: {
      tenantId,
      jobType: "trademining.run_request",
      status: {
        in: [JobStatus.QUEUED, JobStatus.RUNNING]
      },
      input: {
        path: ["searchProfileId"],
        equals: profileId
      }
    },
    data: {
      status: JobStatus.CANCELLED,
      finishedAt: new Date(),
      output: {
        cancellationReason
      }
    }
  });
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

export type SearchProfileFormState = {
  status: "idle" | "success" | "error";
  message: string | null;
};

export async function createTradeMiningSearchProfileFormAction(
  _previousState: SearchProfileFormState,
  formData: FormData
): Promise<SearchProfileFormState> {
  return runSearchProfileFormAction(
    () => createTradeMiningSearchProfileAction(formData),
    "Search profile created."
  );
}

export async function updateTradeMiningSearchProfileAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const profileId = readRequired(formData, "profileId");
  const payload = readSearchProfilePayload(formData);
  const profile = await client.tradeMiningSearchProfile.findFirst({
    where: {
      id: profileId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!profile) {
    throw new Error("Search profile not found for this tenant.");
  }

  await client.tradeMiningSearchProfile.update({
    where: {
      id: profileId
    },
    data: {
      ...payload
    }
  });

  if (!payload.enabled) {
    await cancelTradeMiningProfileRunRequests(client, context.tenantId, profileId, "Search profile disabled");
  }

  revalidateTradeMiningProfileSurfaces();
}

export async function updateTradeMiningSearchProfileFormAction(
  _previousState: SearchProfileFormState,
  formData: FormData
): Promise<SearchProfileFormState> {
  return runSearchProfileFormAction(
    () => updateTradeMiningSearchProfileAction(formData),
    "Search profile saved."
  );
}

export async function deleteTradeMiningSearchProfileAction(formData: FormData) {
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
      id: true
    }
  });

  if (!profile) {
    throw new Error("Search profile not found for this tenant.");
  }

  await cancelTradeMiningProfileRunRequests(client, context.tenantId, profileId, "Search profile deleted");

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
  await setCandidateStatusForCompany(client, context.tenantId, companyId, status, context.userId);

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
    await setCandidateStatusForCompany(client, context.tenantId, companyId, status, context.userId);
  }

  revalidateLeadGenSurfaces();
}

export async function updateLeadStageAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const leadId = readRequired(formData, "leadId");
  const stage = readLeadStage(formData.get("stage"));
  await setLeadStageForTenant(client, context.tenantId, leadId, stage, context.userId);

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateLeadStageAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const stage = readLeadStage(formData.get("stage"));
  const leadIds = readSelectedIds(formData, "leadId");

  for (const leadId of leadIds) {
    await setLeadStageForTenant(client, context.tenantId, leadId, stage, context.userId);
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
      skippedReviewCompanies: 0,
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
              apolloOrganizationId: true,
              apolloCompanyMatches: {
                orderBy: {
                  createdAt: "desc"
                },
                take: 1,
                select: {
                  classification: true
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
        throw new Error("Assign a sales rep before queueing Apollo enrichment.");
      }

      const assignedOwnerUserId = lead.ownerUserId;
      const latestCompanyMatch = lead.company.apolloCompanyMatches[0] ?? null;
      if (
        latestCompanyMatch &&
        latestCompanyMatch.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY
      ) {
        summary.skippedReviewCompanies += 1;
        continue;
      }

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

      const recordedMatch = await recordApolloCompanyMatch({
        tenantId: context.tenantId,
        companyId: lead.companyId,
        lookup
      });

      summary.processedCompanies += 1;

      if (recordedMatch.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY) {
        summary.reviewNeededCompanies += 1;

        await prisma.lead.update({
          where: {
            id: leadId
          },
          data: {
            notes: appendLeadNote(
              queuedNotes,
              `Apollo company review needed on ${new Date().toISOString()}. ${recordedMatch.matchReason}`
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
      message:
        `Apollo enrichment finished for ${summary.processedCompanies} compan${summary.processedCompanies === 1 ? "y" : "ies"}.` +
        (summary.skippedReviewCompanies > 0
          ? ` ${summary.skippedReviewCompanies} compan${summary.skippedReviewCompanies === 1 ? "y was" : "ies were"} skipped because Apollo match review is already required.`
          : ""),
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

  const recordedMatch = await recordApolloCompanyMatch({
    tenantId: context.tenantId,
    companyId: lead.companyId,
    lookup
  });

  if (recordedMatch.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY) {
    await prisma.lead.update({
      where: {
        id: lead.id
      },
      data: {
        notes: appendLeadNote(
          suggestionNotes,
          `Apollo company review needed on ${new Date().toISOString()}. Tried "${suggestion.suggestedCompanyName}". ${recordedMatch.matchReason}`
        )
      }
    });

    revalidateLeadGenSurfaces();
    return {
      matched: false,
      contactsImported: 0
    };
  }

  const resolvedNotes = appendLeadNote(
    suggestionNotes,
    `Apollo company review resolved on ${new Date().toISOString()}. Retried with "${suggestion.suggestedCompanyName}".`
  );

  const contactsImported = await finalizeApolloEnrichmentForLead({
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
  return {
    matched: true,
    contactsImported
  };
}

export async function retryApolloCompanyReviewFromQueueAction(
  _previousState: ApolloMatchReviewActionState,
  formData: FormData
): Promise<ApolloMatchReviewActionState> {
  try {
    const context = await authorizeLeadGenMutation();
    if (formData.get("confirmAutomaticCredits") !== "yes") {
      throw new Error("Confirm the automatic Apollo search credit limit before retrying.");
    }
    await attachCurrentHunterApolloReviewLead(context, formData);
    const result = await retryApolloCompanyReviewAction(formData);
    return {
      status: "success",
      message: result.matched
        ? `Apollo company matched and ${result.contactsImported} contact${result.contactsImported === 1 ? "" : "s"} imported.`
        : "Apollo still could not confirm a direct company match. The company remains in this review queue.",
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    return apolloMatchReviewErrorState(error);
  }
}

export async function confirmApolloNoMatchAction(
  _previousState: ApolloMatchReviewActionState,
  formData: FormData
): Promise<ApolloMatchReviewActionState> {
  try {
    const context = await authorizeLeadGenMutation();
    const leadId = await attachCurrentHunterApolloReviewLead(context, formData);
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId: context.tenantId
      },
      select: {
        id: true,
        notes: true,
        company: {
          select: {
            name: true,
            apolloCompanyMatches: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                classification: true
              }
            }
          }
        }
      }
    });

    if (!lead) {
      throw new Error("Lead not found for this tenant.");
    }

    const latestMatch = lead.company.apolloCompanyMatches[0] ?? null;
    if (!latestMatch || latestMatch.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY) {
      throw new Error("This company no longer has an unresolved Apollo match.");
    }

    const reviewedAt = new Date();
    await prisma.$transaction([
      prisma.apolloCompanyMatch.update({
        where: {
          id: latestMatch.id
        },
        data: {
          reviewedAt,
          reviewedByUserId: context.userId
        }
      }),
      prisma.lead.update({
        where: {
          id: lead.id
        },
        data: {
          notes: appendLeadNote(
            lead.notes,
            `Apollo no-match confirmed by ${context.userEmail} on ${reviewedAt.toISOString()}. Automatic and bulk retries remain blocked until the review is reopened.`
          )
        }
      })
    ]);

    revalidateLeadGenSurfaces();
    return {
      status: "success",
      message: `${lead.company.name} was moved to Confirmed no match. Automatic and bulk retries are blocked.`,
      completedAt: reviewedAt.toISOString()
    };
  } catch (error) {
    return apolloMatchReviewErrorState(error);
  }
}

export async function reopenApolloMatchReviewAction(
  _previousState: ApolloMatchReviewActionState,
  formData: FormData
): Promise<ApolloMatchReviewActionState> {
  try {
    const context = await authorizeLeadGenMutation();
    const leadId = await attachCurrentHunterApolloReviewLead(context, formData);
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId: context.tenantId
      },
      select: {
        id: true,
        notes: true,
        company: {
          select: {
            name: true,
            apolloCompanyMatches: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                classification: true,
                reviewedAt: true
              }
            }
          }
        }
      }
    });

    if (!lead) {
      throw new Error("Lead not found for this tenant.");
    }

    const latestMatch = lead.company.apolloCompanyMatches[0] ?? null;
    if (
      !latestMatch ||
      !latestMatch.reviewedAt ||
      latestMatch.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY
    ) {
      throw new Error("This company is not in Confirmed no match.");
    }

    const reopenedAt = new Date();
    await prisma.$transaction([
      prisma.apolloCompanyMatch.update({
        where: {
          id: latestMatch.id
        },
        data: {
          reviewedAt: null,
          reviewedByUserId: null
        }
      }),
      prisma.lead.update({
        where: {
          id: lead.id
        },
        data: {
          notes: appendLeadNote(
            lead.notes,
            `Apollo match review reopened by ${context.userEmail} on ${reopenedAt.toISOString()}.`
          )
        }
      })
    ]);

    revalidateLeadGenSurfaces();
    return {
      status: "success",
      message: `${lead.company.name} was returned to the active Apollo match review queue.`,
      completedAt: reopenedAt.toISOString()
    };
  } catch (error) {
    return apolloMatchReviewErrorState(error);
  }
}

export async function mapApolloCompanyUrlAction(
  _previousState: ApolloMatchReviewActionState,
  formData: FormData
): Promise<ApolloMatchReviewActionState> {
  try {
    const context = await authorizeLeadGenMutation();
    const apolloCompanyReference = parseApolloCompanyReference(
      readRequired(formData, "apolloCompanyUrl")
    );
    if (formData.get("confirmApolloCredit") !== "yes") {
      throw new Error("Confirm the one-credit Apollo company validation before mapping.");
    }
    const leadId = await attachCurrentHunterApolloReviewLead(context, formData);

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
            apolloOrganizationId: true,
            apolloCompanyMatches: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                classification: true
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
      throw new Error("Assign a sales rep before mapping an Apollo company.");
    }
    const latestMatch = lead.company.apolloCompanyMatches[0] ?? null;
    if (
      !latestMatch ||
      latestMatch.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY
    ) {
      throw new Error("This company no longer has an unresolved Apollo match.");
    }

    const mapping = await fetchApolloOrganizationForMapping({
      companyName: lead.company.name,
      apolloOrganizationId: apolloCompanyReference.id,
      resourceType: apolloCompanyReference.resourceType
    });
    const duplicate = await prisma.company.findFirst({
      where: {
        tenantId: context.tenantId,
        apolloOrganizationId: mapping.organizationId,
        id: {
          not: lead.companyId
        }
      },
      select: {
        name: true
      }
    });
    if (duplicate) {
      throw new Error(`That Apollo company is already mapped to ${duplicate.name}.`);
    }
    const mappedAt = new Date();
    const mappingNote =
      `Apollo company manually mapped by ${context.userEmail} on ${mappedAt.toISOString()}. ` +
      `Mapped "${lead.company.name}" to "${mapping.companyName}".`;

    await prisma.$transaction([
      prisma.company.update({
        where: {
          id: lead.companyId
        },
        data: {
          apolloOrganizationId: mapping.organizationId,
          domain: mapping.domain ?? lead.company.domain,
          linkedinUrl: mapping.linkedinUrl ?? lead.company.linkedinUrl
        }
      }),
      prisma.apolloCompanyMatch.create({
        data: {
          tenantId: context.tenantId,
          companyId: lead.companyId,
          apolloOrganizationId: mapping.match.organizationId,
          apolloCompanyName: mapping.match.companyName,
          apolloDomain: mapping.match.domain,
          apolloLinkedinUrl: mapping.match.linkedinUrl,
          score: mapping.match.score,
          classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
          nameMatchType: mapping.match.nameMatchType,
          domainMatch: mapping.match.domainMatch,
          logisticsProviderMatch: mapping.match.logisticsProviderMatch,
          branchLocationMatch: mapping.match.branchLocationMatch,
          matchReason: `${mapping.match.matchReason}; manually confirmed from Apollo company URL`,
          queryJson: toInputJsonValue({
            ...mapping.match.query,
            source: "manual-apollo-url"
          }),
          rawJson: mapping.match.rawPayload
            ? toInputJsonValue(mapping.match.rawPayload)
            : Prisma.JsonNull,
          reviewedAt: mappedAt,
          reviewedByUserId: context.userId
        }
      }),
      prisma.lead.update({
        where: {
          id: lead.id
        },
        data: {
          notes: appendLeadNote(lead.notes, mappingNote)
        }
      })
    ]);

    try {
      const queued = await enqueueHunterCompanyOutreachHandoff({
        tenantId: context.tenantId,
        companyId: lead.companyId,
        forceContactReview: true
      });
      if (queued.state !== "queued") {
        revalidateLeadGenSurfaces();
        return {
          status: queued.state === "nothing_eligible" ? "error" : "success",
          message:
            `${lead.company.name} was mapped to ${mapping.companyName}. ` +
            ("message" in queued
              ? queued.message
              : "Hunter contact review is already queued."),
          completedAt: new Date().toISOString()
        };
      }
      const processed = await processNextHunterOutreachHandoff({
        tenantId: context.tenantId,
        runId: queued.runId
      });
      const result = "result" in processed ? processed.result : null;

      revalidateLeadGenSurfaces();
      return {
        status:
          result?.state === "NO_CONTACTS" ||
          result?.state === "REVIEW_REQUIRED" ||
          result?.state === "CONTACT_REVIEW_REQUIRED" ||
          result?.state === "ERROR"
            ? "error"
            : "success",
        message:
          `${lead.company.name} was mapped to ${mapping.companyName}. ` +
          (result
            ? `${result.apolloContactsFound} Apollo employee${result.apolloContactsFound === 1 ? "" : "s"} found; ` +
              `${result.contactsRanked} reviewed; ${result.actionablePlans} QA-passed plan${result.actionablePlans === 1 ? "" : "s"} ready. ` +
              `Hunter enforced the saved maximum of three selected contacts. ${result.message}`
            : "Hunter contact review was queued and will continue in the protected worker."),
        completedAt: new Date().toISOString()
      };
    } catch (contactError) {
      const warning =
        contactError instanceof Error ? contactError.message : "Apollo contact search failed.";
      await prisma.lead.update({
        where: {
          id: lead.id
        },
        data: {
          notes: appendLeadNote(
            appendLeadNote(lead.notes, mappingNote),
            `Apollo company mapping succeeded, but Hunter contact review needs retry. ${warning}`
          )
        }
      });
      revalidateLeadGenSurfaces();
      return {
        status: "success",
        message: `${lead.company.name} was mapped successfully. Hunter contact review needs a later retry: ${warning}`,
        completedAt: new Date().toISOString()
      };
    }
  } catch (error) {
    return apolloMatchReviewErrorState(error);
  }
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
        id: true,
        companyId: true,
        contactStatus: true,
        assignedRep: true,
        company: {
          select: {
            candidateStatus: true,
            doNotProspect: true,
            hunterOpportunitySignals: {
              where: {
                tenantId: context.tenantId,
                sourceName: "Hunter company research"
              },
              orderBy: {
                observedAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                sourceName: true,
                serviceLine: true,
                observedAt: true,
                evidence: true
              }
            },
            hunterProspectingDecisions: {
              where: {
                tenantId: context.tenantId
              },
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                status: true,
                serviceLine: true,
                opportunityType: true,
                rationale: true,
                recommendedPersona: true,
                recommendedSender: true,
                recommendedCadence: true,
                createdAt: true
              }
            }
          }
        }
      }
    });

    if (contacts.length !== contactIds.length) {
      throw new Error("One or more selected contacts were not found for this tenant.");
    }

    for (const contact of contacts) {
      const contactBlockReason = getContactSequencePushBlockReason(contact.contactStatus);
      if (contactBlockReason) {
        throw new Error(contactBlockReason);
      }

      if (
        contact.company.doNotProspect ||
        contact.company.candidateStatus === CandidateStatus.REJECTED ||
        contact.company.candidateStatus === CandidateStatus.DISQUALIFIED
      ) {
        throw new Error("The contact's company is blocked from prospecting.");
      }

      const assignmentBlockReason = getContactApolloAssignmentBlockReason(contact.assignedRep);
      if (assignmentBlockReason) {
        throw new Error(assignmentBlockReason);
      }

      const hunterEligibility = evaluateHunterOutreachEligibility({
        researchSignal: contact.company.hunterOpportunitySignals?.[0] ?? null,
        prospectingDecision: contact.company.hunterProspectingDecisions?.[0] ?? null,
        maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
      });
      if (hunterEligibility.status !== "ELIGIBLE") {
        throw new Error(`${hunterEligibility.label}: ${hunterEligibility.reason}`);
      }
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

export async function bulkApproveOutreachPlansAction(formData: FormData): Promise<ContactBulkActionSummary>;
export async function bulkApproveOutreachPlansAction(
  previousState: ContactBulkActionSummary,
  formData: FormData
): Promise<ContactBulkActionSummary>;
export async function bulkApproveOutreachPlansAction(
  firstArg: ContactBulkActionSummary | FormData,
  secondArg?: FormData
): Promise<ContactBulkActionSummary> {
  const context = await authorizeLeadGenMutation();
  const formData = firstArg instanceof FormData ? firstArg : secondArg;

  if (!formData) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "approve",
      message: "No outreach approval payload was provided.",
      completedAt: new Date().toISOString()
    };
  }

  try {
    const contactIds = readSelectedIds(formData, "contactId");
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: contactIds }
      },
      select: {
        id: true,
        companyId: true,
        fullName: true,
        email: true,
        contactStatus: true,
        assignedRep: true,
        company: {
          select: {
            name: true,
            candidateStatus: true,
            doNotProspect: true,
            hunterOpportunitySignals: {
              where: {
                tenantId: context.tenantId,
                sourceName: "Hunter company research"
              },
              orderBy: { observedAt: "desc" },
              take: 1,
              select: {
                id: true,
                sourceName: true,
                serviceLine: true,
                observedAt: true,
                evidence: true
              }
            },
            hunterProspectingDecisions: {
              where: { tenantId: context.tenantId },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                serviceLine: true,
                opportunityType: true,
                rationale: true,
                recommendedPersona: true,
                recommendedSender: true,
                recommendedCadence: true,
                createdAt: true
              }
            }
          }
        },
        outreachPlans: {
          where: {
            tenantId: context.tenantId,
            status: { not: OutreachPlanStatus.ARCHIVED }
          },
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            companyId: true,
            contactId: true,
            sequenceName: true,
            version: true,
            status: true,
            qaStatus: true,
            qaIssues: true,
            evidenceFingerprint: true
          }
        }
      }
    });

    if (contacts.length !== contactIds.length) {
      throw new Error("One or more selected contacts were not found for this tenant.");
    }

    type BulkApprovalContact = (typeof contacts)[number];
    type BulkApprovalPlan = BulkApprovalContact["outreachPlans"][number];
    const approved: Array<{
      contact: BulkApprovalContact;
      plan: BulkApprovalPlan;
    }> = [];
    const details: ContactBulkActionSummary["details"] = [];
    for (const contact of contacts) {
      const plan = contact.outreachPlans[0] ?? null;
      const hunterEligibility = evaluateHunterOutreachEligibility({
        researchSignal: contact.company.hunterOpportunitySignals[0] ?? null,
        prospectingDecision: contact.company.hunterProspectingDecisions[0] ?? null,
        maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
      });
      const planApprovalBlockReason = plan
        ? getOutreachPlanApprovalBlockReason(plan)
        : "No current outreach plan is available.";
      const blockReason =
        planApprovalBlockReason
          ? planApprovalBlockReason
            : !hasUsableHunterEmail(contact)
              ? "A concrete usable email address is required before approval."
              : contact.company.doNotProspect ||
                  contact.company.candidateStatus === CandidateStatus.REJECTED ||
                  contact.company.candidateStatus === CandidateStatus.DISQUALIFIED
                ? "The company is blocked from prospecting."
                : contact.contactStatus === ContactStatus.REJECTED ||
                    contact.contactStatus === ContactStatus.DO_NOT_CONTACT
                  ? "The contact is blocked from outreach."
                  : hunterEligibility.status !== "ELIGIBLE"
                    ? `${hunterEligibility.label}: ${hunterEligibility.reason}`
                    : null;

      if (blockReason || !plan) {
        details.push({
          contactId: contact.id,
          contactName: contact.fullName,
          companyName: contact.company.name,
          outcome: "skipped",
          reason: blockReason
        });
        continue;
      }
      approved.push({ contact, plan });
      details.push({
        contactId: contact.id,
        contactName: contact.fullName,
        companyName: contact.company.name,
        outcome: "approved",
        reason: "QA-passed plan approved; Apollo enrollment queued."
      });
    }

    if (approved.length === 0) {
      return {
        ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
        status: "error",
        operation: "approve",
        message: "None of the selected contacts cleared the approval and enrollment safeguards.",
        completedAt: new Date().toISOString(),
        selectedContacts: contactIds.length,
        skippedContacts: details.length,
        details
      };
    }

    const requestedAt = new Date();
    const approvedContactIds = approved.map(({ contact }) => contact.id);
    const companiesTouched = new Set(
      approved.map(({ contact }) => contact.companyId)
    ).size;
    const enrollmentInput: ApolloPushJobInput = {
      contactIds: approvedContactIds,
      selectedContacts: approvedContactIds.length,
      requestedAt: requestedAt.toISOString()
    };
    const enrollmentOutput = createApolloPushJobOutput(
      approvedContactIds.length,
      companiesTouched
    );
    const enrollmentJob = await prisma.$transaction(async (tx) => {
      for (const { contact, plan } of approved) {
        const updatedPlan = await tx.outreachPlan.updateMany({
          where: {
            id: plan.id,
            tenantId: context.tenantId,
            contactId: contact.id,
            status: OutreachPlanStatus.QA_PASSED,
            qaStatus: OutreachQaStatus.PASSED
          },
          data: {
            status: OutreachPlanStatus.APPROVED,
            approvedAt: requestedAt,
            approvedByUserId: context.userId
          }
        });
        if (updatedPlan.count !== 1) {
          throw new Error(
            `${contact.fullName}'s outreach plan changed during approval. Refresh and try again.`
          );
        }
        await tx.contactOutreachDraft.updateMany({
          where: {
            tenantId: context.tenantId,
            contactId: contact.id,
            sequenceName: plan.sequenceName
          },
          data: {
            status: ContactOutreachDraftStatus.APPROVED,
            approvedAt: requestedAt
          }
        });
        await tx.contact.updateMany({
          where: {
            id: contact.id,
            tenantId: context.tenantId
          },
          data: {
            contactStatus: ContactStatus.APPROVED,
            assignedRep: contact.assignedRep ?? context.userId
          }
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "OUTREACH_PLAN_APPROVED",
            entityType: "OUTREACH_PLAN",
            entityId: plan.id,
            after: toInputJsonValue({
              contactId: contact.id,
              companyId: contact.companyId,
              version: plan.version,
              qaStatus: plan.qaStatus,
              evidenceFingerprint: plan.evidenceFingerprint,
              approvalMode: "BULK",
              apolloEnrollment: "QUEUED"
            })
          }
        });
      }
      return tx.automationJobRun.create({
        data: {
          tenantId: context.tenantId,
          jobType: APOLLO_PUSH_JOB_TYPE,
          status: JobStatus.QUEUED,
          input: toInputJsonValue(enrollmentInput),
          output: toInputJsonValue(enrollmentOutput)
        },
        select: { id: true }
      });
    });

    revalidateLeadGenSurfaces();
    const skippedContacts = contactIds.length - approved.length;
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "success",
      operation: "approve",
      message:
        `Approved ${approved.length} contact${approved.length === 1 ? "" : "s"} and queued one guarded Apollo enrollment job.` +
        (skippedContacts > 0
          ? ` ${skippedContacts} selected contact${skippedContacts === 1 ? " was" : "s were"} skipped; review the reasons below.`
          : ""),
      completedAt: new Date().toISOString(),
      jobRunId: enrollmentJob.id,
      jobStatus: JobStatus.QUEUED,
      selectedContacts: contactIds.length,
      approvedContacts: approved.length,
      skippedContacts,
      companiesTouched,
      details
    };
  } catch (error) {
    return {
      ...EMPTY_CONTACT_BULK_ACTION_SUMMARY,
      status: "error",
      operation: "approve",
      message: error instanceof Error ? error.message : "Bulk outreach approval failed.",
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
            apolloOrganizationId: true,
            candidateStatus: true,
            doNotProspect: true,
            hunterOpportunitySignals: {
              where: {
                tenantId,
                sourceName: "Hunter company research"
              },
              orderBy: {
                observedAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                sourceName: true,
                serviceLine: true,
                observedAt: true,
                evidence: true
              }
            },
            hunterProspectingDecisions: {
              where: {
                tenantId
              },
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                status: true,
                serviceLine: true,
                opportunityType: true,
                rationale: true,
                recommendedPersona: true,
                recommendedSender: true,
                recommendedCadence: true,
                createdAt: true
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
        },
        outreachPlans: {
          where: {
            tenantId,
            status: {
              not: OutreachPlanStatus.ARCHIVED
            }
          },
          orderBy: {
            version: "desc"
          },
          take: 1,
          select: {
            id: true,
            status: true,
            qaStatus: true,
            sequenceId: true,
            sequenceName: true
          }
        }
      }
    });

    const [repMappings, emailAccounts, sequenceDirectoryResult] = await Promise.all([
      loadApolloRepMappings(tenantId),
      fetchApolloEmailAccountDirectory().catch(() => []),
      loadLiveApolloSequenceDirectory()
    ]);
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    output.companiesTouched = new Set(contacts.map((contact) => contact.companyId)).size;
    const groups = new Map<string, ApolloPushGroup>();

    for (const contact of contacts) {
      const companyLookup =
        shouldRefreshApolloSequenceStatus(contact.sequenceStatus) || !contact.apolloContactId
        ? await getApolloCompanyLookupForContact(contact, companyLookupCache)
        : undefined;
      const validation = await validateApolloPushCandidate({
        tenantId,
        contact,
        repMappings,
        emailAccounts,
        sequenceDirectoryResult,
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
        await persistApolloPendingSequenceConfirmation({
          tenantId,
          contactId: contact.id,
          sequenceId: null,
          sequenceName: null,
          jobRunId: null,
          acceptedAt: null
        });
        await persistApolloPushJobProgress(jobRunId, output);
        continue;
      }

      if (validation.alreadyEnrolled) {
        output.enrolledContacts += 1;
        output.processedContacts += 1;
        output.details.push({
          contactId: contact.id,
          contactName: contact.fullName,
          companyName: contact.company.name,
          outcome: "enrolled",
          reason: `Already enrolled in "${validation.sequenceName}".`
        });
        await prisma.contact.updateMany({
          where: { id: contact.id, tenantId },
          data: {
            sequenceStatus: SequenceStatus.ENROLLED,
            selectedSequenceId: validation.sequenceId,
            selectedSequenceName: validation.sequenceName
          }
        });
        await appendApolloContactActivity({
          tenantId,
          contactId: contact.id,
          note:
            `Apollo enrollment validation on ${new Date().toISOString()} confirmed this contact was already active in "${validation.sequenceName}".`
        });
        await persistApolloPushBlocker({
          tenantId,
          contactId: contact.id,
          reason: null
        });
        await persistApolloPushJobProgress(jobRunId, output);
        continue;
      }

      await persistApolloPushBlocker({
        tenantId,
        contactId: contact.id,
        reason: null
      });
      await persistApolloPendingSequenceConfirmation({
        tenantId,
        contactId: contact.id,
        sequenceId: null,
        sequenceName: null,
        jobRunId: null,
        acceptedAt: null
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
        await persistApolloPendingSequenceConfirmation({
          tenantId,
          contactId: contact.id,
          sequenceId: null,
          sequenceName: null,
          jobRunId: null,
          acceptedAt: null
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
        const transitionsBySequence = new Map<string, ApolloPushReadyContact[]>();
        for (const contact of group.contacts) {
          if (!contact.previousSequenceId) continue;
          transitionsBySequence.set(contact.previousSequenceId, [
            ...(transitionsBySequence.get(contact.previousSequenceId) ?? []),
            contact
          ]);
        }
        const pushResult = await transitionApolloContactsToSequence({
          sequenceId: group.sequenceId,
          apolloContactIds: group.contacts.map((contact) => contact.apolloContactId),
          sequenceOwnerUserId: group.apolloOwnerUserId,
          sendFromEmailAccountId: group.sendFromEmailAccountId,
          initialStatus: "active",
          previousSequenceByContactId: Object.fromEntries(
            group.contacts.map((contact) => [
              contact.apolloContactId,
              contact.previousSequenceId
            ])
          )
        });
        for (const [previousSequenceId, transitionContacts] of transitionsBySequence) {
          await Promise.all(
            transitionContacts.map((contact) =>
              appendApolloContactActivity({
                tenantId,
                contactId: contact.contactId,
                note:
                  `Apollo cadence transition on ${new Date().toISOString()} removed the contact from prior cadence ${previousSequenceId} before enrolling in "${group.sequenceName}".`
              })
            )
          );
        }

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
              selectedSequenceId: group.sequenceId,
              selectedSequenceName: group.sequenceName,
              lastTouchAt: pushedAt
            }
          });
        }

        for (const contact of group.contacts) {
          const verified = verifiedResults.get(contact.contactId) ?? false;
          if (!verified) {
            const reason = verificationWasRateLimited
              ? "Apollo accepted the push, but Newl Apps hit Apollo rate limits before verification finished. Use Sync Apollo status shortly instead of re-pushing this contact."
              : APOLLO_PROPAGATION_PENDING_REASON;
            if (verificationWasRateLimited) {
              output.skippedContacts += 1;
            } else {
              output.pendingContacts += 1;
            }
            output.processedContacts += 1;
            if (verificationWasRateLimited) {
              failureReasons.add(reason);
            }
            output.details.push({
              contactId: contact.contactId,
              contactName: contact.fullName,
              companyName: group.companyName,
              outcome: verificationWasRateLimited ? "skipped" : "pending",
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
            } else {
              await persistApolloPendingSequenceConfirmation({
                tenantId,
                contactId: contact.contactId,
                sequenceId: group.sequenceId,
                sequenceName: group.sequenceName,
                jobRunId,
                acceptedAt: pushedAtIso
              });
              await persistApolloPushBlocker({
                tenantId,
                contactId: contact.contactId,
                reason: null
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
          await recordLeadOutcomeEvent({
            tenantId,
            companyId: group.companyId,
            contactId: contact.contactId,
            outcomeType: "APOLLO_SEQUENCE_ENROLLED",
            previousValue: contactsById.get(contact.contactId)?.sequenceStatus ?? null,
            currentValue: SequenceStatus.ENROLLED,
            source: "APOLLO",
            metadata: {
              sequenceId: group.sequenceId,
              sequenceName: group.sequenceName,
              jobRunId
            },
            occurredAt: pushedAt
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
          await persistApolloPendingSequenceConfirmation({
            tenantId,
            contactId: contact.contactId,
            sequenceId: null,
            sequenceName: null,
            jobRunId: null,
            acceptedAt: null
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
          await persistApolloPendingSequenceConfirmation({
            tenantId,
            contactId: contact.contactId,
            sequenceId: null,
            sequenceName: null,
            jobRunId: null,
            acceptedAt: null
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
  const draftId = readRequired(formData, "draftId");
  const subject = readRequired(formData, "subject");
  const body = readRequired(formData, "body");
  const draft = await prisma.contactOutreachDraft.findFirst({
    where: {
      id: draftId,
      tenantId: context.tenantId
    },
    select: {
      id: true,
      contactId: true,
      sequenceName: true
    }
  });

  if (!draft) {
    throw new Error("Draft not found for this tenant.");
  }

  const outreachPlan = await prisma.outreachPlan.findFirst({
    where: {
      tenantId: context.tenantId,
      contactId: draft.contactId,
      sequenceName: draft.sequenceName,
      status: {
        not: OutreachPlanStatus.ARCHIVED
      }
    },
    orderBy: {
      version: "desc"
    },
    select: {
      id: true
    }
  });

  if (outreachPlan) {
    const qaIssue: OutreachQaIssue = {
      code: "MANUAL_EDIT_REQUIRES_QA",
      severity: "ERROR",
      message: "The first email changed after QA. Regenerate the outreach plan to run grounding checks again.",
      stepNumber: 1
    };
    await prisma.$transaction([
      prisma.contactOutreachDraft.update({
        where: {
          id: draftId
        },
        data: {
          subject,
          body,
          status: ContactOutreachDraftStatus.EDITED,
          editedAt: new Date(),
          approvedAt: null
        }
      }),
      prisma.outreachPlan.update({
        where: {
          id: outreachPlan.id
        },
        data: {
          status: OutreachPlanStatus.QA_FAILED,
          qaStatus: OutreachQaStatus.FAILED,
          qaIssues: toInputJsonValue([qaIssue]),
          qaCheckedAt: new Date(),
          approvedAt: null,
          approvedByUserId: null
        }
      }),
      prisma.outreachSequenceStep.updateMany({
        where: {
          tenantId: context.tenantId,
          outreachPlanId: outreachPlan.id,
          stepNumber: 1
        },
        data: {
          subject,
          body,
          qaIssues: toInputJsonValue([qaIssue])
        }
      })
    ]);
  } else {
    await prisma.contactOutreachDraft.update({
      where: {
        id: draftId
      },
      data: {
        subject,
        body,
        status: ContactOutreachDraftStatus.APPROVED,
        editedAt: new Date(),
        approvedAt: new Date()
      }
    });
  }

  revalidateLeadGenSurfaces();
}

export async function approveOutreachPlanAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const planId = readRequired(formData, "planId");
  const plan = await prisma.outreachPlan.findFirst({
    where: {
      id: planId,
      tenantId: context.tenantId
    },
    include: {
      company: {
        select: {
          candidateStatus: true,
          doNotProspect: true
        }
      },
      contact: {
        select: {
          id: true,
          email: true,
          contactStatus: true,
          assignedRep: true
        }
      }
    }
  });

  if (!plan) {
    throw new Error("Outreach plan not found for this tenant.");
  }
  if (plan.status !== OutreachPlanStatus.QA_PASSED || plan.qaStatus !== OutreachQaStatus.PASSED) {
    throw new Error("This outreach plan must pass the grounded QA gate before approval.");
  }
  if (
    plan.company.doNotProspect ||
    plan.company.candidateStatus === CandidateStatus.REJECTED ||
    plan.company.candidateStatus === CandidateStatus.DISQUALIFIED
  ) {
    throw new Error("This company is blocked from prospecting.");
  }
  if (
    plan.contact.contactStatus === ContactStatus.REJECTED ||
    plan.contact.contactStatus === ContactStatus.DO_NOT_CONTACT
  ) {
    throw new Error("This contact is blocked from outreach.");
  }
  if (!hasUsableHunterEmail(plan.contact)) {
    throw new Error("A concrete usable email address is required before approval.");
  }

  const requestedAt = new Date();
  const enrollment = buildApprovedOutreachEnrollment({
    tenantId: context.tenantId,
    contactId: plan.contactId,
    assignedRep: plan.contact.assignedRep,
    actorUserId: context.userId,
    requestedAt
  });
  const transactionResult = await prisma.$transaction([
    prisma.outreachPlan.update({
      where: {
        id: plan.id
      },
      data: {
        status: OutreachPlanStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: context.userId
      }
    }),
    prisma.contactOutreachDraft.updateMany({
      where: {
        tenantId: context.tenantId,
        contactId: plan.contactId,
        sequenceName: plan.sequenceName
      },
      data: {
        status: ContactOutreachDraftStatus.APPROVED,
        approvedAt: new Date()
      }
    }),
    prisma.contact.update({
      where: {
        id: plan.contactId
      },
      data: {
        ...enrollment.contactUpdate
      }
    }),
    prisma.automationJobRun.create({
      data: {
        ...enrollment.job,
        input: toInputJsonValue(enrollment.job.input),
        output: toInputJsonValue(enrollment.job.output)
      }
    }),
    prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "OUTREACH_PLAN_APPROVED",
        entityType: "OUTREACH_PLAN",
        entityId: plan.id,
        after: toInputJsonValue({
          contactId: plan.contactId,
          companyId: plan.companyId,
          version: plan.version,
          qaStatus: plan.qaStatus,
          evidenceFingerprint: plan.evidenceFingerprint,
          apolloEnrollment: "QUEUED"
        })
      }
    })
  ]);
  const enrollmentJob = transactionResult[3] as { id: string };

  revalidateLeadGenSurfaces();
  redirect(`/lead-gen/outreach?apolloJob=${encodeURIComponent(enrollmentJob.id)}`);
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
  const reviewerFeedback = readOptional(formData, "reviewerFeedback");
  if (reviewerFeedback && reviewerFeedback.length > 2_000) {
    throw new Error("Email feedback must be 2,000 characters or fewer.");
  }
  await generateSharedOutreachPlanForContact({
    tenantId: context.tenantId,
    contactId,
    forceRegenerate: true,
    reviewerFeedback
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
  revalidatePath("/lead-gen/apollo-review");
  revalidatePath("/lead-gen/contacts");
  revalidatePath("/lead-gen/outreach");
  revalidatePath("/dashboard");
}

async function setCandidateStatusForCompany(
  client: SearchProfileMutationClient,
  tenantId: string,
  companyId: string,
  status: CandidateStatus,
  actorUserId: string | null
) {
  const company = await client.company.findFirst({
    where: {
      id: companyId,
      tenantId
    },
    select: {
      id: true,
      candidateStatus: true
    }
  });

  if (!company) {
    throw new Error("Company not found for this tenant.");
  }

  if (company.candidateStatus === status) {
    return;
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
    const scoring = await calculateLeadPipelineScoringForCompany({ tenantId }, companyId);
    const score = scoring?.score ?? 0;

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

    if (scoring) {
      await recordLeadScoreSnapshot({
        tenantId,
        companyId,
        scoreType: "COMPANY_OPPORTUNITY",
        score: scoring.score,
        modelVersion: COMPANY_SCORING_MODEL_VERSION,
        scoringConfig: scoring.scoringConfig,
        trigger: "CANDIDATE_APPROVED",
        searchProfileId: scoring.searchProfileId,
        explanation: scoring.reasoning,
        breakdown: scoring.breakdown,
        evidenceAsOf: scoring.evidenceAsOf
      });
    }
  }

  if (company.candidateStatus !== status) {
    await recordLeadOutcomeEvent({
      tenantId,
      companyId,
      outcomeType: "CANDIDATE_STATUS_CHANGED",
      previousValue: company.candidateStatus ?? null,
      currentValue: status,
      source: "USER_ACTION",
      actorUserId
    });
  }
}

async function setLeadStageForTenant(
  client: SearchProfileMutationClient,
  tenantId: string,
  leadId: string,
  stage: LeadPipelineStage,
  actorUserId: string | null
) {
  const lead = await client.lead.findFirst({
    where: {
      id: leadId,
      tenantId
    },
    select: {
      id: true,
      companyId: true,
      stage: true
    }
  });

  if (!lead) {
    throw new Error("Lead not found for this tenant.");
  }

  if (lead.stage === stage) {
    return;
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

  if (lead.stage !== stage) {
    await recordLeadOutcomeEvent({
      tenantId,
      companyId: lead.companyId,
      leadId,
      outcomeType: "PIPELINE_STAGE_CHANGED",
      previousValue: lead.stage,
      currentValue: stage,
      source: "USER_ACTION",
      actorUserId
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
      contactStatus: true,
      sequenceStatus: true
    }
  });

  if (contacts.length !== contactIds.length) {
    throw new Error("One or more contacts were not found for this tenant.");
  }

  const contactBlockReason = contacts
    .map((contact) => getContactScoringBlockReason(contact.contactStatus))
    .find((reason) => Boolean(reason));
  if (contactBlockReason) {
    throw new Error(contactBlockReason);
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
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  contactStatus: ContactStatus;
  assignedRep: string | null;
  recommendedSequenceId: string | null;
  recommendedSequenceName: string | null;
  selectedSequenceId: string | null;
  selectedSequenceName: string | null;
  apolloContactId: string | null;
  apolloPersonId: string | null;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
  company: {
    id: string;
    name: string;
    domain: string | null;
    linkedinUrl: string | null;
    apolloOrganizationId: string | null;
    candidateStatus: CandidateStatus;
    doNotProspect: boolean;
    hunterOpportunitySignals: Array<{
      id: string;
      sourceName: string | null;
      serviceLine: import("@prisma/client").HunterServiceLine;
      observedAt: Date;
      evidence: Prisma.JsonValue | null;
    }>;
    hunterProspectingDecisions: Array<{
      id: string;
      status: import("@prisma/client").HunterDecisionStatus;
      serviceLine: import("@prisma/client").HunterServiceLine;
      opportunityType: string;
      rationale: string;
      recommendedPersona: string | null;
      recommendedSender: string | null;
      recommendedCadence: string | null;
      createdAt: Date;
    }>;
  };
  outreachDrafts: Array<{
    id: string;
    status: ContactOutreachDraftStatus;
  }>;
  outreachPlans: Array<{
    id: string;
    status: OutreachPlanStatus;
    qaStatus: OutreachQaStatus;
    sequenceId: string | null;
    sequenceName: string;
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
  previousSequenceId: string | null;
  alreadyEnrolled: boolean;
};

function resolveEffectiveApolloSequence(
  contact: ApolloPushContactRecord,
  outreachPlan?: ApolloPushContactRecord["outreachPlans"][number] | null
) {
  if (outreachPlan?.sequenceId && outreachPlan.sequenceName) {
    return {
      id: outreachPlan.sequenceId,
      name: outreachPlan.sequenceName,
      usedRecommendationFallback: false
    };
  }
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
  sequenceDirectoryResult,
  companyLookup
}: {
  tenantId: string;
  contact: ApolloPushContactRecord;
  repMappings: ReturnType<typeof parseApolloRepMapping>;
  emailAccounts: ApolloEmailAccountDirectoryEntry[];
  sequenceDirectoryResult: ApolloSequenceDirectoryLoadResult;
  companyLookup?: ApolloContactLookupResult;
}): Promise<{ ok: true } & ApolloPushReadyContact | { ok: false; reason: string }> {
  const contactBlockReason = getContactSequencePushBlockReason(contact.contactStatus);
  if (contactBlockReason) {
    return { ok: false, reason: contactBlockReason };
  }
  if (contact.replyStatus !== ReplyStatus.NO_REPLY) {
    return {
      ok: false,
      reason: "This contact has replied and cannot be enrolled in a new automated cadence."
    };
  }

  if (
    contact.company.doNotProspect ||
    contact.company.candidateStatus === CandidateStatus.REJECTED ||
    contact.company.candidateStatus === CandidateStatus.DISQUALIFIED
  ) {
    return { ok: false, reason: "The contact's company is blocked from prospecting." };
  }

  const assignedRep = contact.assignedRep?.trim() ?? null;
  const assignmentBlockReason = getContactApolloAssignmentBlockReason(assignedRep);
  if (!assignedRep || assignmentBlockReason) {
    return {
      ok: false,
      reason: assignmentBlockReason ?? "Assign a sales rep before pushing this contact to Apollo."
    };
  }

  const hunterEligibility = evaluateHunterOutreachEligibility({
    researchSignal: contact.company.hunterOpportunitySignals?.[0] ?? null,
    prospectingDecision: contact.company.hunterProspectingDecisions?.[0] ?? null,
    maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
  });
  if (hunterEligibility.status !== "ELIGIBLE") {
    return {
      ok: false,
      reason: `${hunterEligibility.label}: ${hunterEligibility.reason}`
    };
  }

  if (!contact.email) {
    return { ok: false, reason: "Contact email is missing, so this contact stays out of sequence push." };
  }

  const latestDraft = contact.outreachDrafts[0] ?? null;
  const latestOutreachPlan = contact.outreachPlans?.[0] ?? null;
  const requiresAiDraft = await contactRequiresApprovedDraft(tenantId, contact.id);
  let effectiveSequence = resolveEffectiveApolloSequence(contact, latestOutreachPlan);

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

  if (sequenceDirectoryResult.error) {
    return {
      ok: false,
      reason: sequenceDirectoryResult.error
    };
  }

  const liveSequence = resolveLiveApolloSequence({
    requestedSequence: {
      id: effectiveSequence.id,
      name: effectiveSequence.name
    },
    directory: sequenceDirectoryResult.directory
  });
  if (!liveSequence.ok) {
    return {
      ok: false,
      reason: liveSequence.reason
    };
  }
  const resolvedEffectiveSequence = liveSequence.sequence;

  const liveState =
    contact.sequenceStatus !== SequenceStatus.NOT_STARTED ||
    contact.replyStatus !== ReplyStatus.NO_REPLY
      ? await refreshApolloContactStateForPush({
          tenantId,
          contact,
          companyLookup
        })
      : {
          sequenceStatus: contact.sequenceStatus,
          replyStatus: contact.replyStatus,
          sequenceId: null
        };
  const transition = decideApolloSequenceTransition({
    sequenceStatus: liveState.sequenceStatus,
    replyStatus: liveState.replyStatus,
    currentSequenceId: liveState.sequenceId,
    targetSequenceId: resolvedEffectiveSequence.id
  });
  if (transition.action === "BLOCK") {
    return { ok: false, reason: transition.reason };
  }

  const localOwner = await resolveAssignedRepUser({
    tenantId,
    assignedRep
  });

  if (!localOwner) {
    return { ok: false, reason: "Assigned rep no longer exists in Newl Apps." };
  }

  if (assignedRep !== localOwner.id) {
    await prisma.contact.update({
      where: {
        id: contact.id
      },
      data: {
        assignedRep: localOwner.id
      }
    });
  }

  const repMapping = selectApolloMailboxForCompany({
    entries: repMappings,
    owner: localOwner,
    companyId: contact.companyId
  });

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

  const outreachPlanBlockReason = getOutreachPlanApolloBlockReason(latestOutreachPlan);
  if (outreachPlanBlockReason) {
    return {
      ok: false,
      reason: outreachPlanBlockReason
    };
  }

  if (requiresAiDraft && latestDraft?.status !== ContactOutreachDraftStatus.APPROVED) {
    return {
      ok: false,
      reason: "This cadence requires an approved AI draft before Apollo push."
    };
  }

  let apolloContactId = contact.apolloContactId;
  if (!apolloContactId) {
    try {
      apolloContactId = await ensureApolloContactIdForPush({
        tenantId,
        contact,
        companyLookup
      });
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof ApolloRateLimitError
            ? "Apollo rate limit reached while preparing the contact. Wait a moment, then retry the approved contact."
            : error instanceof Error
              ? `Apollo contact preparation failed: ${error.message}`
              : "Apollo contact preparation failed before cadence enrollment."
      };
    }
  }

  if (
    contact.selectedSequenceId !== resolvedEffectiveSequence.id ||
    contact.selectedSequenceName !== resolvedEffectiveSequence.name
  ) {
    await prisma.contact.update({
      where: {
        id: contact.id
      },
      data: {
        selectedSequenceId: resolvedEffectiveSequence.id,
        selectedSequenceName: resolvedEffectiveSequence.name
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
    apolloContactId,
    sequenceId: resolvedEffectiveSequence.id,
    sequenceName: resolvedEffectiveSequence.name,
    apolloOwnerUserId: repMapping.apolloUserId,
    sendFromEmailAccountId: resolvedSendFromEmailAccountId,
    requiresAiDraft,
    draftId: latestDraft?.id ?? null,
    previousSequenceId:
      transition.action === "REMOVE_THEN_ENROLL"
        ? transition.previousSequenceId
        : null,
    alreadyEnrolled: transition.action === "ALREADY_ENROLLED"
  };
}

type ApolloSequenceDirectoryLoadResult =
  | {
      directory: ApolloSequenceDirectoryEntry[];
      error: null;
    }
  | {
      directory: [];
      error: string;
    };

async function loadLiveApolloSequenceDirectory(): Promise<ApolloSequenceDirectoryLoadResult> {
  try {
    const directory = await fetchApolloSequenceDirectory();
    return {
      directory,
      error: null
    };
  } catch {
    return {
      directory: [],
      error:
        "Newl Apps could not verify the live Apollo cadence directory. No enrollment was attempted; retry the approved contact after Apollo is available."
    };
  }
}

async function ensureApolloContactIdForPush({
  tenantId,
  contact,
  companyLookup
}: {
  tenantId: string;
  contact: ApolloPushContactRecord;
  companyLookup?: ApolloContactLookupResult;
}) {
  if (contact.apolloContactId) {
    return contact.apolloContactId;
  }
  if (!contact.email) {
    throw new Error("A concrete email address is required before creating an Apollo contact.");
  }

  const prepared = await prepareApolloContactForEnrollment({
    contact: {
      apolloContactId: contact.apolloContactId,
      apolloPersonId: contact.apolloPersonId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl
    },
    company: {
      name: contact.company.name,
      domain: contact.company.domain
    },
    savedContacts: companyLookup?.contacts ?? [],
    createContact: createApolloContactForEnrollment,
    persistContactIdentity: async ({
      apolloContactId,
      apolloPersonId
    }) => {
      const updated = await prisma.contact.updateMany({
        where: {
          id: contact.id,
          tenantId
        },
        data: {
          apolloContactId,
          apolloPersonId,
          apolloStatus: ApolloStatus.ENRICHED
        }
      });
      if (updated.count !== 1) {
        throw new Error(
          "The Newl Apps contact changed while Apollo was preparing it. Refresh and retry."
        );
      }
    }
  });

  await appendApolloContactActivity({
    tenantId,
    contactId: contact.id,
    note:
      `Apollo contact preparation on ${new Date().toISOString()} ` +
      `${
        prepared.resolution === "EXISTING_SAVED_CONTACT"
          ? "recovered the existing saved contact"
          : "created or deduplicated the saved contact"
      } required for cadence enrollment.`
  });
  return prepared.apolloContactId;
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
          sender_label: entry.senderLabel,
          active: entry.active,
          apollo_user_id: entry.apolloUserId,
          send_from_email: entry.sendFromEmail,
          send_from_email_account_id: entry.sendFromEmailAccountId,
          routing_weight: entry.routingWeight
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

    const syncedAt = new Date();
    const scoreSnapshot = await recordContactScoreSnapshot({
      tenantId,
      contactId: existing.id,
      trigger: "APOLLO_STATUS_SYNC"
    });

    await prisma.contact.update({
      where: {
        id: existing.id
      },
      data: {
        ...merged,
        apolloLastSyncedAt: syncedAt,
        apolloNextSyncAt: getNextApolloSyncAt(syncedAt),
        apolloSyncFailureCount: 0,
        apolloSyncLastError: null
      }
    });

    if (existing.sequenceStatus !== merged.sequenceStatus) {
      await recordLeadOutcomeEvent({
        tenantId,
        companyId,
        contactId: existing.id,
        leadId: lead?.id ?? null,
        outcomeType: "APOLLO_SEQUENCE_STATUS_CHANGED",
        previousValue: existing.sequenceStatus,
        currentValue: merged.sequenceStatus,
        source: "APOLLO",
        scoreSnapshotId: scoreSnapshot?.id ?? null
      });
    }

    if (existing.replyStatus !== merged.replyStatus) {
      await recordLeadOutcomeEvent({
        tenantId,
        companyId,
        contactId: existing.id,
        leadId: lead?.id ?? null,
        outcomeType: "APOLLO_REPLY_STATUS_CHANGED",
        previousValue: existing.replyStatus,
        currentValue: merged.replyStatus,
        source: "APOLLO",
        scoreSnapshotId: scoreSnapshot?.id ?? null
      });
    }

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

  return (
    incoming.sequenceId === sequenceId &&
    isApolloSequenceMembershipConfirmed(incoming.sequenceStatus)
  );
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

async function persistApolloPendingSequenceConfirmation({
  tenantId,
  contactId,
  sequenceId,
  sequenceName,
  jobRunId,
  acceptedAt,
  attemptCount = 0,
  lastCheckedAt = null,
  nextCheckAt = null
}: {
  tenantId: string;
  contactId: string;
  sequenceId: string | null;
  sequenceName: string | null;
  jobRunId: string | null;
  acceptedAt: string | null;
  attemptCount?: number;
  lastCheckedAt?: string | null;
  nextCheckAt?: string | null;
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
  const resolvedNextCheckAt =
    acceptedAt
      ? nextCheckAt ??
        new Date(
          new Date(acceptedAt).getTime() +
            APOLLO_ENROLLMENT_CONFIRMATION_RETRY_DELAYS_MS[
              Math.min(attemptCount, APOLLO_ENROLLMENT_CONFIRMATION_RETRY_DELAYS_MS.length - 1)
            ]
        ).toISOString()
      : null;

  const nextApolloData =
    sequenceId && sequenceName && jobRunId && acceptedAt
      ? {
          ...apolloData,
          pendingSequenceConfirmation: {
            sequenceId,
            sequenceName,
            jobRunId,
            acceptedAt,
            attemptCount,
            lastCheckedAt,
            nextCheckAt: resolvedNextCheckAt
          }
        }
      : Object.fromEntries(Object.entries(apolloData).filter(([key]) => key !== "pendingSequenceConfirmation"));

  await prisma.contact.update({
    where: {
      id: contactId
    },
    data: {
      rawJson: toInputJsonValue({
        ...currentRawJson,
        apollo: nextApolloData
      }),
      ...(resolvedNextCheckAt
        ? {
            apolloNextSyncAt: new Date(resolvedNextCheckAt)
          }
        : {})
    }
  });
}

export async function reconcileApolloPushJobPendingResults({
  tenantId,
  jobRunId
}: {
  tenantId: string;
  jobRunId: string;
}) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId,
      jobType: APOLLO_PUSH_JOB_TYPE
    },
    select: {
      id: true,
      status: true,
      output: true
    }
  });

  if (!job) {
    return false;
  }

  const output = parseApolloPushJobOutput(job.output);
  if (!output || output.details.length === 0) {
    return false;
  }

  const pendingDetails = output.details.filter(isApolloPushJobDetailPending);
  if (pendingDetails.length === 0) {
    return false;
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      id: {
        in: pendingDetails.map((detail) => detail.contactId)
      }
    },
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      fullName: true,
      title: true,
      department: true,
      seniority: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      contactStatus: true,
      apolloContactId: true,
      apolloPersonId: true,
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
      rawJson: true,
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

  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const companyLookupCache = new Map<string, Promise<ApolloContactLookupResult>>();
  const checkedAt = new Date();
  let changed = false;

  const nextDetails = await Promise.all(
    output.details.map(async (detail) => {
      if (!isApolloPushJobDetailPending(detail)) {
        return detail;
      }

      const contact = contactsById.get(detail.contactId);
      if (!contact) {
        return detail;
      }
      const confirmationTarget = resolveApolloEnrollmentConfirmationTarget({
        rawJson: contact.rawJson,
        jobRunId,
        selectedSequenceId: contact.selectedSequenceId,
        selectedSequenceName: contact.selectedSequenceName
      });
      if (!confirmationTarget) {
        changed = true;
        const reason =
          "Newl Apps cannot identify the exact requested Apollo cadence, so it cannot safely confirm enrollment. Select the intended cadence and retry this approved contact.";
        await persistApolloPushBlocker({
          tenantId,
          contactId: contact.id,
          reason
        });
        return {
          ...detail,
          outcome: "failed" as const,
          reason
        };
      }

      const pending = confirmationTarget.pending;
      const nextCheckAt = pending?.nextCheckAt ? new Date(pending.nextCheckAt) : null;
      const timedOut = pending
        ? checkedAt.getTime() - new Date(pending.acceptedAt).getTime() >=
          APOLLO_ENROLLMENT_CONFIRMATION_TIMEOUT_MS
        : true;
      if (
        pending &&
        !timedOut &&
        nextCheckAt &&
        Number.isFinite(nextCheckAt.getTime()) &&
        nextCheckAt.getTime() > checkedAt.getTime()
      ) {
        return detail;
      }

      const cacheKey = [
        contact.companyId,
        contact.company.apolloOrganizationId ?? "",
        contact.company.domain ?? "",
        contact.company.name
      ].join("|");
      const companyLookupPromise =
        companyLookupCache.get(cacheKey) ??
        fetchApolloContactsForCompany({
          companyName: contact.company.name,
          domain: contact.company.domain,
          apolloOrganizationId: contact.company.apolloOrganizationId
        });
      companyLookupCache.set(cacheKey, companyLookupPromise);
      const companyLookup = await companyLookupPromise;
      const liveState = await refreshApolloContactStateForPush({
        tenantId,
        contact,
        companyLookup
      });

      if (
        !isApolloSequenceMembershipConfirmed(liveState.sequenceStatus) ||
        liveState.sequenceId !== confirmationTarget.sequenceId
      ) {
        if (pending && !timedOut) {
          const attemptCount = pending.attemptCount + 1;
          const delayMs =
            APOLLO_ENROLLMENT_CONFIRMATION_RETRY_DELAYS_MS[
              Math.min(attemptCount, APOLLO_ENROLLMENT_CONFIRMATION_RETRY_DELAYS_MS.length - 1)
            ];
          await persistApolloPendingSequenceConfirmation({
            tenantId,
            contactId: contact.id,
            sequenceId: pending.sequenceId,
            sequenceName: pending.sequenceName,
            jobRunId: pending.jobRunId,
            acceptedAt: pending.acceptedAt,
            attemptCount,
            lastCheckedAt: checkedAt.toISOString(),
            nextCheckAt: new Date(checkedAt.getTime() + delayMs).toISOString()
          });
          return detail;
        }

        changed = true;
        const reason =
          pending
            ? APOLLO_ENROLLMENT_CONFIRMATION_FAILED_REASON
            : `Apollo does not currently show this contact in "${confirmationTarget.sequenceName}". Newl Apps recovered the selected cadence but could not confirm an active membership, so no second enrollment was attempted.`;
        await persistApolloPushBlocker({
          tenantId,
          contactId: contact.id,
          reason
        });
        await persistApolloPendingSequenceConfirmation({
          tenantId,
          contactId: contact.id,
          sequenceId: null,
          sequenceName: null,
          jobRunId: null,
          acceptedAt: null
        });
        await appendApolloContactActivity({
          tenantId,
          contactId: contact.id,
          note:
            `Apollo enrollment verification failed on ${checkedAt.toISOString()}. ` +
            `The contact was not visible in "${confirmationTarget.sequenceName}"${pending ? " after 10 minutes" : ""}.`
        });
        return {
          ...detail,
          outcome: "failed" as const,
          reason
        };
      }

      changed = true;
      await persistApolloPushBlocker({
        tenantId,
        contactId: contact.id,
        reason: null
      });
      await persistApolloPendingSequenceConfirmation({
        tenantId,
        contactId: contact.id,
        sequenceId: null,
        sequenceName: null,
        jobRunId: null,
        acceptedAt: null
      });
      await appendApolloContactActivity({
        tenantId,
        contactId: contact.id,
        note:
          `Apollo enrollment verification completed on ${checkedAt.toISOString()}. ` +
          `The contact is now visible in "${confirmationTarget.sequenceName}"` +
          `${confirmationTarget.source === "selected_sequence" ? " using the saved selected-cadence fallback" : ""}.`
      });

      return {
        ...detail,
        outcome: "enrolled" as const,
        reason:
          `Enrollment confirmed in "${confirmationTarget.sequenceName}".` +
          `${confirmationTarget.source === "selected_sequence" ? " Newl Apps recovered the missing confirmation marker from the saved selected cadence." : ""}`
      };
    })
  );

  if (!changed) {
    return false;
  }

  const nextOutput = recalculateApolloPushJobOutput(output, nextDetails);

  await prisma.automationJobRun.update({
    where: {
      id: jobRunId
    },
    data: {
      output: nextOutput,
      status: nextOutput.failedContacts > 0 && nextOutput.enrolledContacts === 0 ? JobStatus.ERROR : JobStatus.SUCCESS,
      errorMessage:
        nextOutput.failedContacts > 0 && nextOutput.enrolledContacts === 0
          ? nextOutput.details.find((detail) => detail.outcome === "failed")?.reason ?? "Apollo push failed."
          : null
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: null,
      action: "lead-gen.apollo-push.pending-reconciled",
      entityType: "AutomationJobRun",
      entityId: jobRunId,
      after: {
        enrolledContacts: nextOutput.enrolledContacts,
        pendingContacts: nextOutput.pendingContacts,
        failedContacts: nextOutput.failedContacts
      }
    }
  });

  return true;
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

async function refreshApolloContactStateForPush({
  tenantId,
  contact,
  companyLookup
}: {
  tenantId: string;
  contact: {
    id: string;
    fullName: string;
    email: string | null;
    apolloContactId: string | null;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
    recommendedSequenceName: string | null;
    recommendedSequenceId: string | null;
    selectedSequenceName: string | null;
    selectedSequenceId: string | null;
    lastTouchAt?: Date | null;
    lastReplyAt?: Date | null;
    assignedRep: string | null;
    company: {
      name: string;
      domain: string | null;
      apolloOrganizationId: string | null;
    };
  };
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
  const resolvedReplyStatus = incoming?.replyStatus ?? contact.replyStatus;

  if (
    resolvedSequenceStatus !== contact.sequenceStatus ||
    resolvedReplyStatus !== contact.replyStatus
  ) {
    await prisma.contact.update({
      where: {
        id: contact.id
      },
      data: {
        sequenceStatus: resolvedSequenceStatus,
        replyStatus: resolvedReplyStatus
      }
    });

    await appendApolloContactActivity({
      tenantId,
      contactId: contact.id,
      note:
        `Apollo push validation refreshed sequence status on ${new Date().toISOString()}. ` +
        `Status now reads ${resolvedSequenceStatus.toLowerCase()} with reply state ${resolvedReplyStatus.toLowerCase()}.`
    });
  }

  return {
    sequenceStatus: resolvedSequenceStatus,
    replyStatus: resolvedReplyStatus,
    sequenceId: incoming?.sequenceId ?? null
  };
}

function appendLeadNote(existingNotes: string | null, nextNote: string) {
  if (!existingNotes || existingNotes.trim().length === 0) {
    return nextNote;
  }

  return `${existingNotes}\n\n${nextNote}`;
}

function readSearchProfilePayload(formData: FormData) {
  const minShipmentVolumeNumber = readOptionalNumber(formData, "minShipmentVolume");
  const minAggregateTeuNumber = readOptionalNumber(formData, "minAggregateTeu");
  const industryFilterModeValue = formData.get("industryFilterMode");
  const destinationPorts = readMultiValueField(formData, "destinationPorts").map(
    (value) => canonicalizeTradeMiningDestinationPort(value) ?? value
  );
  const industryPackIds = formData
    .getAll("industryPackId")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  const payload = {
    name: readRequired(formData, "name"),
    destinationMarkets: readMultiValueField(formData, "destinationMarkets"),
    destinationPorts,
    originPorts: readMultiValueField(formData, "originPorts"),
    shipFromPorts: readMultiValueField(formData, "shipFromPorts"),
    originCountries: readMultiValueField(formData, "originCountries"),
    productKeywords: readStringList(formData, "productKeywords"),
    hsCodes: readStringList(formData, "hsCodes"),
    industryPackIds,
    industryFilterMode:
      typeof industryFilterModeValue === "string" && industryFilterModeValue.trim()
        ? industryFilterModeValue.trim()
        : "PREFER",
    allowedCompanyIdentityRoles: readSelectedCompanyIdentityRoles(formData),
    excludedCompanyKeywords: readStringList(formData, "excludedCompanyKeywords"),
    lookbackWindowDays: readRequiredInteger(formData, "lookbackWindowDays", 1, 365),
    minShipmentCount: readRequiredInteger(formData, "minShipmentCount", 0, 100000),
    minShipmentVolume: minShipmentVolumeNumber,
    minAggregateTeu: minAggregateTeuNumber,
    priorityWeight: readRequiredInteger(formData, "priorityWeight", 0, 100)
  };

  assertValidTradeMiningSearchProfile(payload);

  return {
    ...payload,
    scheduleFrequency: "daily",
    minShipmentVolume:
      minShipmentVolumeNumber === null ? null : new Prisma.Decimal(minShipmentVolumeNumber.toString()),
    minAggregateTeu:
      minAggregateTeuNumber === null ? null : new Prisma.Decimal(minAggregateTeuNumber.toString()),
    description: readOptional(formData, "description") ?? null,
    enabled: formData.get("enabled") === "true",
    scheduleTimezone: readOptional(formData, "scheduleTimezone") ?? "America/Toronto"
  };
}

async function runSearchProfileFormAction(
  mutation: () => Promise<void>,
  successMessage: string
): Promise<SearchProfileFormState> {
  try {
    await mutation();
    return {
      status: "success",
      message: successMessage
    };
  } catch (error) {
    return {
      status: "error",
      message: safeSearchProfileMutationMessage(error)
    };
  }
}

function safeSearchProfileMutationMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "A search profile with this name already exists.";
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message.startsWith("Invalid TradeMining search profile:") ||
      message.startsWith("Missing required field:") ||
      message.startsWith("Invalid integer for") ||
      message.startsWith("Invalid number for") ||
      message === "Search profile not found for this tenant."
    ) {
      return message;
    }
  }

  return "The profile could not be saved. No changes were applied.";
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

function readMultiValueField(formData: FormData, field: string) {
  const value = readOptional(formData, field);
  if (!value) {
    return [];
  }

  return value
    .split("\n")
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
  const resolvedMatch = resolveApolloContactDiscoveryMatch({
    classification: lookup.match.classification,
    matchReason: lookup.match.matchReason,
    contactsFound: lookup.contacts.length
  });
  await prisma.apolloCompanyMatch.create({
    data: {
      tenantId,
      companyId,
      apolloOrganizationId: lookup.match.organizationId,
      apolloCompanyName: lookup.match.companyName,
      apolloDomain: lookup.match.domain,
      apolloLinkedinUrl: lookup.match.linkedinUrl,
      score: lookup.match.score,
      classification: resolvedMatch.classification,
      nameMatchType: lookup.match.nameMatchType,
      domainMatch: lookup.match.domainMatch,
      logisticsProviderMatch: lookup.match.logisticsProviderMatch,
      branchLocationMatch: lookup.match.branchLocationMatch,
      matchReason: resolvedMatch.matchReason,
      queryJson: toInputJsonValue(lookup.match.query),
      rawJson: lookup.match.rawPayload ? toInputJsonValue(lookup.match.rawPayload) : Prisma.JsonNull
    }
  });
  return resolvedMatch;
}

function apolloMatchReviewErrorState(error: unknown): ApolloMatchReviewActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Apollo match review action failed.",
    completedAt: new Date().toISOString()
  };
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
    sequenceStatus: existing
      ? resolveTrackedSequenceStatus({
          existingStatus: existing.sequenceStatus,
          incomingStatus: incoming.sequenceStatus,
          selectedSequenceId: existing.selectedSequenceId,
          incomingSequenceId: incoming.sequenceId
        })
      : incoming.sequenceStatus,
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
      await generateSharedOutreachPlanForContact({
        tenantId,
        contactId,
        forceRegenerate: false,
        generateWhenNotRequired: true
      });
    } catch {
      // Keep Apollo enrichment resilient; contacts can still be reviewed and
      // drafts can be regenerated manually if OpenAI drafting fails.
    }
  }
}

// Retained temporarily for legacy draft payload compatibility; all callers use
// the shared Outreach Plan generator above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  if (!draftContext.requiresAiDraft && !forceRegenerate) {
    return;
  }
  if (draftContext.contactTier === "UNRANKED") {
    if (forceRegenerate) {
      throw new Error("This contact must be ranked before generating an outreach plan.");
    }
    return;
  }
  if (draftContext.hunterEligibility.status !== "ELIGIBLE" || !draftContext.hunterEligibility.directive) {
    if (forceRegenerate) {
      throw new Error(
        `${draftContext.hunterEligibility.label}: ${draftContext.hunterEligibility.reason}`
      );
    }
    return;
  }

  if (!draftContext.selectedSequenceName) {
    if (forceRegenerate) {
      throw new Error("Select a cadence for this contact before generating the AI draft.");
    }
    return;
  }

  const evidenceLedger = buildOutreachEvidenceLedger(draftContext);
  if (evidenceLedger.length === 0) {
    if (forceRegenerate) {
      throw new Error("No saved Hunter or TradeMining evidence is available for this company yet.");
    }
    return;
  }

  if (
    draftContext.existingOutreachPlan?.promptVersion === OUTREACH_PLAN_PROMPT_VERSION &&
    !forceRegenerate
  ) {
    return;
  }

  const models = loadOutreachModels();
  const hunterDirective = draftContext.hunterEligibility.directive;
  const strategyGeneration = await generateOutreachStrategy({
    model: models.strategy,
    companyName: draftContext.contact.company.name,
    companyDomain: draftContext.contact.company.domain,
    contact: {
      firstName: draftContext.contact.firstName,
      fullName: draftContext.contact.fullName,
      title: draftContext.contact.title,
      department: draftContext.contact.department,
      seniority: draftContext.contact.seniority
    },
    selectedSequenceName: draftContext.selectedSequenceName,
    recommendedPersona: hunterDirective.recommendedPersona,
    recommendedCadence: hunterDirective.recommendedCadence,
    hunterDirective,
    evidence: evidenceLedger,
    reviewerFeedback: null
  });
  const strategy = strategyGeneration.strategy;

  const sequenceGeneration = await generateCompleteOutreachSequence({
    model: models.drafting,
    companyName: draftContext.contact.company.name,
    contact: {
      firstName: draftContext.contact.firstName,
      fullName: draftContext.contact.fullName,
      title: draftContext.contact.title,
      department: draftContext.contact.department,
      seniority: draftContext.contact.seniority
    },
    selectedSequenceName: draftContext.selectedSequenceName,
    strategy,
    evidence: evidenceLedger,
    allowCallTask: hunterDirective.opportunityTier === "HOT_OPPORTUNITY",
    reviewerFeedback: null
  });
  const sequence = sequenceGeneration.sequence;
  const deterministicQa = runDeterministicOutreachQa({
    evidence: evidenceLedger,
    strategy,
    sequence,
    allowCallTask: hunterDirective.opportunityTier === "HOT_OPPORTUNITY"
  });
  let modelQa;
  let qaUsage = null;
  try {
    const qaReview = await reviewOutreachSequenceGrounding({
      model: models.qa,
      companyName: draftContext.contact.company.name,
      contact: {
        firstName: draftContext.contact.firstName,
        fullName: draftContext.contact.fullName,
        title: draftContext.contact.title,
        department: draftContext.contact.department,
        seniority: draftContext.contact.seniority
      },
      strategy,
      sequence,
      evidence: evidenceLedger
    });
    modelQa = qaReview.result;
    qaUsage = qaReview.usage;
  } catch (error) {
    modelQa = {
      passed: false,
      issues: [
        {
          code: "MODEL_QA_UNAVAILABLE",
          severity: "ERROR" as const,
          message: error instanceof Error ? error.message : "The model QA check could not be completed.",
          stepNumber: null
        }
      ]
    };
  }
  const qa = mergeOutreachQaResults(deterministicQa, modelQa);
  const firstEmail = sequence.steps.find((step) => step.channel === "EMAIL");
  if (!firstEmail?.subject) {
    throw new Error("The generated outreach sequence did not include a valid first email.");
  }
  const firstEmailSubject = firstEmail.subject;

  const rawInputs = {
    models,
    promptVersion: OUTREACH_PLAN_PROMPT_VERSION,
    modelUsage: {
      strategy: strategyGeneration.usage,
      drafting: sequenceGeneration.usage,
      qa: qaUsage
    },
    generatedAt: new Date().toISOString(),
    companyName: draftContext.contact.company.name,
    companyPriorityScore: draftContext.contact.company.priorityScore,
    leadScore: draftContext.leadScore,
    contactTier: draftContext.contactTier,
    selectedSequenceName: draftContext.selectedSequenceName,
    selectedSequenceId: draftContext.selectedSequenceId,
    hunterDirective,
    strategy,
    evidenceLedger
  };

  await prisma.$transaction(async (transaction) => {
    const latestPlan = await transaction.outreachPlan.findFirst({
      where: {
        tenantId,
        contactId: draftContext.contact.id
      },
      orderBy: {
        version: "desc"
      },
      select: {
        version: true
      }
    });
    await transaction.outreachPlan.updateMany({
      where: {
        tenantId,
        contactId: draftContext.contact.id,
        status: {
          not: OutreachPlanStatus.ARCHIVED
        }
      },
      data: {
        status: OutreachPlanStatus.ARCHIVED,
        archivedAt: new Date()
      }
    });
    const plan = await persistOutreachPlanWithSteps({
      transaction,
      plan: {
        tenantId,
        companyId: draftContext.contact.companyId,
        contactId: draftContext.contact.id,
        version: (latestPlan?.version ?? 0) + 1,
        status: qa.passed ? OutreachPlanStatus.QA_PASSED : OutreachPlanStatus.QA_FAILED,
        qaStatus: qa.passed ? OutreachQaStatus.PASSED : OutreachQaStatus.FAILED,
        serviceLine: strategy.serviceLine,
        opportunityType: strategy.opportunityType,
        objective: strategy.objective,
        triggerSummary: strategy.triggerSummary,
        buyerHypothesis: strategy.buyerHypothesis,
        valueProposition: strategy.valueProposition,
        likelyObjection: strategy.likelyObjection,
        callToAction: strategy.callToAction,
        channelStrategy: toInputJsonValue(strategy.channelStrategy),
        senderRecommendation: strategy.senderRecommendation,
        sequenceName: draftContext.selectedSequenceName,
        sequenceId: draftContext.selectedSequenceId,
        confidence: strategy.confidence,
        evidence: toInputJsonValue(evidenceLedger),
        evidenceFingerprint: fingerprintOutreachEvidence(evidenceLedger),
        strategyModel: models.strategy,
        draftingModel: models.drafting,
        qaModel: models.qa,
        promptVersion: OUTREACH_PLAN_PROMPT_VERSION,
        qaIssues: toInputJsonValue(qa.issues),
        qaCheckedAt: new Date()
      },
      steps: sequence.steps.map((step) => ({
        tenantId,
        stepNumber: step.stepNumber,
        channel: step.channel,
        delayDays: step.delayDays,
        subject: step.subject,
        body: step.body,
        angle: step.angle,
        evidenceRefs: toInputJsonValue(step.evidenceRefs),
        qaIssues: toInputJsonValue(
          qa.issues.filter((issue) => issue.stepNumber === null || issue.stepNumber === step.stepNumber)
        )
      }))
    });

    await transaction.contactOutreachDraft.upsert({
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
        subject: firstEmailSubject,
        body: firstEmail.body,
        status: qa.passed ? ContactOutreachDraftStatus.AVAILABLE : ContactOutreachDraftStatus.DRAFT,
        source: ContactOutreachDraftSource.OPENAI,
        aiGenerated: true,
        personalizationNotes: `${strategy.triggerSummary} Evidence: ${firstEmail.evidenceRefs.join(", ")}.`,
        approvedAt: null,
        rawInputs: toInputJsonValue(rawInputs),
        rawJson: toInputJsonValue({
          provider: "openai",
          outreachPlanId: plan.id,
          qa
        })
      },
      create: {
        tenantId,
        contactId: draftContext.contact.id,
        companyId: draftContext.contact.companyId,
        leadId: draftContext.leadId,
        sequenceName: draftContext.selectedSequenceName,
        sequenceId: draftContext.selectedSequenceId,
        subject: firstEmailSubject,
        body: firstEmail.body,
        status: qa.passed ? ContactOutreachDraftStatus.AVAILABLE : ContactOutreachDraftStatus.DRAFT,
        source: ContactOutreachDraftSource.OPENAI,
        aiGenerated: true,
        personalizationNotes: `${strategy.triggerSummary} Evidence: ${firstEmail.evidenceRefs.join(", ")}.`,
        rawInputs: toInputJsonValue(rawInputs),
        rawJson: toInputJsonValue({
          provider: "openai",
          outreachPlanId: plan.id,
          qa
        })
      }
    });

    await transaction.auditLog.create({
      data: {
        tenantId,
        actorUserId: null,
        action: "OUTREACH_PLAN_GENERATED",
        entityType: "OUTREACH_PLAN",
        entityId: plan.id,
        after: toInputJsonValue({
          contactId: draftContext.contact.id,
          companyId: draftContext.contact.companyId,
          version: (latestPlan?.version ?? 0) + 1,
          qaPassed: qa.passed,
          issueCount: qa.issues.length,
          promptVersion: OUTREACH_PLAN_PROMPT_VERSION,
          models
        })
      }
    });
  });
}

async function loadAiDraftContactContext({
  tenantId,
  contactId
}: {
  tenantId: string;
  contactId: string;
}) {
  const [scoringConfigRecord, profileRecords] = await Promise.all([
    prisma.tradeMiningScoringConfig.findUnique({
      where: {
        tenantId
      }
    }),
    prisma.tradeMiningSearchProfile.findMany({
      where: {
        tenantId
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
        contactCadenceConfig: true,
        lookbackWindowDays: true,
        minShipmentCount: true
      }
    })
  ]);
  const scoringConfig = normalizeLeadGenAiScoringConfig(scoringConfigRecord);
  const evidenceLookbackDays = Math.max(
    scoringConfig.lookbackWindowDays,
    ...profileRecords.map((profile) => profile.lookbackWindowDays)
  );
  const evidenceWhere = buildTradeMiningEvidenceWhere({ tenantId }, evidenceLookbackDays);
  const searchProfiles = new Map(
    profileRecords.map((profile) => [
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
        contactCadenceConfig: profile.contactCadenceConfig,
        lookbackWindowDays: profile.lookbackWindowDays,
        minShipmentCount: profile.minShipmentCount
      }
    ])
  );

  const [contact, apolloCredential, model] = await Promise.all([
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
              where: evidenceWhere,
              orderBy: {
                arrivalDate: "desc"
              },
              select: {
                rawJson: true,
                arrivalDate: true,
                createdAt: true,
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
            },
            hunterOpportunitySignals: {
              where: {
                tenantId,
                sourceName: "Hunter company research"
              },
              orderBy: {
                observedAt: "desc"
              },
              take: 5,
              select: {
                id: true,
                signalType: true,
                serviceLine: true,
                title: true,
                summary: true,
                sourceName: true,
                sourceUrl: true,
                sourcePublishedAt: true,
                observedAt: true,
                confidence: true,
                evidence: true
              }
            },
            hunterProspectingDecisions: {
              where: {
                tenantId
              },
              orderBy: {
                createdAt: "desc"
              },
              take: 3,
              select: {
                id: true,
                status: true,
                serviceLine: true,
                opportunityType: true,
                rationale: true,
                recommendedPersona: true,
                recommendedSender: true,
                recommendedCadence: true,
                evidence: true,
                confidence: true,
                createdAt: true
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
        },
        outreachPlans: {
          where: {
            tenantId,
            status: {
              not: OutreachPlanStatus.ARCHIVED
            }
          },
          orderBy: {
            version: "desc"
          },
          take: 1,
          select: {
            id: true,
            status: true,
            qaStatus: true,
            version: true,
            promptVersion: true,
            steps: {
              orderBy: { stepNumber: "asc" },
              select: {
                stepNumber: true,
                channel: true,
                subject: true,
                body: true
              }
            }
          }
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
    loadTier1DraftModel(tenantId)
  ]);

  if (!contact) {
    return null;
  }

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
  const hunterEligibility = evaluateHunterOutreachEligibility({
    researchSignal: contact.company.hunterOpportunitySignals?.[0] ?? null,
    prospectingDecision: contact.company.hunterProspectingDecisions?.[0] ?? null,
    maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
  });
  const recommendation = recommendSequenceForContact({
    contactTier: scoring.tier,
    title: contact.title,
    department: contact.department,
    companyName: contact.company.name,
    sequenceMappings: effectiveSequenceMappings,
    sequenceDirectory: apolloSequenceDirectory,
    hunterManaged: hunterEligibility.status === "ELIGIBLE"
  });
  const tierMapping = effectiveSequenceMappings.find((entry) => entry.tier === scoring.tier) ?? null;
  const useHunterRecommendation = shouldUseHunterSequenceRecommendation({
    hunterEligible: hunterEligibility.status === "ELIGIBLE",
    sequenceManuallyOverridden: contact.sequenceManuallyOverridden,
    selectedSequenceName: contact.selectedSequenceName
  });

  return {
    model,
    contact,
    contactScore: scoring.score,
    contactScoreSummary: scoring.summary,
    contactTier: scoring.tier,
    scoringConfig,
    evidence,
    shipmentDraftContext: buildShipmentDraftContext(contact.company.importRecords),
    selectedSequenceName:
      useHunterRecommendation
        ? recommendation.name
        : contact.selectedSequenceName ?? contact.recommendedSequenceName ?? recommendation.name ?? null,
    selectedSequenceId:
      useHunterRecommendation
        ? recommendation.id
        : contact.selectedSequenceId ?? contact.recommendedSequenceId ?? recommendation.id ?? null,
    selectedSequenceReason:
      useHunterRecommendation
        ? recommendation.reason
        : contact.sequenceRecommendationReason ?? recommendation.reason,
    requiresAiDraft: hunterEligibility.status === "ELIGIBLE" || (tierMapping?.requiresAiDraft ?? false),
    hunterEligibility,
    existingDraft: contact.outreachDrafts[0] ?? null,
    existingOutreachPlan: contact.outreachPlans[0] ?? null,
    leadId: contact.company.leads[0]?.id ?? null,
    leadScore: companyLeadScore
  };
}

function loadOutreachModels() {
  return {
    strategy:
      process.env.LEAD_GEN_OUTREACH_STRATEGY_MODEL?.trim() ||
      DEFAULT_OUTREACH_STRATEGY_MODEL,
    drafting:
      process.env.LEAD_GEN_OUTREACH_DRAFT_MODEL?.trim() ||
      DEFAULT_OUTREACH_DRAFT_MODEL,
    qa:
      process.env.LEAD_GEN_OUTREACH_QA_MODEL?.trim() ||
      DEFAULT_OUTREACH_QA_MODEL
  };
}

function buildOutreachEvidenceLedger(
  draftContext: NonNullable<Awaited<ReturnType<typeof loadAiDraftContactContext>>>
): OutreachEvidenceRecord[] {
  const records: OutreachEvidenceRecord[] = [
    {
      id: "company:identity",
      kind: "COMPANY",
      title: `${draftContext.contact.company.name} identity and buyer context`,
      summary: `${draftContext.contact.fullName} is saved as ${
        draftContext.contact.title ?? "a contact with an unconfirmed title"
      } at ${draftContext.contact.company.name}.`,
      sourceUrl: draftContext.contact.company.domain
        ? `https://${draftContext.contact.company.domain.replace(/^https?:\/\//i, "")}`
        : null,
      publishedAt: null,
      facts: [
        `Company: ${draftContext.contact.company.name}`,
        `Contact: ${draftContext.contact.fullName}`,
        draftContext.contact.title ? `Contact title: ${draftContext.contact.title}` : "Contact title is unknown",
        draftContext.contact.department
          ? `Contact department: ${draftContext.contact.department}`
          : "Contact department is unknown"
      ]
    }
  ];

  if (draftContext.contact.company.importRecords.length > 0) {
    const shipmentFacts = [
      `${draftContext.evidence.shipmentCount} shipments during the saved evidence lookback`,
      draftContext.evidence.totalTeu > 0 ? `${formatDecimalValue(draftContext.evidence.totalTeu)} TEUs` : null,
      draftContext.evidence.latestShipmentDate
        ? `Latest saved arrival date: ${draftContext.evidence.latestShipmentDate.toISOString().slice(0, 10)}`
        : null,
      draftContext.evidence.destinationPort
        ? `Arrival port: ${draftContext.evidence.destinationPort}`
        : null,
      draftContext.evidence.destinationMarket
        ? `Destination market: ${draftContext.evidence.destinationMarket}`
        : null,
      draftContext.evidence.originCountry
        ? `Origin country: ${draftContext.evidence.originCountry}`
        : null,
      draftContext.evidence.productDescription
        ? `Product description: ${draftContext.evidence.productDescription}`
        : null,
      ...draftContext.shipmentDraftContext.recentShipmentHighlights.slice(0, 4)
    ].filter((value): value is string => Boolean(value));

    records.push({
      id: "trademining:summary",
      kind: "TRADEMINING",
      title: `${draftContext.contact.company.name} saved TradeMining activity`,
      summary: shipmentFacts.join(". "),
      sourceUrl: null,
      publishedAt: draftContext.evidence.latestShipmentDate?.toISOString() ?? null,
      facts: shipmentFacts
    });
  }

  const researchSignal = draftContext.contact.company.hunterOpportunitySignals?.[0] ?? null;
  if (researchSignal) {
    const research = asObject(asObject(researchSignal.evidence).research);
    const researchEvidence = Array.isArray(research.evidence) ? research.evidence : [];
    for (const [index, rawEvidence] of researchEvidence.slice(0, 7).entries()) {
      const evidence = asObject(rawEvidence);
      const sourceUrl = readString(evidence, "url");
      const title = readString(evidence, "title");
      const excerpt = readString(evidence, "excerpt");
      if (!sourceUrl || !title || !excerpt) continue;
      records.push({
        id: `hunter-research:${researchSignal.id}:${index + 1}`,
        kind: "HUNTER_RESEARCH",
        title,
        summary: excerpt,
        sourceUrl,
        publishedAt: readString(evidence, "publishedAt"),
        facts: [
          readString(evidence, "pass") ? `Research pass: ${readString(evidence, "pass")}` : null,
          readString(evidence, "sourceType") ? `Source type: ${readString(evidence, "sourceType")}` : null,
          excerpt
        ].filter((value): value is string => Boolean(value))
      });
    }
  }

  const directive = draftContext.hunterEligibility.directive;
  const decision = draftContext.contact.company.hunterProspectingDecisions?.[0] ?? null;
  if (directive && decision) {
    records.push({
      id: `hunter-decision:${decision.id}`,
      kind: "HUNTER_DECISION",
      title: `${directive.opportunityTier.replaceAll("_", " ")}: ${directive.opportunityType}`,
      summary: directive.rationale,
      sourceUrl: null,
      publishedAt: decision.createdAt.toISOString(),
      facts: [
        `Hunter-required service line: ${directive.requiredServiceLine}`,
        `Hunter final score: ${directive.finalScore}`,
        `Hunter final confidence: ${directive.finalConfidence}`,
        directive.recommendedPersona ? `Recommended persona: ${directive.recommendedPersona}` : null,
        directive.recommendedCadence ? `Recommended cadence: ${directive.recommendedCadence}` : null
      ].filter((value): value is string => Boolean(value))
    });
  }

  return records.slice(0, 12);
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

  await persistContactScoreSnapshot(draftContext, "APOLLO_PUSH");

  const customFieldValues = buildApolloCustomFieldValues(draftContext);
  const syncResult = await syncApolloContactTypedCustomFields({
    apolloContactId,
    fieldValues: customFieldValues
  });
  if (draftContext.selectedSequenceName?.startsWith("Hunter - ")) {
    const requiredFields = [
      "NEWL Email 1 Subject",
      "NEWL Email 1 Body",
      "NEWL Email 2 Subject",
      "NEWL Email 2 Body",
      "NEWL Email 3 Subject",
      "NEWL Email 3 Body"
    ];
    const missingRequired = requiredFields.filter(
      (field) => !(field in customFieldValues) || syncResult.missingFields.includes(field)
    );
    if (missingRequired.length > 0) {
      throw new Error(
        `Hunter sequence push is blocked until Apollo has every generated email field: ${missingRequired.join(", ")}.`
      );
    }
  }
  return syncResult;
}

async function persistContactScoreSnapshot(
  draftContext: NonNullable<Awaited<ReturnType<typeof loadAiDraftContactContext>>>,
  trigger: LeadScoreTrigger
) {
  return recordLeadScoreSnapshot({
    tenantId: draftContext.contact.tenantId,
    companyId: draftContext.contact.companyId,
    contactId: draftContext.contact.id,
    leadId: draftContext.leadId,
    scoreType: "CONTACT_RELEVANCE",
    score: draftContext.contactScore,
    tier: draftContext.contactTier,
    modelVersion: CONTACT_SCORING_MODEL_VERSION,
    scoringConfig: draftContext.scoringConfig,
    trigger,
    searchProfileId: draftContext.evidence.searchProfile?.id ?? null,
    explanation: draftContext.contactScoreSummary,
    breakdown: {
      total: draftContext.contactScore,
      tier: draftContext.contactTier,
      summary: draftContext.contactScoreSummary,
      companyOpportunityScore: draftContext.leadScore,
      matchedSearchProfileName: draftContext.evidence.searchProfile?.name ?? null
    },
    evidenceAsOf: draftContext.evidence.latestShipmentDate
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

  const emailSteps = draftContext.existingOutreachPlan?.steps?.filter(
    (step) => step.channel === "EMAIL"
  ) ?? [];
  emailSteps.slice(0, 3).forEach((step, index) => {
    const number = index + 1;
    if (step.subject) values[`NEWL Email ${number} Subject`] = step.subject;
    values[`NEWL Email ${number} Body`] = step.body;
  });
  const callStep = draftContext.existingOutreachPlan?.steps?.find(
    (step) => step.channel === "CALL_TASK"
  );
  if (callStep) {
    values["NEWL Hot Opportunity Call Brief"] = callStep.body;
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
