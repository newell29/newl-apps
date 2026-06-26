-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'CUSTOMER_CASHFLOW';

-- CreateEnum
CREATE TYPE "CashflowCustomerTier" AS ENUM ('A', 'B', 'C', 'D', 'REVIEW');

-- CreateEnum
CREATE TYPE "CashflowFileStatus" AS ENUM ('NO_VENDOR_COST_NO_REVENUE', 'VENDOR_COST_RECEIVED_NOT_CUSTOMER_BILLED', 'CUSTOMER_BILLED_NOT_COLLECTED', 'VENDOR_PAID_CUSTOMER_NOT_COLLECTED', 'CUSTOMER_COLLECTED_VENDOR_UNPAID', 'FILE_CLOSED', 'MARGIN_EXCEPTION', 'BILLING_BLOCKED', 'NEEDS_ACCOUNTING_REVIEW');

-- CreateEnum
CREATE TYPE "CashflowInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "CashflowVendorBillStatus" AS ENUM ('RECEIVED', 'APPROVED', 'PAID', 'PARTIAL', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "CashflowRiskTier" AS ENUM ('A', 'B', 'C', 'D', 'REVIEW');

-- CreateEnum
CREATE TYPE "CashflowPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "CashflowBillingTrigger" AS ENUM ('PORT_ARRIVAL', 'CONTAINER_AVAILABILITY', 'DELIVERY', 'WEEKLY_BILLING', 'MONTH_END_BILLING', 'MANUAL', 'CUSTOMER_SPECIFIC_RULE');

