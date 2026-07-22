import { scoreContact } from "@/modules/lead-gen/contact-scoring";
import {
  buildTradeMiningEvidenceWhere,
  loadSearchProfileSummaries,
  loadTradeMiningScoringConfig,
  resolveEvidenceLookbackDays,
  summarizeTradeMiningEvidence
} from "@/modules/lead-gen/queries";
import {
  CONTACT_SCORING_MODEL_VERSION,
  recordLeadScoreSnapshot,
  type LeadScoreTrigger
} from "@/modules/lead-gen/score-history";
import { prisma } from "@/server/db";

export async function recordCurrentContactScoreSnapshot({
  tenantId,
  contactId,
  trigger
}: {
  tenantId: string;
  contactId: string;
  trigger: LeadScoreTrigger;
}) {
  const [scoringConfig, searchProfiles] = await Promise.all([
    loadTradeMiningScoringConfig({ tenantId }),
    loadSearchProfileSummaries({ tenantId })
  ]);
  const evidenceWhere = buildTradeMiningEvidenceWhere(
    { tenantId },
    resolveEvidenceLookbackDays(scoringConfig, searchProfiles)
  );
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId
    },
    include: {
      leads: {
        where: { tenantId },
        select: { id: true },
        take: 1
      },
      company: {
        select: {
          id: true,
          priorityScore: true,
          importRecords: {
            where: evidenceWhere,
            orderBy: [{ arrivalDate: "desc" }, { createdAt: "desc" }],
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
            where: { tenantId },
            orderBy: { updatedAt: "desc" },
            select: { id: true, score: true },
            take: 1
          }
        }
      }
    }
  });

  if (!contact) {
    return null;
  }

  const lead = contact.company.leads[0] ?? null;
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
      companyLeadScore: lead?.score ?? null,
      isPrimaryContact: contact.leads.length > 0
    },
    scoringConfig
  );
  const evidence = summarizeTradeMiningEvidence(contact.company.importRecords, searchProfiles);

  return recordLeadScoreSnapshot({
    tenantId,
    companyId: contact.companyId,
    contactId: contact.id,
    leadId: lead?.id ?? contact.leads[0]?.id ?? null,
    scoreType: "CONTACT_RELEVANCE",
    score: scoring.score,
    tier: scoring.tier,
    modelVersion: CONTACT_SCORING_MODEL_VERSION,
    scoringConfig,
    trigger,
    searchProfileId: evidence.searchProfile?.id ?? null,
    explanation: scoring.summary,
    breakdown: {
      total: scoring.score,
      tier: scoring.tier,
      summary: scoring.summary,
      companyOpportunityScore: lead?.score ?? null,
      matchedSearchProfileName: evidence.searchProfile?.name ?? null
    },
    evidenceAsOf: evidence.latestShipmentDate
  });
}
