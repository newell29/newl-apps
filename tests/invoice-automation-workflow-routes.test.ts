import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceAutomationStatus, ModuleKey, PlatformRole } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";

type TxMock = {
  invoiceAutomationInvoice: {
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  invoiceAutomationBatch: {
    updateMany: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
};

const mocks = vi.hoisted(() => {
  const tx: TxMock = {
    invoiceAutomationInvoice: {
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    invoiceAutomationBatch: {
      updateMany: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  };

  return {
    getAuthenticatedContext: vi.fn(),
    requireModule: vi.fn(),
    requireMutationAccess: vi.fn(),
    requireRole: vi.fn(),
    revalidatePath: vi.fn(),
    learnInvoiceAutomationCorrectionMemory: vi.fn(),
    learnInvoiceAutomationEntityAlias: vi.fn(),
    tx,
    prisma: {
      $transaction: vi.fn((callback: (transaction: TxMock) => Promise<unknown>) => callback(tx)),
      invoiceAutomationInvoice: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn()
      },
      auditLog: {
        create: vi.fn()
      }
    }
  };
});

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: () => mocks.getAuthenticatedContext()
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => mocks.requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => mocks.requireMutationAccess(...args),
  requireRole: (...args: unknown[]) => mocks.requireRole(...args)
}));

vi.mock("@/server/db", () => ({
  prisma: mocks.prisma
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args)
}));

vi.mock("@/modules/invoice-automation/entity-aliases", () => ({
  learnInvoiceAutomationEntityAlias: (...args: unknown[]) => mocks.learnInvoiceAutomationEntityAlias(...args)
}));

vi.mock("@/modules/invoice-automation/correction-memory-store", () => ({
  learnInvoiceAutomationCorrectionMemory: (...args: unknown[]) => mocks.learnInvoiceAutomationCorrectionMemory(...args)
}));

import { POST as approveForPosting } from "@/app/api/finance/invoice-automation/approve/route";
import { PATCH as editInvoice } from "@/app/api/finance/invoice-automation/invoices/[invoiceId]/route";
import { POST as postToQuickBooks } from "@/app/api/finance/invoice-automation/post/route";
import { POST as sendToAccounting } from "@/app/api/finance/invoice-automation/queue/route";
import { POST as uploadInvoices } from "@/app/api/finance/invoice-automation/uploads/route";