-- CreateEnum
CREATE TYPE "CashflowFollowUpStatus" AS ENUM ('OPEN', 'CONTACTED', 'DISPUTED', 'PROMISED_PAYMENT', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashflowAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CashflowAlertType" AS ENUM ('VENDOR_COST_NOT_BILLED', 'DELIVERED_NOT_BILLED', 'CREDIT_LIMIT_WARNING', 'CREDIT_LIMIT_BREACH', 'INVOICE_OVERDUE_15', 'INVOICE_OVERDUE_30', 'INVOICE_OVERDUE_45', 'LOW_MARGIN_FILE', 'NEGATIVE_MARGIN_FILE', 'SLOW_COLLECTIONS', 'MISSING_MAPPING', 'EXPOSURE_INCREASE');

-- CreateEnum
CREATE TYPE "CashflowAccountingLineKind" AS ENUM ('CUSTOMER_REVENUE', 'VENDOR_COST', 'OTHER');

-- CreateEnum
CREATE TYPE "CashflowLegalEntity" AS ENUM ('NEWL_WORLDWIDE', 'NEWL_USA');

-- CreateEnum
CREATE TYPE "CashflowBusinessLine" AS ENUM ('OCEAN', 'AIR', 'TRUCKING', 'WAREHOUSING', 'OTHER');

-- CreateTable
CREATE TABLE "CashflowCustomer" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "legalEntity" "CashflowLegalEntity" NOT NULL DEFAULT 'NEWL_WORLDWIDE',
  "businessLine" "CashflowBusinessLine" NOT NULL DEFAULT 'OCEAN',
  "customerCode" TEXT,
  "customerName" TEXT NOT NULL,
  "accountingNameVariants" JSONB,
  "customerTermsDays" INTEGER NOT NULL DEFAULT 30,
  "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "customerTier" "CashflowCustomerTier" NOT NULL DEFAULT 'REVIEW',
  "alertThresholdPercent" DECIMAL(8,4) NOT NULL DEFAULT 80,
  "billingTrigger" "CashflowBillingTrigger" NOT NULL DEFAULT 'DELIVERY',
  "vendorPaymentTrigger" "CashflowBillingTrigger" NOT NULL DEFAULT 'PORT_ARRIVAL',
  "requiresApprovalOverLimit" BOOLEAN NOT NULL DEFAULT false,
  "assignedSalesRep" TEXT,
  "assignedCollectionsOwner" TEXT,
  "assignedSalesContactId" TEXT,
  "assignedCollectionsContactId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowCustomerAlias" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "legalEntity" "CashflowLegalEntity" NOT NULL DEFAULT 'NEWL_WORLDWIDE',
  "sourceSystem" TEXT NOT NULL DEFAULT 'QUICKBOOKS',
  "sourceCustomerId" TEXT,
  "sourceCustomerName" TEXT NOT NULL,
  "normalizedSourceName" TEXT NOT NULL,
  "sourceCurrency" TEXT,
  "sourceAccountName" TEXT,
  "sourceLabel" TEXT,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowCustomerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowFile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "legalEntity" "CashflowLegalEntity" NOT NULL DEFAULT 'NEWL_WORLDWIDE',
  "businessLine" "CashflowBusinessLine" NOT NULL DEFAULT 'OCEAN',
  "fileNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "shipmentType" TEXT NOT NULL,
  "fileStatus" "CashflowFileStatus" NOT NULL DEFAULT 'NO_VENDOR_COST_NO_REVENUE',
  "operationalStatus" TEXT,
  "portArrivalDate" TIMESTAMP(3),
  "deliveryDate" TIMESTAMP(3),
  "customerInvoiceDate" TIMESTAMP(3),
  "customerPaymentDate" TIMESTAMP(3),
  "vendorInvoiceDate" TIMESTAMP(3),
  "vendorPaymentDate" TIMESTAMP(3),
  "estimatedRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actualRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "vendorCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grossProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grossMarginPercent" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "cashGapDays" INTEGER,
  "exposureAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "billingBlockReason" TEXT,
  "assignedOwner" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowCustomerInvoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "fileId" TEXT,
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "invoiceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "amountOpen" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentDate" TIMESTAMP(3),
  "daysToCollect" INTEGER,
  "daysPastDue" INTEGER,
  "invoiceStatus" "CashflowInvoiceStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowCustomerInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowVendorBill" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "vendorName" TEXT NOT NULL,
  "customerId" TEXT,
  "fileId" TEXT,
  "fileNumber" TEXT,
  "billDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "billAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentDate" TIMESTAMP(3),
  "vendorBillStatus" "CashflowVendorBillStatus" NOT NULL DEFAULT 'RECEIVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowVendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowAccountingLine" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "legalEntity" "CashflowLegalEntity" NOT NULL DEFAULT 'NEWL_WORLDWIDE',
  "businessLine" "CashflowBusinessLine" NOT NULL DEFAULT 'OCEAN',
  "fileId" TEXT,
  "fileNumber" TEXT,
  "shipmentType" TEXT,
  "lineKind" "CashflowAccountingLineKind" NOT NULL,
  "qbTransactionId" TEXT,
  "qbTransactionNumber" TEXT,
  "qbTransactionType" TEXT,
  "transactionDate" TIMESTAMP(3),
  "name" TEXT,
  "classFullName" TEXT,
  "description" TEXT,
  "accountName" TEXT,
  "splitAccountName" TEXT,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "rawJson" JSONB,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowAccountingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowCustomerSnapshot" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "vendorCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grossProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grossMarginPercent" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "openAr" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "overdueAr" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "unbilledRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "vendorCostsNotBilled" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "vendorCostsPaidNotCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "activeShipmentExposure" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalCreditExposure" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "availableCredit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "percentCreditUsed" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "averageDaysToInvoice" DECIMAL(8,2),
  "averageDaysToCollect" DECIMAL(8,2),
  "averageCashGapDays" DECIMAL(8,2),
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "riskTier" "CashflowRiskTier" NOT NULL DEFAULT 'REVIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowCustomerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowFollowUp" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "fileId" TEXT,
  "status" "CashflowFollowUpStatus" NOT NULL DEFAULT 'OPEN',
  "note" TEXT NOT NULL,
  "nextFollowUpDate" TIMESTAMP(3),
  "promisedPaymentDate" TIMESTAMP(3),
  "escalatedTo" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowAlert" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "fileId" TEXT,
  "invoiceId" TEXT,
  "alertType" "CashflowAlertType" NOT NULL,
  "priority" "CashflowPriority" NOT NULL,
  "status" "CashflowAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowSettings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "goodGrossMarginPercent" DECIMAL(8,4) NOT NULL DEFAULT 15,
  "lowMarginWarningPercent" DECIMAL(8,4) NOT NULL DEFAULT 10,
  "negativeMarginCriticalPercent" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "collectionWarningDaysBeyondTerms" INTEGER NOT NULL DEFAULT 10,
  "highExposureWarningPercent" DECIMAL(8,4) NOT NULL DEFAULT 80,
  "creditBreachPercent" DECIMAL(8,4) NOT NULL DEFAULT 100,
  "costNotBilledBusinessDays" INTEGER NOT NULL DEFAULT 2,
  "deliveredNotBilledBusinessDays" INTEGER NOT NULL DEFAULT 1,
  "defaultBillingTrigger" "CashflowBillingTrigger" NOT NULL DEFAULT 'DELIVERY',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashflowSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashflowCustomer_tenantId_id_key" ON "CashflowCustomer"("tenantId", "id");
CREATE UNIQUE INDEX "CashflowCustomer_tenantId_companyId_legalEntity_businessLine_key" ON "CashflowCustomer"("tenantId", "companyId", "legalEntity", "businessLine");
CREATE INDEX "CashflowCustomer_tenantId_companyId_idx" ON "CashflowCustomer"("tenantId", "companyId");
CREATE INDEX "CashflowCustomer_tenantId_customerCode_idx" ON "CashflowCustomer"("tenantId", "customerCode");
CREATE INDEX "CashflowCustomer_tenantId_legalEntity_idx" ON "CashflowCustomer"("tenantId", "legalEntity");
CREATE INDEX "CashflowCustomer_tenantId_businessLine_idx" ON "CashflowCustomer"("tenantId", "businessLine");
CREATE INDEX "CashflowCustomer_tenantId_customerTier_idx" ON "CashflowCustomer"("tenantId", "customerTier");
CREATE INDEX "CashflowCustomer_tenantId_active_idx" ON "CashflowCustomer"("tenantId", "active");
CREATE INDEX "CashflowCustomer_tenantId_assignedSalesRep_idx" ON "CashflowCustomer"("tenantId", "assignedSalesRep");
CREATE INDEX "CashflowCustomer_tenantId_assignedCollectionsOwner_idx" ON "CashflowCustomer"("tenantId", "assignedCollectionsOwner");
CREATE INDEX "CashflowCustomer_tenantId_assignedSalesContactId_idx" ON "CashflowCustomer"("tenantId", "assignedSalesContactId");
CREATE INDEX "CashflowCustomer_tenantId_assignedCollectionsContactId_idx" ON "CashflowCustomer"("tenantId", "assignedCollectionsContactId");

CREATE UNIQUE INDEX "CashflowCustomerAlias_tenantId_sourceSystem_legalEntity_normalizedSourceName_sourceCurrency_key" ON "CashflowCustomerAlias"("tenantId", "sourceSystem", "legalEntity", "normalizedSourceName", "sourceCurrency");
CREATE INDEX "CashflowCustomerAlias_tenantId_customerId_idx" ON "CashflowCustomerAlias"("tenantId", "customerId");
CREATE INDEX "CashflowCustomerAlias_tenantId_companyId_idx" ON "CashflowCustomerAlias"("tenantId", "companyId");
CREATE INDEX "CashflowCustomerAlias_tenantId_sourceSystem_idx" ON "CashflowCustomerAlias"("tenantId", "sourceSystem");
CREATE INDEX "CashflowCustomerAlias_tenantId_sourceCustomerId_idx" ON "CashflowCustomerAlias"("tenantId", "sourceCustomerId");
CREATE INDEX "CashflowCustomerAlias_tenantId_normalizedSourceName_idx" ON "CashflowCustomerAlias"("tenantId", "normalizedSourceName");

CREATE UNIQUE INDEX "CashflowFile_tenantId_id_key" ON "CashflowFile"("tenantId", "id");
CREATE UNIQUE INDEX "CashflowFile_tenantId_fileNumber_key" ON "CashflowFile"("tenantId", "fileNumber");
CREATE INDEX "CashflowFile_tenantId_customerId_idx" ON "CashflowFile"("tenantId", "customerId");
CREATE INDEX "CashflowFile_tenantId_legalEntity_idx" ON "CashflowFile"("tenantId", "legalEntity");
CREATE INDEX "CashflowFile_tenantId_businessLine_idx" ON "CashflowFile"("tenantId", "businessLine");
CREATE INDEX "CashflowFile_tenantId_fileStatus_idx" ON "CashflowFile"("tenantId", "fileStatus");
CREATE INDEX "CashflowFile_tenantId_shipmentType_idx" ON "CashflowFile"("tenantId", "shipmentType");
CREATE INDEX "CashflowFile_tenantId_portArrivalDate_idx" ON "CashflowFile"("tenantId", "portArrivalDate");
CREATE INDEX "CashflowFile_tenantId_deliveryDate_idx" ON "CashflowFile"("tenantId", "deliveryDate");
CREATE INDEX "CashflowFile_tenantId_customerInvoiceDate_idx" ON "CashflowFile"("tenantId", "customerInvoiceDate");
CREATE INDEX "CashflowFile_tenantId_vendorInvoiceDate_idx" ON "CashflowFile"("tenantId", "vendorInvoiceDate");
CREATE INDEX "CashflowFile_tenantId_assignedOwner_idx" ON "CashflowFile"("tenantId", "assignedOwner");

CREATE UNIQUE INDEX "CashflowCustomerInvoice_tenantId_id_key" ON "CashflowCustomerInvoice"("tenantId", "id");
CREATE UNIQUE INDEX "CashflowCustomerInvoice_tenantId_invoiceNumber_key" ON "CashflowCustomerInvoice"("tenantId", "invoiceNumber");
CREATE INDEX "CashflowCustomerInvoice_tenantId_customerId_idx" ON "CashflowCustomerInvoice"("tenantId", "customerId");
CREATE INDEX "CashflowCustomerInvoice_tenantId_fileId_idx" ON "CashflowCustomerInvoice"("tenantId", "fileId");
CREATE INDEX "CashflowCustomerInvoice_tenantId_invoiceDate_idx" ON "CashflowCustomerInvoice"("tenantId", "invoiceDate");
CREATE INDEX "CashflowCustomerInvoice_tenantId_dueDate_idx" ON "CashflowCustomerInvoice"("tenantId", "dueDate");
CREATE INDEX "CashflowCustomerInvoice_tenantId_invoiceStatus_idx" ON "CashflowCustomerInvoice"("tenantId", "invoiceStatus");
CREATE INDEX "CashflowCustomerInvoice_tenantId_daysPastDue_idx" ON "CashflowCustomerInvoice"("tenantId", "daysPastDue");

CREATE UNIQUE INDEX "CashflowVendorBill_tenantId_id_key" ON "CashflowVendorBill"("tenantId", "id");
CREATE INDEX "CashflowVendorBill_tenantId_vendorName_idx" ON "CashflowVendorBill"("tenantId", "vendorName");
CREATE INDEX "CashflowVendorBill_tenantId_customerId_idx" ON "CashflowVendorBill"("tenantId", "customerId");
CREATE INDEX "CashflowVendorBill_tenantId_fileId_idx" ON "CashflowVendorBill"("tenantId", "fileId");
CREATE INDEX "CashflowVendorBill_tenantId_fileNumber_idx" ON "CashflowVendorBill"("tenantId", "fileNumber");
CREATE INDEX "CashflowVendorBill_tenantId_billDate_idx" ON "CashflowVendorBill"("tenantId", "billDate");
CREATE INDEX "CashflowVendorBill_tenantId_vendorBillStatus_idx" ON "CashflowVendorBill"("tenantId", "vendorBillStatus");

CREATE UNIQUE INDEX "CashflowAccountingLine_tenantId_id_key" ON "CashflowAccountingLine"("tenantId", "id");
CREATE UNIQUE INDEX "CashflowAccountingLine_tenantId_qbTransactionId_fileNumber_lineKind_key" ON "CashflowAccountingLine"("tenantId", "qbTransactionId", "fileNumber", "lineKind");
CREATE INDEX "CashflowAccountingLine_tenantId_fileNumber_idx" ON "CashflowAccountingLine"("tenantId", "fileNumber");
CREATE INDEX "CashflowAccountingLine_tenantId_legalEntity_idx" ON "CashflowAccountingLine"("tenantId", "legalEntity");
CREATE INDEX "CashflowAccountingLine_tenantId_businessLine_idx" ON "CashflowAccountingLine"("tenantId", "businessLine");
CREATE INDEX "CashflowAccountingLine_tenantId_shipmentType_idx" ON "CashflowAccountingLine"("tenantId", "shipmentType");
CREATE INDEX "CashflowAccountingLine_tenantId_lineKind_idx" ON "CashflowAccountingLine"("tenantId", "lineKind");
CREATE INDEX "CashflowAccountingLine_tenantId_qbTransactionType_idx" ON "CashflowAccountingLine"("tenantId", "qbTransactionType");
CREATE INDEX "CashflowAccountingLine_tenantId_transactionDate_idx" ON "CashflowAccountingLine"("tenantId", "transactionDate");
CREATE INDEX "CashflowAccountingLine_tenantId_fileId_idx" ON "CashflowAccountingLine"("tenantId", "fileId");

CREATE UNIQUE INDEX "CashflowCustomerSnapshot_tenantId_customerId_periodStart_periodEnd_key" ON "CashflowCustomerSnapshot"("tenantId", "customerId", "periodStart", "periodEnd");
CREATE INDEX "CashflowCustomerSnapshot_tenantId_periodEnd_idx" ON "CashflowCustomerSnapshot"("tenantId", "periodEnd");
CREATE INDEX "CashflowCustomerSnapshot_tenantId_customerId_idx" ON "CashflowCustomerSnapshot"("tenantId", "customerId");
CREATE INDEX "CashflowCustomerSnapshot_tenantId_riskTier_idx" ON "CashflowCustomerSnapshot"("tenantId", "riskTier");
CREATE INDEX "CashflowCustomerSnapshot_tenantId_totalCreditExposure_idx" ON "CashflowCustomerSnapshot"("tenantId", "totalCreditExposure");

CREATE UNIQUE INDEX "CashflowFollowUp_tenantId_id_key" ON "CashflowFollowUp"("tenantId", "id");
CREATE INDEX "CashflowFollowUp_tenantId_customerId_createdAt_idx" ON "CashflowFollowUp"("tenantId", "customerId", "createdAt");
CREATE INDEX "CashflowFollowUp_tenantId_invoiceId_idx" ON "CashflowFollowUp"("tenantId", "invoiceId");
CREATE INDEX "CashflowFollowUp_tenantId_fileId_idx" ON "CashflowFollowUp"("tenantId", "fileId");
CREATE INDEX "CashflowFollowUp_tenantId_status_idx" ON "CashflowFollowUp"("tenantId", "status");
CREATE INDEX "CashflowFollowUp_tenantId_nextFollowUpDate_idx" ON "CashflowFollowUp"("tenantId", "nextFollowUpDate");

CREATE UNIQUE INDEX "CashflowAlert_tenantId_id_key" ON "CashflowAlert"("tenantId", "id");
CREATE INDEX "CashflowAlert_tenantId_alertType_idx" ON "CashflowAlert"("tenantId", "alertType");
CREATE INDEX "CashflowAlert_tenantId_priority_idx" ON "CashflowAlert"("tenantId", "priority");
CREATE INDEX "CashflowAlert_tenantId_status_idx" ON "CashflowAlert"("tenantId", "status");
CREATE INDEX "CashflowAlert_tenantId_customerId_idx" ON "CashflowAlert"("tenantId", "customerId");
CREATE INDEX "CashflowAlert_tenantId_fileId_idx" ON "CashflowAlert"("tenantId", "fileId");
CREATE INDEX "CashflowAlert_tenantId_invoiceId_idx" ON "CashflowAlert"("tenantId", "invoiceId");
CREATE INDEX "CashflowAlert_tenantId_dueDate_idx" ON "CashflowAlert"("tenantId", "dueDate");

CREATE UNIQUE INDEX "CashflowSettings_tenantId_key" ON "CashflowSettings"("tenantId");
CREATE INDEX "CashflowSettings_tenantId_idx" ON "CashflowSettings"("tenantId");

-- AddForeignKey
ALTER TABLE "CashflowCustomer" ADD CONSTRAINT "CashflowCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomer" ADD CONSTRAINT "CashflowCustomer_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomer" ADD CONSTRAINT "CashflowCustomer_tenantId_companyId_assignedSalesContactId_fkey" FOREIGN KEY ("tenantId", "companyId", "assignedSalesContactId") REFERENCES "Contact"("tenantId", "companyId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomer" ADD CONSTRAINT "CashflowCustomer_tenantId_companyId_assignedCollectionsContactId_fkey" FOREIGN KEY ("tenantId", "companyId", "assignedCollectionsContactId") REFERENCES "Contact"("tenantId", "companyId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerAlias" ADD CONSTRAINT "CashflowCustomerAlias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerAlias" ADD CONSTRAINT "CashflowCustomerAlias_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "CashflowCustomer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerAlias" ADD CONSTRAINT "CashflowCustomerAlias_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowFile" ADD CONSTRAINT "CashflowFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowFile" ADD CONSTRAINT "CashflowFile_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "CashflowCustomer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerInvoice" ADD CONSTRAINT "CashflowCustomerInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerInvoice" ADD CONSTRAINT "CashflowCustomerInvoice_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "CashflowCustomer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerInvoice" ADD CONSTRAINT "CashflowCustomerInvoice_tenantId_fileId_fkey" FOREIGN KEY ("tenantId", "fileId") REFERENCES "CashflowFile"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowVendorBill" ADD CONSTRAINT "CashflowVendorBill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowVendorBill" ADD CONSTRAINT "CashflowVendorBill_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "CashflowCustomer"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowVendorBill" ADD CONSTRAINT "CashflowVendorBill_tenantId_fileId_fkey" FOREIGN KEY ("tenantId", "fileId") REFERENCES "CashflowFile"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowAccountingLine" ADD CONSTRAINT "CashflowAccountingLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowAccountingLine" ADD CONSTRAINT "CashflowAccountingLine_tenantId_fileId_fkey" FOREIGN KEY ("tenantId", "fileId") REFERENCES "CashflowFile"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerSnapshot" ADD CONSTRAINT "CashflowCustomerSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowCustomerSnapshot" ADD CONSTRAINT "CashflowCustomerSnapshot_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "CashflowCustomer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowFollowUp" ADD CONSTRAINT "CashflowFollowUp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowFollowUp" ADD CONSTRAINT "CashflowFollowUp_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "CashflowCustomer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowFollowUp" ADD CONSTRAINT "CashflowFollowUp_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "CashflowCustomerInvoice"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowFollowUp" ADD CONSTRAINT "CashflowFollowUp_tenantId_fileId_fkey" FOREIGN KEY ("tenantId", "fileId") REFERENCES "CashflowFile"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashflowAlert" ADD CONSTRAINT "CashflowAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowAlert" ADD CONSTRAINT "CashflowAlert_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "CashflowCustomer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowAlert" ADD CONSTRAINT "CashflowAlert_tenantId_fileId_fkey" FOREIGN KEY ("tenantId", "fileId") REFERENCES "CashflowFile"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowAlert" ADD CONSTRAINT "CashflowAlert_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "CashflowCustomerInvoice"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowSettings" ADD CONSTRAINT "CashflowSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
