import { PrismaClient, ModuleKey, PlatformRole, LeadPipelineStage } from "@prisma/client";

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

    await prisma.lead.upsert({
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
  }

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      action: "seed.completed",
      entityType: "Tenant",
      entityId: tenant.id,
      after: {
        message: "Seeded tenant foundation and sample lead-gen data."
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
