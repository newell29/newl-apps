import {
  AssistantMemoryKind,
  AssistantSourceKind,
  LeadPipelineStage
} from "@prisma/client";

import type { AssistantKnowledgeAdapterResult } from "@/modules/assistant/knowledge-registry";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

const CLOSED_LEAD_STAGES: LeadPipelineStage[] = [
  LeadPipelineStage.WON,
  LeadPipelineStage.LOST,
  LeadPipelineStage.DISQUALIFIED
];

export async function getLeadGenAssistantKnowledge(tenant: TenantContext): Promise<AssistantKnowledgeAdapterResult> {
  const [companies, contacts, leads, tradeMiningRecords] = await Promise.all([
    prisma.company.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        normalizedName: true,
        domain: true,
        linkedinUrl: true,
        primaryIndustry: true,
        secondaryIndustry: true,
        priorityScore: true,
        candidateStatus: true,
        candidateStatusReason: true,
        doNotProspect: true,
        updatedAt: true,
        _count: {
          select: {
            contacts: true,
            leads: true,
            importRecords: true
          }
        }
      }
    }),
    prisma.contact.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ contactScore: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        fullName: true,
        title: true,
        department: true,
        seniority: true,
        email: true,
        phone: true,
        source: true,
        contactStatus: true,
        contactScore: true,
        contactTier: true,
        sequenceStatus: true,
        replyStatus: true,
        assignedRep: true,
        lastTouchAt: true,
        lastReplyAt: true,
        updatedAt: true,
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.lead.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        stage: true,
        score: true,
        notes: true,
        updatedAt: true,
        company: {
          select: {
            id: true,
            name: true,
            priorityScore: true
          }
        },
        contact: {
          select: {
            id: true,
            fullName: true,
            title: true,
            email: true
          }
        }
      }
    }),
    prisma.tradeMiningImportRecord.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ arrivalDate: "desc" }, { updatedAt: "desc" }],
      take: 300,
      select: {
        id: true,
        rawRecordKey: true,
        sourcePort: true,
        arrivalDate: true,
        importerName: true,
        consigneeName: true,
        shipperName: true,
        destinationCity: true,
        destinationState: true,
        originCountry: true,
        productDescription: true,
        updatedAt: true,
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
  ]);

  return {
    documents: [
      ...companies.map((company) => ({
        sourceKind: AssistantSourceKind.COMPANY,
        sourceSystem: "NEWL_COMPANY",
        externalId: company.id,
        title: company.name,
        sourceUpdatedAt: company.updatedAt,
        metadata: {
          priorityScore: company.priorityScore,
          candidateStatus: company.candidateStatus,
          primaryIndustry: company.primaryIndustry,
          domain: company.domain
        },
        content: joinKnowledgeParts([
          `${company.name} is a tenant company record in Newl Apps.`,
          company.normalizedName ? `Normalized company name: ${company.normalizedName}.` : null,
          company.domain ? `Website domain: ${company.domain}.` : null,
          company.linkedinUrl ? `LinkedIn URL: ${company.linkedinUrl}.` : null,
          company.primaryIndustry ? `Primary industry: ${company.primaryIndustry}.` : null,
          company.secondaryIndustry ? `Secondary industry: ${company.secondaryIndustry}.` : null,
          `Priority score: ${company.priorityScore}.`,
          `Candidate status: ${company.candidateStatus}.`,
          company.candidateStatusReason ? `Candidate status reason: ${company.candidateStatusReason}.` : null,
          company.doNotProspect ? "This company is marked do not prospect." : null,
          `Known counts: ${company._count.contacts} contacts, ${company._count.leads} leads, ${company._count.importRecords} TradeMining records.`
        ])
      })),
      ...contacts.map((contact) => ({
        sourceKind: AssistantSourceKind.CONTACT,
        sourceSystem: "NEWL_CONTACT",
        externalId: contact.id,
        title: `${contact.fullName} - ${contact.company.name}`,
        sourceUpdatedAt: contact.updatedAt,
        metadata: {
          companyId: contact.company.id,
          companyName: contact.company.name,
          contactScore: contact.contactScore,
          contactStatus: contact.contactStatus,
          email: contact.email
        },
        content: joinKnowledgeParts([
          `${contact.fullName} is a contact at ${contact.company.name}.`,
          contact.title ? `Title: ${contact.title}.` : null,
          contact.department ? `Department: ${contact.department}.` : null,
          contact.seniority ? `Seniority: ${contact.seniority}.` : null,
          contact.email ? `Email: ${contact.email}.` : null,
          contact.phone ? `Phone: ${contact.phone}.` : null,
          `Contact status: ${contact.contactStatus}.`,
          `Contact score: ${contact.contactScore}.`,
          `Contact tier: ${contact.contactTier}.`,
          `Sequence status: ${contact.sequenceStatus}.`,
          `Reply status: ${contact.replyStatus}.`,
          contact.assignedRep ? `Assigned rep: ${contact.assignedRep}.` : null,
          contact.lastTouchAt ? `Last touch at: ${contact.lastTouchAt.toISOString()}.` : null,
          contact.lastReplyAt ? `Last reply at: ${contact.lastReplyAt.toISOString()}.` : null,
          `Source: ${contact.source}.`
        ])
      })),
      ...leads.map((lead) => ({
        sourceKind: AssistantSourceKind.LEAD,
        sourceSystem: "NEWL_LEAD",
        externalId: lead.id,
        title: `${lead.company.name} lead`,
        sourceUpdatedAt: lead.updatedAt,
        metadata: {
          companyId: lead.company.id,
          stage: lead.stage,
          score: lead.score,
          contactId: lead.contact?.id ?? null
        },
        content: joinKnowledgeParts([
          `Lead record for ${lead.company.name}.`,
          `Stage: ${lead.stage}.`,
          `Lead score: ${lead.score}.`,
          `Company priority score: ${lead.company.priorityScore}.`,
          lead.contact ? `Primary contact: ${lead.contact.fullName}${lead.contact.title ? `, ${lead.contact.title}` : ""}.` : null,
          lead.contact?.email ? `Contact email: ${lead.contact.email}.` : null,
          lead.notes ? `Notes: ${lead.notes}.` : null,
          CLOSED_LEAD_STAGES.includes(lead.stage) ? "This lead is closed." : "This lead is open."
        ])
      })),
      ...tradeMiningRecords.map((record) => {
        const companyName = record.company?.name ?? record.importerName ?? record.consigneeName ?? "TradeMining record";

        return {
          sourceKind: AssistantSourceKind.TRADEMINING_RECORD,
          sourceSystem: "NEWL_TRADEMINING_RECORD",
          externalId: record.id,
          title: `${companyName} import activity`,
          sourceUpdatedAt: record.updatedAt,
          metadata: {
            companyId: record.company?.id ?? null,
            companyName: record.company?.name ?? null,
            rawRecordKey: record.rawRecordKey,
            arrivalDate: record.arrivalDate?.toISOString() ?? null
          },
          content: joinKnowledgeParts([
            `TradeMining import record associated with ${companyName}.`,
            record.company?.name ? `Linked company: ${record.company.name}.` : null,
            record.importerName ? `Importer: ${record.importerName}.` : null,
            record.consigneeName ? `Consignee: ${record.consigneeName}.` : null,
            record.shipperName ? `Shipper: ${record.shipperName}.` : null,
            record.sourcePort ? `Source port: ${record.sourcePort}.` : null,
            record.originCountry ? `Origin country: ${record.originCountry}.` : null,
            record.destinationCity || record.destinationState
              ? `Destination: ${[record.destinationCity, record.destinationState].filter(Boolean).join(", ")}.`
              : null,
            record.arrivalDate ? `Arrival date: ${record.arrivalDate.toISOString()}.` : null,
            record.productDescription ? `Product description: ${record.productDescription}.` : null,
            `Raw record key: ${record.rawRecordKey}.`
          ])
        };
      })
    ],
    memories: [
      ...companies.map((company) => ({
        kind: AssistantMemoryKind.CUSTOMER_PROFILE,
        subjectType: "Company",
        subjectId: company.id,
        title: company.name,
        summary: joinKnowledgeParts([
          company.primaryIndustry ? `Industry ${company.primaryIndustry}` : null,
          `priority ${company.priorityScore}`,
          `status ${company.candidateStatus}`,
          company.domain ? `domain ${company.domain}` : null
        ]),
        confidence: 70,
        sourceRef: {
          sourceSystem: "NEWL_COMPANY",
          externalId: company.id
        },
        lastObservedAt: company.updatedAt
      })),
      ...leads
        .filter((lead) => !CLOSED_LEAD_STAGES.includes(lead.stage) && lead.score >= 60)
        .map((lead) => ({
          kind: AssistantMemoryKind.SALES_OPPORTUNITY,
          subjectType: "Lead",
          subjectId: lead.id,
          title: `${lead.company.name} lead`,
          summary: `Lead stage ${lead.stage} with score ${lead.score}.`,
          confidence: Math.min(95, Math.max(55, lead.score)),
          sourceRef: {
            sourceSystem: "NEWL_LEAD",
            externalId: lead.id
          },
          lastObservedAt: lead.updatedAt
        }))
    ]
  };
}

function joinKnowledgeParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
