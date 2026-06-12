import {
  ApolloStatus,
  ContactOutreachDraftSource,
  ContactOutreachDraftStatus,
  ContactSource,
  ContactStatus,
  ContactTier,
  PrismaClient,
  ModuleKey,
  PlatformRole,
  ReplyStatus,
  SequenceStatus,
  LeadPipelineStage
} from "@prisma/client";
import { assertValidTradeMiningSearchProfile } from "@/modules/lead-gen/search-profile-validation";
import { recommendSequenceForContact } from "@/modules/lead-gen/sequence-catalog";

const prisma = new PrismaClient();

async function main() {
  const modules = [
    {
      key: ModuleKey.LEAD_GEN,
      name: "Lead Generation",
      description: "Apollo and TradeMining lead generation workflow"
    },
    {
      key: ModuleKey.UPS_TOOLS,
      name: "UPS Tools",
      description: "Future UPS calculators and account tools"
    },
    {
      key: ModuleKey.TRANSIT_LOOKUP,
      name: "Transit Lookup",
      description: "Future transit time lookup module"
    },
    {
      key: ModuleKey.INVOICE_VERIFICATION,
      name: "Invoice Verification",
      description: "Future invoice verification workflow"
    },
    {
      key: ModuleKey.QUICKBOOKS_POSTING,
      name: "QuickBooks Posting",
      description: "Future QuickBooks posting workflow"
    }
  ];

  for (const appModule of modules) {
    await prisma.module.upsert({
      where: { key: appModule.key },
      update: appModule,
      create: appModule
    });
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: "newl-group" },
    update: { name: "Newl Group" },
    create: {
      name: "Newl Group",
      slug: "newl-group"
    }
  });

  const user = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: { name: "Newl Apps Admin" },
    create: {
      email: "admin@example.com",
      name: "Newl Apps Admin"
    }
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id
      }
    },
    update: { role: PlatformRole.ADMIN },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: PlatformRole.ADMIN
    }
  });

  const leadGenModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.LEAD_GEN }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: leadGenModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: leadGenModule.id,
      enabled: true
    }
  });

  const searchProfiles = [
    {
      name: "Houston Import Leads",
      description: "Sample profile for importers shipping into Houston-area demand signals.",
      enabled: true,
      destinationMarkets: ["Houston", "Gulf Coast"],
      destinationPorts: ["Houston, Texas", "Freeport, Texas"],
      originPorts: ["Shanghai", "Ningbo", "Yantian"],
      shipFromPorts: ["Shanghai", "Ningbo-Zhoushan"],
      originCountries: ["China", "Vietnam", "India"],
      productKeywords: ["furniture", "fixtures", "home goods", "building materials"],
      hsCodes: ["9403", "9405", "3926"],
      lookbackWindowDays: 90,
      minShipmentCount: 3,
      minShipmentVolume: 25,
      scheduleFrequency: "daily",
      scheduleTimezone: "America/Toronto",
      scheduleMetadata: {
        preferredRunHourLocal: 7,
        worker: "openclaw-or-n8n-placeholder"
      },
      priorityWeight: 85,
      lastRunStatus: "Not run yet"
    },
    {
      name: "Charlotte Warehouse Leads",
      description: "Sample profile for companies likely to need Southeast warehouse capacity near Charlotte.",
      enabled: true,
      destinationMarkets: ["Charlotte", "North Carolina", "Southeast"],
      destinationPorts: ["Charleston, South Carolina", "Wilmington, North Carolina", "Savannah, Georgia"],
      originPorts: ["Ho Chi Minh City", "Laem Chabang", "Busan"],
      shipFromPorts: ["Ho Chi Minh", "Busan", "Kaohsiung"],
      originCountries: ["Vietnam", "Thailand", "South Korea", "Taiwan"],
      productKeywords: ["consumer goods", "retail fixtures", "apparel", "outdoor"],
      hsCodes: ["6109", "6204", "9506", "9403"],
      lookbackWindowDays: 120,
      minShipmentCount: 2,
      minShipmentVolume: 10,
      scheduleFrequency: "weekly",
      scheduleTimezone: "America/Toronto",
      scheduleMetadata: {
        preferredWeekday: "monday",
        preferredRunHourLocal: 8,
        worker: "openclaw-or-n8n-placeholder"
      },
      priorityWeight: 75,
      lastRunStatus: "Not run yet"
    }
  ];

  for (const profile of searchProfiles) {
    assertValidTradeMiningSearchProfile(profile);

    await prisma.tradeMiningSearchProfile.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: profile.name
        }
      },
      update: {
        description: profile.description,
        enabled: profile.enabled,
        destinationMarkets: profile.destinationMarkets,
        destinationPorts: profile.destinationPorts,
        originPorts: profile.originPorts,
        shipFromPorts: profile.shipFromPorts,
        originCountries: profile.originCountries,
        productKeywords: profile.productKeywords,
        hsCodes: profile.hsCodes,
        lookbackWindowDays: profile.lookbackWindowDays,
        minShipmentCount: profile.minShipmentCount,
        minShipmentVolume: profile.minShipmentVolume,
        scheduleFrequency: profile.scheduleFrequency,
        scheduleTimezone: profile.scheduleTimezone,
        scheduleMetadata: profile.scheduleMetadata,
        priorityWeight: profile.priorityWeight,
        lastRunStatus: profile.lastRunStatus
      },
      create: {
        tenantId: tenant.id,
        name: profile.name,
        description: profile.description,
        enabled: profile.enabled,
        destinationMarkets: profile.destinationMarkets,
        destinationPorts: profile.destinationPorts,
        originPorts: profile.originPorts,
        shipFromPorts: profile.shipFromPorts,
        originCountries: profile.originCountries,
        productKeywords: profile.productKeywords,
        hsCodes: profile.hsCodes,
        lookbackWindowDays: profile.lookbackWindowDays,
        minShipmentCount: profile.minShipmentCount,
        minShipmentVolume: profile.minShipmentVolume,
        scheduleFrequency: profile.scheduleFrequency,
        scheduleTimezone: profile.scheduleTimezone,
        scheduleMetadata: profile.scheduleMetadata,
        priorityWeight: profile.priorityWeight,
        lastRunStatus: profile.lastRunStatus
      }
    });
  }

  const companies = [
    {
      name: "Atlantic Home Imports",
      normalizedName: "atlantic-home-imports",
      domain: "atlantichome.example",
      source: "sample",
      priorityScore: 84,
      leadStage: LeadPipelineStage.NEW
    },
    {
      name: "Carolina Outdoor Supply",
      normalizedName: "carolina-outdoor-supply",
      domain: "carolinaoutdoor.example",
      source: "sample",
      priorityScore: 72,
      leadStage: LeadPipelineStage.RESEARCHING
    },
    {
      name: "Southeast Fixture Co.",
      normalizedName: "southeast-fixture-co",
      domain: "sefixtures.example",
      source: "sample",
      priorityScore: 66,
      leadStage: LeadPipelineStage.QUALIFIED
    }
  ];

  for (const sample of companies) {
    const company = await prisma.company.upsert({
      where: {
        tenantId_normalizedName: {
          tenantId: tenant.id,
          normalizedName: sample.normalizedName
        }
      },
      update: {
        name: sample.name,
        domain: sample.domain,
        source: sample.source,
        priorityScore: sample.priorityScore
      },
      create: {
        tenantId: tenant.id,
        name: sample.name,
        normalizedName: sample.normalizedName,
        domain: sample.domain,
        source: sample.source,
        priorityScore: sample.priorityScore
      }
    });

    const lead = await prisma.lead.upsert({
      where: {
        id: `${tenant.id}-${company.normalizedName}-sample-lead`
      },
      update: {
        stage: sample.leadStage,
        score: sample.priorityScore
      },
      create: {
        id: `${tenant.id}-${company.normalizedName}-sample-lead`,
        tenantId: tenant.id,
        companyId: company.id,
        stage: sample.leadStage,
        score: sample.priorityScore,
        notes: "Sample seed lead for local development only."
      }
    });

    const demoContact =
      sample.normalizedName === "atlantic-home-imports"
        ? {
            id: `${tenant.id}-${company.normalizedName}-jordan-demo-contact`,
            firstName: "Jordan",
            lastName: "Demo",
            fullName: "Jordan Demo",
            title: "Director of Supply Chain",
            department: "Operations",
            seniority: "Director",
            email: "jordan.demo@example.com",
            contactScore: 82,
            contactTier: ContactTier.TIER_1
          }
        : sample.normalizedName === "carolina-outdoor-supply"
          ? {
              id: `${tenant.id}-${company.normalizedName}-taylor-sample-contact`,
              firstName: "Taylor",
              lastName: "Sample",
              fullName: "Taylor Sample",
              title: "Logistics Manager",
              department: "Logistics",
              seniority: "Manager",
              email: "taylor.sample@example.com",
              contactScore: 68,
              contactTier: ContactTier.TIER_2
            }
          : {
              id: `${tenant.id}-${company.normalizedName}-morgan-test-contact`,
              firstName: "Morgan",
              lastName: "Test",
              fullName: "Morgan Test",
              title: "Warehouse Operations Lead",
              department: "Warehouse Operations",
              seniority: "Lead",
              email: "morgan.test@example.com",
              contactScore: 54,
              contactTier: ContactTier.TIER_3
            };

    const sequenceRecommendation = recommendSequenceForContact({
      contactTier: demoContact.contactTier,
      title: demoContact.title,
      department: demoContact.department,
      companyName: company.name
    });

    await prisma.contact.upsert({
      where: {
        tenantId_id: {
          tenantId: tenant.id,
          id: demoContact.id
        }
      },
      update: {
        companyId: company.id,
        firstName: demoContact.firstName,
        lastName: demoContact.lastName,
        fullName: demoContact.fullName,
        title: demoContact.title,
        department: demoContact.department,
        seniority: demoContact.seniority,
        email: demoContact.email,
        source: ContactSource.MANUAL,
        contactStatus: ContactStatus.REVIEWING,
        contactScore: demoContact.contactScore,
        contactTier: demoContact.contactTier,
        recommendedSequenceId: sequenceRecommendation.id,
        recommendedSequenceName: sequenceRecommendation.name,
        selectedSequenceId: sequenceRecommendation.id,
        selectedSequenceName: sequenceRecommendation.name,
        sequenceRecommendationReason: sequenceRecommendation.reason,
        sequenceManuallyOverridden: false,
        apolloStatus: ApolloStatus.NOT_STARTED,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        assignedRep: null,
        rawJson: {
          demo: true,
          note: "Local development sample contact. Not real customer data."
        }
      },
      create: {
        id: demoContact.id,
        tenantId: tenant.id,
        companyId: company.id,
        firstName: demoContact.firstName,
        lastName: demoContact.lastName,
        fullName: demoContact.fullName,
        title: demoContact.title,
        department: demoContact.department,
        seniority: demoContact.seniority,
        email: demoContact.email,
        source: ContactSource.MANUAL,
        contactStatus: ContactStatus.REVIEWING,
        contactScore: demoContact.contactScore,
        contactTier: demoContact.contactTier,
        recommendedSequenceId: sequenceRecommendation.id,
        recommendedSequenceName: sequenceRecommendation.name,
        selectedSequenceId: sequenceRecommendation.id,
        selectedSequenceName: sequenceRecommendation.name,
        sequenceRecommendationReason: sequenceRecommendation.reason,
        apolloStatus: ApolloStatus.NOT_STARTED,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        rawJson: {
          demo: true,
          note: "Local development sample contact. Not real customer data."
        }
      }
    });

    if (demoContact.contactTier === ContactTier.TIER_1) {
      await prisma.contactOutreachDraft.upsert({
        where: {
          tenantId_contactId_sequenceName: {
            tenantId: tenant.id,
            contactId: demoContact.id,
            sequenceName: sequenceRecommendation.name
          }
        },
        update: {
          companyId: company.id,
          leadId: lead.id,
          sequenceId: sequenceRecommendation.id,
          subject: `Import support for ${company.name}`,
          body: `Hi ${demoContact.firstName},\n\nNoticed ${company.name} has demo import activity tied to the local Newl Apps sample workflow. Newl Group may be able to help with warehousing, drayage, and distribution support.\n\nWorth a quick conversation?\n\nNewl Apps demo note: this is mock local content only and was not generated by live AI.`,
          status: ContactOutreachDraftStatus.AVAILABLE,
          source: ContactOutreachDraftSource.MOCK_AI,
          aiGenerated: true,
          personalizationNotes:
            "Mock Tier 1 draft for local development only. Uses fake example.com contact data and demo import-fit wording.",
          rawInputs: {
            demo: true,
            contactTier: demoContact.contactTier,
            sequenceId: sequenceRecommendation.id
          },
          rawJson: {
            demo: true,
            note: "No OpenAI, Apollo, email, or sequence call was made."
          }
        },
        create: {
          tenantId: tenant.id,
          contactId: demoContact.id,
          companyId: company.id,
          leadId: lead.id,
          sequenceName: sequenceRecommendation.name,
          sequenceId: sequenceRecommendation.id,
          subject: `Import support for ${company.name}`,
          body: `Hi ${demoContact.firstName},\n\nNoticed ${company.name} has demo import activity tied to the local Newl Apps sample workflow. Newl Group may be able to help with warehousing, drayage, and distribution support.\n\nWorth a quick conversation?\n\nNewl Apps demo note: this is mock local content only and was not generated by live AI.`,
          status: ContactOutreachDraftStatus.AVAILABLE,
          source: ContactOutreachDraftSource.MOCK_AI,
          aiGenerated: true,
          personalizationNotes:
            "Mock Tier 1 draft for local development only. Uses fake example.com contact data and demo import-fit wording.",
          rawInputs: {
            demo: true,
            contactTier: demoContact.contactTier,
            sequenceId: sequenceRecommendation.id
          },
          rawJson: {
            demo: true,
            note: "No OpenAI, Apollo, email, or sequence call was made."
          }
        }
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      action: "seed.completed",
      entityType: "Tenant",
      entityId: tenant.id,
      after: {
        message: "Seeded tenant foundation, TradeMining search profiles, and sample lead-gen data."
      }
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
