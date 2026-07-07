import {
  ApolloStatus,
  CashflowAlertType,
  CashflowBillingTrigger,
  CashflowCustomerTier,
  CashflowFileStatus,
  CashflowFollowUpStatus,
  CashflowInvoiceStatus,
  CashflowPriority,
  CashflowVendorBillStatus,
  CandidateStatus,
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
import {
  assertValidTradeMiningSearchProfile,
  defaultTradeMiningCompanyIdentityRoles
} from "@/modules/lead-gen/search-profile-validation";
import { recommendSequenceForContact } from "@/modules/lead-gen/sequence-catalog";
import { seedLtlTenantDefaults } from "@/modules/ltl-rate-portal/queries";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";
import { seedUpsTenantDefaults } from "@/modules/ups-tools/queries";
import { hashPassword } from "@/server/auth/password";

const prisma = new PrismaClient();

type TradeMiningScoringSeedClient = PrismaClient & {
  tradeMiningScoringConfig?: {
    upsert(args: {
      where: { tenantId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

// Local-dev password for seeded users. Sourced from SEED_ADMIN_PASSWORD; falls
// back to a non-secret default so `npm run prisma:seed` always works locally.
// This is ONLY used by the dev-only credentials login path. Never commit or use
// a real password here.
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "newl-dev-password";

function normalizeCashflowSourceName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(usd|cad|cdn)\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function seedCashflowDemoData(tenantId: string, adminUserId: string) {
  await prisma.cashflowSettings.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId }
  });

  const customers = [
    {
      id: `${tenantId}-cashflow-detroit-axle`,
      canonicalCompanyName: "Detroit Axle",
      normalizedCompanyName: "detroit-axle",
      businessLine: "OCEAN" as const,
      customerName: "Detroit Axle",
      accountingNameVariants: ["Detroit Axle", "Detroit Axle LLC", "Detroit Axle Warehouse"],
      aliases: ["Detroit Axle", "Detroit Axle LLC", "Detroit Axle - USD"],
      customerTermsDays: 45,
      creditLimit: 750000,
      customerTier: CashflowCustomerTier.B,
      alertThresholdPercent: 80,
      billingTrigger: CashflowBillingTrigger.DELIVERY,
      vendorPaymentTrigger: CashflowBillingTrigger.PORT_ARRIVAL,
      requiresApprovalOverLimit: true,
      assignedSalesRep: "Alex Newell",
      assignedCollectionsOwner: "Finance Desk",
      notes: "High-volume account: profitable but consumes working capital because freight is paid at port arrival while customer billing waits for delivery."
    },
    {
      id: `${tenantId}-cashflow-atlantic-home`,
      canonicalCompanyName: "Atlantic Home Imports",
      normalizedCompanyName: "atlantic-home-imports",
      businessLine: "TRUCKING" as const,
      customerName: "Atlantic Home Imports",
      accountingNameVariants: ["Atlantic Home Imports"],
      aliases: ["Atlantic Home Imports", "Atlantic Home Imports USD"],
      customerTermsDays: 30,
      creditLimit: 250000,
      customerTier: CashflowCustomerTier.A,
      alertThresholdPercent: 80,
      billingTrigger: CashflowBillingTrigger.DELIVERY,
      vendorPaymentTrigger: CashflowBillingTrigger.DELIVERY,
      requiresApprovalOverLimit: false,
      assignedSalesRep: "Sales Desk",
      assignedCollectionsOwner: "Finance Desk",
      notes: "Healthy payment pattern in local sample data."
    },
    {
      id: `${tenantId}-cashflow-mapping-review`,
      canonicalCompanyName: "Unmatched Customer Review",
      normalizedCompanyName: "unmatched-customer-review",
      businessLine: "AIR" as const,
      customerName: "Unmatched Customer Review",
      accountingNameVariants: ["UNKNOWN CUSTOMER", "MISMATCHED QB NAME"],
      aliases: ["UNKNOWN CUSTOMER", "MISMATCHED QB NAME"],
      customerTermsDays: 30,
      creditLimit: 100000,
      customerTier: CashflowCustomerTier.REVIEW,
      alertThresholdPercent: 80,
      billingTrigger: CashflowBillingTrigger.MANUAL,
      vendorPaymentTrigger: CashflowBillingTrigger.PORT_ARRIVAL,
      requiresApprovalOverLimit: true,
      assignedSalesRep: null,
      assignedCollectionsOwner: "Finance Desk",
      notes: "Sample data-cleanup bucket for unmatched accounting names or file numbers."
    }
  ];

  for (const customer of customers) {
    const company = await prisma.company.upsert({
      where: {
        tenantId_normalizedName: {
          tenantId,
          normalizedName: customer.normalizedCompanyName
        }
      },
      update: {
        name: customer.canonicalCompanyName,
        source: "CASHFLOW_SEED"
      },
      create: {
        tenantId,
        name: customer.canonicalCompanyName,
        normalizedName: customer.normalizedCompanyName,
        source: "CASHFLOW_SEED",
        candidateStatus: CandidateStatus.NEW
      }
    });
    const cashflowCustomer = {
      id: customer.id,
      businessLine: customer.businessLine,
      customerName: customer.customerName,
      accountingNameVariants: customer.accountingNameVariants,
      customerTermsDays: customer.customerTermsDays,
      creditLimit: customer.creditLimit,
      customerTier: customer.customerTier,
      alertThresholdPercent: customer.alertThresholdPercent,
      billingTrigger: customer.billingTrigger,
      vendorPaymentTrigger: customer.vendorPaymentTrigger,
      requiresApprovalOverLimit: customer.requiresApprovalOverLimit,
      assignedSalesRep: customer.assignedSalesRep,
      assignedCollectionsOwner: customer.assignedCollectionsOwner,
      notes: customer.notes
    };

    await prisma.cashflowCustomer.upsert({
      where: {
        tenantId_id: {
          tenantId,
          id: customer.id
        }
      },
      update: {
        ...cashflowCustomer,
        companyId: company.id
      },
      create: {
        ...cashflowCustomer,
        tenantId,
        companyId: company.id
      }
    });

    for (const alias of customer.aliases) {
      await prisma.cashflowCustomerAlias.upsert({
        where: {
          tenantId_sourceSystem_legalEntity_normalizedSourceName_sourceCurrency: {
            tenantId,
            sourceSystem: "QUICKBOOKS",
            legalEntity: "NEWL_WORLDWIDE",
            normalizedSourceName: normalizeCashflowSourceName(alias),
            sourceCurrency: alias.toUpperCase().includes("USD") ? "USD" : "CAD"
          }
        },
        update: {
          customerId: customer.id,
          companyId: company.id,
          sourceCustomerName: alias,
          sourceLabel: alias
        },
        create: {
          tenantId,
          customerId: customer.id,
          companyId: company.id,
          legalEntity: "NEWL_WORLDWIDE",
          sourceSystem: "QUICKBOOKS",
          sourceCustomerName: alias,
          normalizedSourceName: normalizeCashflowSourceName(alias),
          sourceCurrency: alias.toUpperCase().includes("USD") ? "USD" : "CAD",
          sourceLabel: alias
        }
      });
    }
  }

  const files = [
    {
      id: `${tenantId}-cashflow-file-da-1001`,
      customerId: `${tenantId}-cashflow-detroit-axle`,
      businessLine: "OCEAN" as const,
      fileNumber: "DA-1001",
      shipmentType: "OI",
      fileStatus: CashflowFileStatus.VENDOR_PAID_CUSTOMER_NOT_COLLECTED,
      operationalStatus: "Delivered",
      portArrivalDate: new Date("2026-05-03"),
      deliveryDate: new Date("2026-05-11"),
      customerInvoiceDate: new Date("2026-05-12"),
      customerPaymentDate: null,
      vendorInvoiceDate: new Date("2026-05-04"),
      vendorPaymentDate: new Date("2026-05-05"),
      estimatedRevenue: 62000,
      actualRevenue: 64000,
      vendorCost: 50500,
      grossProfit: 13500,
      grossMarginPercent: 21.09,
      cashGapDays: null,
      exposureAmount: 64000,
      assignedOwner: "Finance Desk",
      notes: "Vendor paid at port; customer invoice is open under 45-day terms."
    },
    {
      id: `${tenantId}-cashflow-file-da-1002`,
      customerId: `${tenantId}-cashflow-detroit-axle`,
      businessLine: "OCEAN" as const,
      fileNumber: "DA-1002",
      shipmentType: "OI",
      fileStatus: CashflowFileStatus.VENDOR_COST_RECEIVED_NOT_CUSTOMER_BILLED,
      operationalStatus: "At port",
      portArrivalDate: new Date("2026-06-17"),
      deliveryDate: null,
      customerInvoiceDate: null,
      customerPaymentDate: null,
      vendorInvoiceDate: new Date("2026-06-18"),
      vendorPaymentDate: new Date("2026-06-19"),
      estimatedRevenue: 78000,
      actualRevenue: 0,
      vendorCost: 61000,
      grossProfit: 0,
      grossMarginPercent: 0,
      cashGapDays: null,
      exposureAmount: 78000,
      assignedOwner: "Operations Desk",
      notes: "Cost received and paid before delivery billing trigger."
    },
    {
      id: `${tenantId}-cashflow-file-ahi-2001`,
      customerId: `${tenantId}-cashflow-atlantic-home`,
      businessLine: "TRUCKING" as const,
      fileNumber: "AHI-2001",
      shipmentType: "TR",
      fileStatus: CashflowFileStatus.FILE_CLOSED,
      operationalStatus: "Closed",
      portArrivalDate: new Date("2026-04-01"),
      deliveryDate: new Date("2026-04-03"),
      customerInvoiceDate: new Date("2026-04-04"),
      customerPaymentDate: new Date("2026-04-29"),
      vendorInvoiceDate: new Date("2026-04-03"),
      vendorPaymentDate: new Date("2026-04-15"),
      estimatedRevenue: 12500,
      actualRevenue: 12500,
      vendorCost: 9700,
      grossProfit: 2800,
      grossMarginPercent: 22.4,
      cashGapDays: 14,
      exposureAmount: 0,
      assignedOwner: "Finance Desk",
      notes: "Closed sample file."
    },
    {
      id: `${tenantId}-cashflow-file-review-3001`,
      customerId: `${tenantId}-cashflow-mapping-review`,
      businessLine: "AIR" as const,
      fileNumber: "PENDING-MAP-3001",
      shipmentType: "AI",
      fileStatus: CashflowFileStatus.NEEDS_ACCOUNTING_REVIEW,
      operationalStatus: "Mapping review",
      portArrivalDate: new Date("2026-06-10"),
      deliveryDate: new Date("2026-06-12"),
      customerInvoiceDate: null,
      customerPaymentDate: null,
      vendorInvoiceDate: new Date("2026-06-11"),
      vendorPaymentDate: null,
      estimatedRevenue: 14000,
      actualRevenue: 0,
      vendorCost: 11200,
      grossProfit: 0,
      grossMarginPercent: 0,
      cashGapDays: null,
      exposureAmount: 14000,
      billingBlockReason: "Customer name/file number mismatch from accounting import.",
      assignedOwner: "Finance Desk",
      notes: "Intentional sample mapping exception."
    }
  ];

  for (const file of files) {
    await prisma.cashflowFile.upsert({
      where: {
        tenantId_id: {
          tenantId,
          id: file.id
        }
      },
      update: file,
      create: {
        ...file,
        tenantId
      }
    });
  }

  const invoices = [
    {
      id: `${tenantId}-cashflow-invoice-da-9001`,
      customerId: `${tenantId}-cashflow-detroit-axle`,
      fileId: `${tenantId}-cashflow-file-da-1001`,
      invoiceNumber: "INV-DA-9001",
      invoiceDate: new Date("2026-05-12"),
      dueDate: new Date("2026-06-26"),
      invoiceAmount: 64000,
      amountPaid: 0,
      amountOpen: 64000,
      paymentDate: null,
      daysToCollect: null,
      daysPastDue: 0,
      invoiceStatus: CashflowInvoiceStatus.OPEN
    },
    {
      id: `${tenantId}-cashflow-invoice-da-9002`,
      customerId: `${tenantId}-cashflow-detroit-axle`,
      fileId: null,
      invoiceNumber: "INV-DA-9002",
      invoiceDate: new Date("2026-04-15"),
      dueDate: new Date("2026-05-30"),
      invoiceAmount: 115000,
      amountPaid: 25000,
      amountOpen: 90000,
      paymentDate: null,
      daysToCollect: null,
      daysPastDue: 19,
      invoiceStatus: CashflowInvoiceStatus.OVERDUE
    },
    {
      id: `${tenantId}-cashflow-invoice-ahi-8001`,
      customerId: `${tenantId}-cashflow-atlantic-home`,
      fileId: `${tenantId}-cashflow-file-ahi-2001`,
      invoiceNumber: "INV-AHI-8001",
      invoiceDate: new Date("2026-04-04"),
      dueDate: new Date("2026-05-04"),
      invoiceAmount: 12500,
      amountPaid: 12500,
      amountOpen: 0,
      paymentDate: new Date("2026-04-29"),
      daysToCollect: 25,
      daysPastDue: 0,
      invoiceStatus: CashflowInvoiceStatus.PAID
    }
  ];

  for (const invoice of invoices) {
    await prisma.cashflowCustomerInvoice.upsert({
      where: {
        tenantId_id: {
          tenantId,
          id: invoice.id
        }
      },
      update: invoice,
      create: {
        ...invoice,
        tenantId
      }
    });
  }

  const vendorBills = [
    {
      id: `${tenantId}-cashflow-vendor-da-5001`,
      vendorName: "Port Dray Carrier",
      customerId: `${tenantId}-cashflow-detroit-axle`,
      fileId: `${tenantId}-cashflow-file-da-1002`,
      fileNumber: "DA-1002",
      billDate: new Date("2026-06-18"),
      dueDate: new Date("2026-06-19"),
      billAmount: 61000,
      amountPaid: 61000,
      paymentDate: new Date("2026-06-19"),
      vendorBillStatus: CashflowVendorBillStatus.PAID
    },
    {
      id: `${tenantId}-cashflow-vendor-review-5002`,
      vendorName: "Air Freight Vendor",
      customerId: `${tenantId}-cashflow-mapping-review`,
      fileId: `${tenantId}-cashflow-file-review-3001`,
      fileNumber: "PENDING-MAP-3001",
      billDate: new Date("2026-06-11"),
      dueDate: new Date("2026-06-20"),
      billAmount: 11200,
      amountPaid: 0,
      paymentDate: null,
      vendorBillStatus: CashflowVendorBillStatus.RECEIVED
    }
  ];

  for (const bill of vendorBills) {
    await prisma.cashflowVendorBill.upsert({
      where: {
        tenantId_id: {
          tenantId,
          id: bill.id
        }
      },
      update: bill,
      create: {
        ...bill,
        tenantId
      }
    });
  }

  await prisma.cashflowAlert.upsert({
    where: {
      tenantId_id: {
        tenantId,
        id: `${tenantId}-cashflow-alert-da-cost-not-billed`
      }
    },
    update: {
      status: "OPEN"
    },
    create: {
      id: `${tenantId}-cashflow-alert-da-cost-not-billed`,
      tenantId,
      customerId: `${tenantId}-cashflow-detroit-axle`,
      fileId: `${tenantId}-cashflow-file-da-1002`,
      alertType: CashflowAlertType.VENDOR_COST_NOT_BILLED,
      priority: CashflowPriority.CRITICAL,
      title: "Vendor cost paid before customer invoice",
      message: "Detroit Axle file DA-1002 has vendor cost paid at port arrival and no customer invoice yet.",
      status: "OPEN"
    }
  });

  await prisma.cashflowFollowUp.upsert({
    where: {
      tenantId_id: {
        tenantId,
        id: `${tenantId}-cashflow-followup-da-9002`
      }
    },
    update: {
      note: "Sample follow-up: accounting should confirm payment timing and flag active shipment exposure."
    },
    create: {
      id: `${tenantId}-cashflow-followup-da-9002`,
      tenantId,
      customerId: `${tenantId}-cashflow-detroit-axle`,
      invoiceId: `${tenantId}-cashflow-invoice-da-9002`,
      status: CashflowFollowUpStatus.CONTACTED,
      note: "Sample follow-up: accounting should confirm payment timing and flag active shipment exposure.",
      nextFollowUpDate: new Date("2026-06-29"),
      createdByUserId: adminUserId
    }
  });
}

async function main() {
  const modules = [
    {
      key: ModuleKey.ASSISTANT,
      name: "Company Assistant",
      description: "Tenant-scoped AI assistant, knowledge memory, and business insight workspace"
    },
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
      key: ModuleKey.LTL_RATE_PORTAL,
      name: "LTL Rate Portal",
      description: "Bulk LTL rate quoting and RFQ comparison workflows"
    },
    {
      key: ModuleKey.TRANSIT_LOOKUP,
      name: "Transit Lookup",
      description: "Future transit time lookup module"
    },
    {
      key: ModuleKey.SHIPMENT_DOCUMENTS,
      name: "Garland Tools",
      description: "Garland Canada document packaging, BOL consolidation, and shipment packet workflows"
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
    },
    {
      key: ModuleKey.CUSTOMER_CASHFLOW,
      name: "Customer Cashflow",
      description: "Customer cashflow, credit exposure, AR, and file billing work queues"
    },
    {
      key: ModuleKey.WEBSITE_INBOUND,
      name: "Website Inbound",
      description: "Website form submissions, playbook downloads, and inbound lead review"
    },
    {
      key: ModuleKey.OCEAN_FREIGHT_PRICING,
      name: "Ocean Freight Pricing",
      description: "Manual ocean freight rate management, agent directory, and pricing review workspace"
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

  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      "[seed] SEED_ADMIN_PASSWORD not set; using default local-dev password 'newl-dev-password'. Set SEED_ADMIN_PASSWORD for a custom local password. Never use a real secret here."
    );
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);

  // Admin plus optional sample users in the same tenant, used to exercise the
  // role matrix locally (e.g. READ_ONLY should be blocked from mutations).
  const seedUsers = [
    { email: "admin@example.com", name: "Newl Apps Admin", role: PlatformRole.ADMIN },
    { email: "sales@example.com", name: "Newl Apps Sales", role: PlatformRole.SALES },
    { email: "readonly@example.com", name: "Newl Apps Read Only", role: PlatformRole.READ_ONLY }
  ];

  for (const seedUser of seedUsers) {
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: { name: seedUser.name, passwordHash },
      create: {
        email: seedUser.email,
        name: seedUser.name,
        passwordHash
      }
    });

    await prisma.membership.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id
        }
      },
      update: { role: seedUser.role },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: seedUser.role
      }
    });
  }

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@example.com" }
  });

  const leadGenModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.LEAD_GEN }
  });

  const assistantModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.ASSISTANT }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: assistantModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: assistantModule.id,
      enabled: true
    }
  });

  const customerCashflowModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.CUSTOMER_CASHFLOW }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: customerCashflowModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: customerCashflowModule.id,
      enabled: true
    }
  });

  const websiteInboundModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.WEBSITE_INBOUND }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: websiteInboundModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: websiteInboundModule.id,
      enabled: true
    }
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

  const upsModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.UPS_TOOLS }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: upsModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: upsModule.id,
      enabled: true
    }
  });

  const oceanFreightPricingModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.OCEAN_FREIGHT_PRICING }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: oceanFreightPricingModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: oceanFreightPricingModule.id,
      enabled: true
    }
  });

  const transitLookupModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.TRANSIT_LOOKUP }
  });

  const ltlRatePortalModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.LTL_RATE_PORTAL }
  });

  const shipmentDocumentsModule = await prisma.module.findUniqueOrThrow({
    where: { key: ModuleKey.SHIPMENT_DOCUMENTS }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: ltlRatePortalModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: ltlRatePortalModule.id,
      enabled: true
    }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: transitLookupModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: transitLookupModule.id,
      enabled: true
    }
  });

  await prisma.tenantModuleAccess.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: shipmentDocumentsModule.id
      }
    },
    update: { enabled: true },
    create: {
      tenantId: tenant.id,
      moduleId: shipmentDocumentsModule.id,
      enabled: true
    }
  });

  await seedUpsTenantDefaults(tenant.id);
  await seedLtlTenantDefaults(tenant.id);
  await seedCashflowDemoData(tenant.id, adminUser.id);
  const tradeMiningScoringClient = prisma as TradeMiningScoringSeedClient;

  if (tradeMiningScoringClient.tradeMiningScoringConfig) {
    await tradeMiningScoringClient.tradeMiningScoringConfig.upsert({
      where: {
        tenantId: tenant.id
      },
      update: {},
      create: {
        tenantId: tenant.id,
        recentWindowDays: DEFAULT_TRADEMINING_SCORING_SETTINGS.recentWindowDays,
        comparisonWindowDays: DEFAULT_TRADEMINING_SCORING_SETTINGS.comparisonWindowDays,
        lookbackWindowDays: DEFAULT_TRADEMINING_SCORING_SETTINGS.lookbackWindowDays,
        momentumWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.momentumWeight,
        marketFitWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.marketFitWeight,
        industryFitWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.industryFitWeight,
        companySizeWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.companySizeWeight,
        roleWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.roleWeight,
        confidenceWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.confidenceWeight,
        workflowWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.workflowWeight,
        preferredOriginCountries: DEFAULT_TRADEMINING_SCORING_SETTINGS.preferredOriginCountries,
        penalizedOriginCountries: DEFAULT_TRADEMINING_SCORING_SETTINGS.penalizedOriginCountries,
        preferredOriginPorts: DEFAULT_TRADEMINING_SCORING_SETTINGS.preferredOriginPorts,
        penalizedOriginPorts: DEFAULT_TRADEMINING_SCORING_SETTINGS.penalizedOriginPorts,
        preferredDestinationMarkets: DEFAULT_TRADEMINING_SCORING_SETTINGS.preferredDestinationMarkets,
        penalizedDestinationMarkets: DEFAULT_TRADEMINING_SCORING_SETTINGS.penalizedDestinationMarkets,
        preferredIndustryKeywords: DEFAULT_TRADEMINING_SCORING_SETTINGS.preferredIndustryKeywords,
        penalizedIndustryKeywords: DEFAULT_TRADEMINING_SCORING_SETTINGS.penalizedIndustryKeywords,
        preferredHsCodePrefixes: DEFAULT_TRADEMINING_SCORING_SETTINGS.preferredHsCodePrefixes,
        penalizedHsCodePrefixes: DEFAULT_TRADEMINING_SCORING_SETTINGS.penalizedHsCodePrefixes,
        oversizeTeuThreshold: DEFAULT_TRADEMINING_SCORING_SETTINGS.oversizeTeuThreshold,
        oversizeShipmentCount30dThreshold:
          DEFAULT_TRADEMINING_SCORING_SETTINGS.oversizeShipmentCount30dThreshold,
        oversizePenalty: DEFAULT_TRADEMINING_SCORING_SETTINGS.oversizePenalty,
        midMarketTeuMin: DEFAULT_TRADEMINING_SCORING_SETTINGS.midMarketTeuMin,
        midMarketTeuMax: DEFAULT_TRADEMINING_SCORING_SETTINGS.midMarketTeuMax,
        midMarketBoost: DEFAULT_TRADEMINING_SCORING_SETTINGS.midMarketBoost,
        contactDecisionMakerWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactDecisionMakerWeight,
        contactManagerWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactManagerWeight,
        contactLogisticsDepartmentWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactLogisticsDepartmentWeight,
        contactWeakFunctionPenalty: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactWeakFunctionPenalty,
        contactCompanyContextWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactCompanyContextWeight,
        contactEmailWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactEmailWeight,
        contactLinkedinWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactLinkedinWeight,
        contactPhoneWeight: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactPhoneWeight,
        contactPrimaryContactBoost: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactPrimaryContactBoost,
        contactApprovedStatusBoost: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactApprovedStatusBoost,
        contactReviewingStatusBoost: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactReviewingStatusBoost,
        contactTier1Threshold: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactTier1Threshold,
        contactTier2Threshold: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactTier2Threshold,
        contactTier3Threshold: DEFAULT_TRADEMINING_SCORING_SETTINGS.contactTier3Threshold,
        preferredContactTitleKeywords: DEFAULT_TRADEMINING_SCORING_SETTINGS.preferredContactTitleKeywords,
        penalizedContactTitleKeywords: DEFAULT_TRADEMINING_SCORING_SETTINGS.penalizedContactTitleKeywords,
        preferredContactDepartments: DEFAULT_TRADEMINING_SCORING_SETTINGS.preferredContactDepartments,
        penalizedContactDepartments: DEFAULT_TRADEMINING_SCORING_SETTINGS.penalizedContactDepartments,
        aiClassificationEnabled: DEFAULT_TRADEMINING_SCORING_SETTINGS.aiClassificationEnabled,
        aiModel: DEFAULT_TRADEMINING_SCORING_SETTINGS.aiModel
      }
    });
  }

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
      allowedCompanyIdentityRoles: defaultTradeMiningCompanyIdentityRoles,
      excludedCompanyKeywords: ["maersk", "msc", "hapag", "cma cgm", "cosco", "evergreen", "one", "zim"],
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
      allowedCompanyIdentityRoles: defaultTradeMiningCompanyIdentityRoles,
      excludedCompanyKeywords: ["maersk", "msc", "hapag", "cma cgm", "cosco", "evergreen", "one", "zim"],
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
      update: {},
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
        allowedCompanyIdentityRoles: profile.allowedCompanyIdentityRoles,
        excludedCompanyKeywords: profile.excludedCompanyKeywords,
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
      companyName: company.name,
      sequenceMappings: [],
      sequenceDirectory: []
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
      actorUserId: adminUser.id,
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