const context: AuthenticatedContext = {
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "User",
  role: PlatformRole.FINANCE,
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

const completeCustomerInvoice = {
  id: "invoice-1",
  invoiceType: "CUSTOMER" as const,
  fileName: "customer.pdf",
  shipmentFileNumber: "OE12345",
  invoiceNumber: "C-100",
  invoiceDate: new Date("2026-07-01T00:00:00.000Z"),
  entityNameRaw: "Acme Logistics",
  quickBooksEntityId: "qb-customer-1",
  currency: "CAD",
  totalAmount: 1000,
  productOrAccountName: "Ocean Freight"
};

const completeVendorInvoice = {
  id: "invoice-2",
  invoiceType: "VENDOR" as const,
  fileName: "vendor.pdf",
  shipmentFileNumber: "TR12345",
  invoiceNumber: "V-100",
  invoiceDate: new Date("2026-07-01T00:00:00.000Z"),
  entityNameRaw: "Fast Trucking",
  quickBooksEntityId: "qb-vendor-1",
  currency: "CAD",
  totalAmount: 500,
  productOrAccountName: "5015 Trucking Rate"
};

describe("invoice automation workflow routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedContext.mockResolvedValue(context);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.requireMutationAccess.mockReturnValue(undefined);
    mocks.requireRole.mockReturnValue(undefined);
    mocks.prisma.$transaction.mockImplementation((callback: (transaction: TxMock) => Promise<unknown>) => callback(mocks.tx));
    mocks.prisma.invoiceAutomationInvoice.findMany.mockResolvedValue([]);
    mocks.prisma.invoiceAutomationInvoice.findFirst.mockResolvedValue(null);
    mocks.prisma.invoiceAutomationInvoice.findUnique.mockResolvedValue(null);
    mocks.prisma.invoiceAutomationInvoice.update.mockResolvedValue({
      ...completeCustomerInvoice,
      batch: { batchNumber: "IA-1" },
      status: InvoiceAutomationStatus.ACCOUNTING_REVIEW,
      shipmentType: "OE",
      businessLine: "OCEAN",
      quickBooksEntityDisplayName: "Acme Logistics CAD",
      quickBooksMatchConfidence: 100,
      dueDate: new Date("2026-07-31T00:00:00.000Z"),
      subtotalAmount: 1000,
      taxAmount: 0,
      issueCodes: [],
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      sentToAccountingAt: null,
      sentToAccountingById: null
    });
    mocks.tx.invoiceAutomationInvoice.findMany.mockReset();
    mocks.tx.invoiceAutomationInvoice.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.invoiceAutomationBatch.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.auditLog.create.mockResolvedValue({});
    mocks.prisma.auditLog.create.mockResolvedValue({});
    mocks.learnInvoiceAutomationCorrectionMemory.mockResolvedValue(undefined);
    mocks.learnInvoiceAutomationEntityAlias.mockResolvedValue(undefined);
  });

  it("moves complete operations invoices to accounting and records who sent them", async () => {
    mocks.tx.invoiceAutomationInvoice.findMany
      .mockResolvedValueOnce([completeCustomerInvoice, completeVendorInvoice])
      .mockResolvedValueOnce([{ batchId: "batch-1" }]);

    const response = await sendToAccounting(
      new Request("https://newl.test/api/finance/invoice-automation/queue", {
        method: "POST",
        body: JSON.stringify({ invoiceIds: ["invoice-1", "invoice-2"] })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.requireModule).toHaveBeenCalledWith(context, ModuleKey.INVOICE_VERIFICATION);
    expect(mocks.tx.invoiceAutomationInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: InvoiceAutomationStatus.ACCOUNTING_REVIEW,
          sentToAccountingById: context.userId,
          sentToAccountingAt: expect.any(Date)
        })
      })
    );
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: context.userId,
          action: "invoice-automation.sent-to-accounting"
        })
      })
    );
  });

  it("blocks sending incomplete invoices to accounting", async () => {
    mocks.tx.invoiceAutomationInvoice.findMany.mockResolvedValueOnce([
      {
        ...completeVendorInvoice,
        quickBooksEntityId: null
      }
    ]);

    const response = await sendToAccounting(
      new Request("https://newl.test/api/finance/invoice-automation/queue", {
        method: "POST",
        body: JSON.stringify({ invoiceIds: ["invoice-2"] })
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "V-100 cannot be approved because it has missing QuickBooks match."
    });
    expect(mocks.tx.invoiceAutomationInvoice.updateMany).not.toHaveBeenCalled();
  });

  it("approves accounting invoices for posting and records who approved them", async () => {
    mocks.tx.invoiceAutomationInvoice.findMany.mockResolvedValueOnce([completeCustomerInvoice]);

    const response = await approveForPosting(
      new Request("https://newl.test/api/finance/invoice-automation/approve", {
        method: "POST",
        body: JSON.stringify({ invoiceIds: ["invoice-1"] })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.requireModule).toHaveBeenCalledWith(context, ModuleKey.QUICKBOOKS_POSTING);
    expect(mocks.tx.invoiceAutomationInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: InvoiceAutomationStatus.APPROVED_FOR_POSTING,
          approvedByUserId: context.userId,
          approvedAt: expect.any(Date)
        })
      })
    );
  });

  it("blocks duplicate customer invoices in the same upload", async () => {
    const response = await uploadInvoices(
      new Request("https://newl.test/api/finance/invoice-automation/uploads", {
        method: "POST",
        body: JSON.stringify({
          invoiceType: "CUSTOMER",
          invoices: [
            customerDraft("draft-1", "C-100"),
            customerDraft("draft-2", "C 100")
          ]
        })
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Duplicate customer invoice C 100 for Acme Logistics CAD is already in this upload."
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks uploaded customer invoices that already exist in posted history", async () => {
    mocks.prisma.invoiceAutomationInvoice.findFirst.mockResolvedValueOnce({
      invoiceNumber: "C-100",
      entityNameRaw: "Acme Logistics",
      quickBooksEntityDisplayName: "Acme Logistics CAD",
      batch: {
        batchNumber: "IA-POSTED"
      }
    });

    const response = await uploadInvoices(
      new Request("https://newl.test/api/finance/invoice-automation/uploads", {
        method: "POST",
        body: JSON.stringify({
          invoiceType: "CUSTOMER",
          invoices: [customerDraft("draft-1", "C-100")]
        })
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.prisma.invoiceAutomationInvoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: context.tenantId,
          invoiceType: "CUSTOMER",
          status: expect.objectContaining({
            in: expect.arrayContaining([InvoiceAutomationStatus.POSTED])
          })
        })
      })
    );
    await expect(response.json()).resolves.toEqual({
      error: "Duplicate customer invoice C-100 for Acme Logistics CAD already exists in batch IA-POSTED."
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks accounting edits that would create a duplicate invoice number", async () => {
    mocks.prisma.invoiceAutomationInvoice.findUnique.mockResolvedValueOnce({
      id: "invoice-1",
      tenantId: context.tenantId,
      invoiceType: "CUSTOMER",
      status: InvoiceAutomationStatus.ACCOUNTING_REVIEW,
      batch: {
        batchNumber: "IA-1"
      }
    });
    mocks.prisma.invoiceAutomationInvoice.findFirst.mockResolvedValueOnce({
      batch: {
        batchNumber: "IA-OTHER"
      }
    });

    const response = await editInvoice(
      new Request("https://newl.test/api/finance/invoice-automation/invoices/invoice-1", {
        method: "PATCH",
        body: JSON.stringify({
          shipmentFileNumber: "OE12345",
          entityNameRaw: "Acme Logistics",
          quickBooksEntityId: "qb-customer-1",
          quickBooksEntityDisplayName: "Acme Logistics CAD",
          invoiceNumber: "C-100",
          invoiceDate: "2026-07-01",
          dueDate: "2026-07-31",
          currency: "CAD",
          totalAmount: 1000,
          productOrAccountName: "Ocean Freight"
        })
      }),
      { params: Promise.resolve({ invoiceId: "invoice-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This customer invoice number already exists for the same customer in batch IA-OTHER."
    });
    expect(mocks.prisma.invoiceAutomationInvoice.update).not.toHaveBeenCalled();
  });

  it("keeps live QuickBooks posting disabled unless the explicit env flag is enabled", async () => {
    const originalValue = process.env.QUICKBOOKS_POSTING_ENABLED;
    delete process.env.QUICKBOOKS_POSTING_ENABLED;

    const response = await postToQuickBooks(
      new Request("https://newl.test/api/finance/invoice-automation/post", {
        method: "POST",
        body: JSON.stringify({
          invoiceIds: ["invoice-1"],
          mode: "post",
          confirmText: "POST TO QUICKBOOKS"
        })
      })
    );

    if (originalValue === undefined) {
      delete process.env.QUICKBOOKS_POSTING_ENABLED;
    } else {
      process.env.QUICKBOOKS_POSTING_ENABLED = originalValue;
    }

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "QuickBooks posting is disabled. Set QUICKBOOKS_POSTING_ENABLED=true only when ready to run controlled tests."
    });
    expect(mocks.prisma.invoiceAutomationInvoice.findMany).not.toHaveBeenCalled();
  });
});

function customerDraft(clientId: string, invoiceNumber: string) {
  return {
    clientId,
    fileName: `${invoiceNumber}.pdf`,
    contentType: "application/pdf",
    sizeBytes: 100,
    pdfBase64: "JVBERi0x",
    extractedText: "Invoice text",
    shipmentFileNumber: "OE12345",
    shipmentType: "OE",
    businessLine: "OCEAN",
    entityNameRaw: "Acme Logistics",
    quickBooksEntityId: "qb-customer-1",
    quickBooksEntityDisplayName: "Acme Logistics CAD",
    quickBooksMatchConfidence: 100,
    invoiceNumber,
    invoiceDate: "2026-07-01",
    dueDate: "2026-07-31",
    currency: "CAD",
    subtotalAmount: 1000,
    taxAmount: 0,
    totalAmount: 1000,
    productOrAccountName: "Ocean Freight",
    issueCodes: []
  };
}
