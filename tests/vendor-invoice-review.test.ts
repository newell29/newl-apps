import { describe, expect, it, beforeEach, vi } from "vitest";
import { ModuleKey, PlatformRole, VendorInvoiceReviewStatus } from "@prisma/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { formatVendorInvoiceReviewDateTime } from "@/modules/vendor-invoice-review/components/vendor-invoice-review-client";
import { buildVendorInvoiceReviewDraftsFromText } from "@/modules/vendor-invoice-review/extraction";
import { getVendorInvoiceReviewPackages } from "@/modules/vendor-invoice-review/queries";
import { formatApprovalTimestamp, getApprovalStampLayout } from "@/modules/vendor-invoice-review/stamping";
import {
  findDuplicateVendorInvoiceReviewDraft,
  refreshVendorInvoiceReviewDraftIssues
} from "@/modules/vendor-invoice-review/review";

type TxMock = {
  vendorInvoiceReviewDocument: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
  vendorInvoiceReviewInvoice: {
    create: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
  invoiceAutomationBatch: { create: ReturnType<typeof vi.fn> };
  invoiceAutomationDocument: { create: ReturnType<typeof vi.fn> };
  invoiceAutomationInvoice: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
};

const mocks = vi.hoisted(() => {
  const tx: TxMock = {
    vendorInvoiceReviewDocument: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn()
    },
    vendorInvoiceReviewInvoice: {
      create: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    },
    invoiceAutomationBatch: { create: vi.fn() },
    invoiceAutomationDocument: { create: vi.fn() },
    invoiceAutomationInvoice: { create: vi.fn(), findFirst: vi.fn() }
  };

  return {
    getAuthenticatedContext: vi.fn(),
    requireModule: vi.fn(),
    requireMutationAccess: vi.fn(),
    requireRole: vi.fn(),
    revalidatePath: vi.fn(),
    getInvoiceAutomationEntityOptions: vi.fn(),
    learnInvoiceAutomationEntityAlias: vi.fn(),
    learnInvoiceAutomationCorrectionMemory: vi.fn(),
    tx,
    prisma: {
      $transaction: vi.fn((callback: (transaction: TxMock) => Promise<unknown>) => callback(tx)),
      vendorInvoiceReviewInvoice: {
        findFirst: vi.fn()
      },
      vendorInvoiceReviewDocument: {
        findMany: vi.fn(),
        findFirst: vi.fn()
      },
      user: {
        findMany: vi.fn()
      },
      invoiceAutomationInvoice: {
        updateMany: vi.fn()
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

vi.mock("@/modules/invoice-automation/queries", () => ({
  getInvoiceAutomationEntityOptions: (...args: unknown[]) => mocks.getInvoiceAutomationEntityOptions(...args)
}));

vi.mock("@/modules/invoice-automation/entity-aliases", () => ({
  learnInvoiceAutomationEntityAlias: (...args: unknown[]) => mocks.learnInvoiceAutomationEntityAlias(...args)
}));

vi.mock("@/modules/invoice-automation/correction-memory-store", () => ({
  learnInvoiceAutomationCorrectionMemory: (...args: unknown[]) => mocks.learnInvoiceAutomationCorrectionMemory(...args)
}));

import { POST as saveVendorInvoiceReview } from "@/app/api/operations/vendor-invoice-review/uploads/route";
import { POST as saveCustomerInvoiceIntake } from "@/app/api/operations/customer-invoice-intake/uploads/route";
import { GET as openVendorInvoiceReviewPackage } from "@/app/api/operations/vendor-invoice-review/packages/[documentId]/route";
import { GET as downloadVendorInvoiceReviewPdf } from "@/app/api/operations/vendor-invoice-review/packages/[documentId]/pdf/route";

const context: AuthenticatedContext = {
  userId: "user-1",
  userEmail: "ops@example.com",
  userName: "Ops User",
  role: PlatformRole.OPERATIONS,
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

const textInvoice = [
  "Vendor: Fast Trucking",
  "Invoice Number INV-100",
  "Invoice Date 2026-07-01",
  "File TR12345",
  "Currency CAD",
  "Subtotal 100.00",
  "HST 13.00",
  "Total 113.00"
].join("\n");

const continuousTextInvoice = [
  "Invoice #INV-ST-NEWL-193 Steele's Transfer Ltd. 7151 - 44 St SE Unit 115A Calgary, AB, CA T2C 4E8",
  "GST/HST 12226 4328 RT0001 dispatch@steelesgroup.com Invoice Revision: #1 Ship Date: June 11, 2026",
  "Invoice Date: June 11, 2026 Terms: Due in 30 Days Bill To: Newell's Express & Warehousing Ltd",
  "Remit To: Steele's Transfer Ltd. 6390 Kestrel Road Mississauga, ON, CA L5T 1Z3",
  "PO Number: AWB 131-05596091 Freight Charges: $110.69 CAD Fuel: $46.82 CAD Sub-Total: $157.51 CAD Tax Excempt $0.00 CAD TOTAL DUE $157.51 CAD AI2740N13"
].join(" ");

describe("vendor invoice review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedContext.mockResolvedValue(context);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.requireMutationAccess.mockReturnValue(undefined);
    mocks.requireRole.mockReturnValue(undefined);
    mocks.getInvoiceAutomationEntityOptions.mockResolvedValue([
      {
        id: "qb-vendor-fast",
        displayName: "Fast Trucking",
        normalizedName: "fast trucking",
        currency: "CAD",
        entityType: "VENDOR"
      },
      {
        id: "qb-customer-fast",
        displayName: "Fast Trucking",
        normalizedName: "fast trucking",
        currency: "CAD",
        entityType: "CUSTOMER"
      }
    ]);
    mocks.learnInvoiceAutomationEntityAlias.mockResolvedValue(undefined);
    mocks.learnInvoiceAutomationCorrectionMemory.mockResolvedValue(undefined);
    mocks.prisma.$transaction.mockImplementation((callback: (transaction: TxMock) => Promise<unknown>) => callback(mocks.tx));
    mocks.prisma.vendorInvoiceReviewInvoice.findFirst.mockResolvedValue(null);
    mocks.prisma.vendorInvoiceReviewDocument.findMany.mockResolvedValue([]);
    mocks.prisma.vendorInvoiceReviewDocument.findFirst.mockResolvedValue(null);
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.tx.vendorInvoiceReviewDocument.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "document-1",
        ...data,
        financeBatchId: null
      })
    );
    mocks.tx.vendorInvoiceReviewDocument.update.mockResolvedValue({});
    mocks.tx.vendorInvoiceReviewDocument.findUniqueOrThrow.mockResolvedValue({
      id: "document-1",
      financeStatus: "SENT_TO_FINANCE",
      financeError: null,
      financeBatchId: "finance-batch-1"
    });
    mocks.tx.invoiceAutomationBatch.create.mockResolvedValue({ id: "finance-batch-1", batchNumber: "IA-TEST" });
    mocks.tx.invoiceAutomationDocument.create.mockResolvedValue({ id: "finance-document-1" });
    mocks.tx.invoiceAutomationInvoice.findFirst.mockResolvedValue(null);
    mocks.tx.invoiceAutomationInvoice.create.mockResolvedValue({ id: "finance-invoice-1" });
    mocks.tx.vendorInvoiceReviewInvoice.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: `invoice-${data.invoiceNumber ?? "missing"}`,
        documentId: data.documentId,
        invoiceKind: data.invoiceKind,
        fileName: data.fileName,
        vendorName: data.vendorName,
        invoiceNumber: data.invoiceNumber,
        invoiceDate: data.invoiceDate,
        tmsFileNumber: data.tmsFileNumber,
        vendorReference: data.vendorReference,
        currency: data.currency,
        subtotalAmount: data.subtotalAmount,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        issueCodes: data.issueCodes,
        createdAt: new Date("2026-07-20T00:00:00.000Z")
      })
    );
    mocks.tx.auditLog.create.mockResolvedValue({});
  });

  it("builds a review row from text-based PDF extraction", () => {
    const drafts = buildVendorInvoiceReviewDraftsFromText({
      documentClientId: "doc-1",
      fileName: "package.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "data:application/pdf;base64,JVBERi0x",
      extractedText: textInvoice
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      vendorName: "Fast Trucking",
      invoiceNumber: "INV-100",
      invoiceDate: "2026-07-01",
      vendorReference: null,
      tmsFileNumber: "TR12345",
      confirmedTmsFileNumber: "TR12345",
      currency: "CAD",
      subtotalAmount: 100,
      taxAmount: 13,
      totalAmount: 113
    });
    expect(drafts[0].issueCodes).not.toContain("CONFIRM_TMS_FILE_NUMBER");
  });

  it("fills vendor, subtotal, and tax from continuous embedded PDF text", () => {
    const drafts = buildVendorInvoiceReviewDraftsFromText({
      documentClientId: "doc-1",
      fileName: "AI2740N13_Steele's.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "data:application/pdf;base64,JVBERi0x",
      extractedText: continuousTextInvoice
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      vendorName: "Steele's Transfer Ltd",
      invoiceNumber: "INV-ST-NEWL-193",
      invoiceDate: "2026-06-11",
      tmsFileNumber: "AI2740N13",
      confirmedTmsFileNumber: "AI2740N13",
      vendorReference: "131-05596091",
      currency: "CAD",
      subtotalAmount: 157.51,
      taxAmount: 0,
      totalAmount: 157.51
    });
  });

  it("formats saved package dates deterministically for server and client rendering", () => {
    expect(formatVendorInvoiceReviewDateTime("2026-07-20T12:05:00.000Z")).toBe("2026-07-20 12:05 UTC");
  });

  it("formats approval time in Toronto using 12-hour AM/PM text", () => {
    expect(formatApprovalTimestamp(new Date("2026-01-20T18:05:00.000Z"))).toBe("2026-01-20 1:05 PM EST");
  });

  it("uses a bottom-left stamp with light background and thin border", () => {
    const layout = getApprovalStampLayout(300, 200);

    expect(layout.x).toBe(24);
    expect(layout.y).toBe(24);
    expect(layout.x + layout.width).toBeLessThanOrEqual(276);
    expect(layout.y + layout.height).toBeLessThanOrEqual(176);
    expect(layout.borderWidth).toBeLessThan(1);
    expect(layout.backgroundOpacity).toBeLessThan(0.3);
  });

  it("creates one blank editable row for scanned PDFs without OCR", () => {
    const drafts = buildVendorInvoiceReviewDraftsFromText({
      documentClientId: "doc-1",
      fileName: "scan.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "data:application/pdf;base64,JVBERi0x",
      extractedText: ""
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      vendorName: null,
      invoiceNumber: null,
      vendorReference: null,
      confirmedTmsFileNumber: null,
      totalAmount: null
    });
    expect(drafts[0].issueCodes).toContain("CONFIRM_TMS_FILE_NUMBER");
    expect(drafts[0].issueCodes).toContain("MISSING_VENDOR");
  });

  it("does not require OCR when vendor, subtotal, or tax is missing", () => {
    const drafts = buildVendorInvoiceReviewDraftsFromText({
      documentClientId: "doc-1",
      fileName: "partial.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "data:application/pdf;base64,JVBERi0x",
      extractedText: ["Invoice Number INV-300", "Invoice Date 2026-07-03", "File TR30000", "Currency CAD", "Total 250.00"].join("\n")
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].invoiceNumber).toBe("INV-300");
    expect(drafts[0].vendorName).toBeNull();
    expect(drafts[0].subtotalAmount).toBeNull();
    expect(drafts[0].taxAmount).toBeNull();
    expect(drafts[0].issueCodes).toContain("MISSING_VENDOR");
  });

  it("detects multiple invoices in one PDF text package", () => {
    const drafts = buildVendorInvoiceReviewDraftsFromText({
      documentClientId: "doc-1",
      fileName: "package.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "data:application/pdf;base64,JVBERi0x",
      extractedText: `${textInvoice}\n\nInvoice Number INV-200\nInvoice Date 2026-07-02\nFile TR22222\nVendor: Second Carrier\nCurrency CAD\nTotal 50.00`
    });

    expect(drafts.length).toBeGreaterThan(1);
  });

  it("keeps extracted fields editable before saving", () => {
    const [draft] = buildVendorInvoiceReviewDraftsFromText({
      documentClientId: "doc-1",
      fileName: "package.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "data:application/pdf;base64,JVBERi0x",
      extractedText: textInvoice
    });

    const edited = refreshVendorInvoiceReviewDraftIssues({
      ...draft,
      vendorName: "Corrected Carrier",
      vendorReference: "BOL12345",
      confirmedTmsFileNumber: "TR99999"
    });

    expect(edited.vendorName).toBe("Corrected Carrier");
    expect(edited.vendorReference).toBe("BOL12345");
    expect(edited.confirmedTmsFileNumber).toBe("TR99999");
    expect(edited.issueCodes).not.toContain("CONFIRM_TMS_FILE_NUMBER");
  });

  it("supports removing an incorrectly detected invoice row before saving", () => {
    const drafts = [
      refreshVendorInvoiceReviewDraftIssues({
        ...buildCompleteDraft("INV-100"),
        confirmedTmsFileNumber: "TR12345"
      }),
      refreshVendorInvoiceReviewDraftIssues({
        ...buildCompleteDraft("INV-200"),
        confirmedTmsFileNumber: "TR12345"
      })
    ];

    const kept = drafts.filter((draft) => draft.invoiceNumber !== "INV-200");
    expect(kept).toHaveLength(1);
    expect(kept[0].invoiceNumber).toBe("INV-100");
  });

  it("requires confirmed TMS file number before saving", async () => {
    const response = await saveVendorInvoiceReview(await buildSaveRequest([buildCompleteDraft("INV-100")]));

    expect(response.status).toBe(422);
    expect(mocks.tx.vendorInvoiceReviewDocument.create).not.toHaveBeenCalled();
  });

  it("warns on duplicate invoices before persistence", () => {
    const duplicate = findDuplicateVendorInvoiceReviewDraft([
      buildCompleteDraft("INV-100"),
      buildCompleteDraft("INV-100")
    ]);

    expect(duplicate?.duplicate.invoiceNumber).toBe("INV-100");
  });

  it("retains the original PDF package and saves confirmed rows only in the new module", async () => {
    const response = await saveVendorInvoiceReview(
      await buildSaveRequest([
        refreshVendorInvoiceReviewDraftIssues({
          ...buildCompleteDraft("INV-100"),
          confirmedTmsFileNumber: "TR12345"
        })
      ])
    );

    expect(response.status).toBe(201);
    expect(mocks.requireModule).toHaveBeenCalledWith(context, ModuleKey.INVOICE_VERIFICATION);
    expect(mocks.tx.vendorInvoiceReviewDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceKind: "Vendor_Invoices",
          fileName: "package.pdf",
          pdfBytes: expect.any(Buffer)
        })
      })
    );
    expect(mocks.tx.vendorInvoiceReviewInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VendorInvoiceReviewStatus.SAVED,
          invoiceKind: "Vendor_Invoices",
          tmsFileNumber: "TR12345"
        })
      })
    );
    expect(mocks.prisma.invoiceAutomationInvoice.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.invoiceAutomationBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceType: "VENDOR",
          status: "ACCOUNTING_REVIEW",
          sentToAccountingById: "user-1"
        })
      })
    );
    expect(mocks.tx.invoiceAutomationInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceType: "VENDOR",
          status: "ACCOUNTING_REVIEW",
          entityNameRaw: "Fast Trucking",
          quickBooksEntityId: "qb-vendor-fast",
          quickBooksEntityDisplayName: "Fast Trucking",
          quickBooksMatchConfidence: expect.any(Number),
          invoiceNumber: "INV-100",
          shipmentFileNumber: "TR12345",
          dueDate: new Date("2026-07-31T00:00:00.000Z"),
          productOrAccountName: "5015 Trucking Rate",
          subtotalAmount: expect.any(Object),
          taxAmount: expect.any(Object),
          totalAmount: expect.any(Object),
          approvedByUserId: "user-1",
          approvedAt: expect.any(Date)
        })
      })
    );
  });

  it("vendor and customer workflows are separate routes, not tabs in one client", async () => {
    const clientSource = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/modules/vendor-invoice-review/components/vendor-invoice-review-client.tsx", "utf8")
    );
    const vendorPageSource = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/(authenticated)/operations/vendor-invoice-review/page.tsx", "utf8")
    );
    const customerPageSource = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/(authenticated)/operations/customer-invoice-intake/page.tsx", "utf8")
    );

    expect(clientSource).not.toContain("setInvoiceKind");
    expect(vendorPageSource).toContain('invoiceKind="Vendor_Invoices"');
    expect(customerPageSource).toContain('invoiceKind="Customer_Invoices"');
  });

  it("vendor page upload cannot create a customer record", async () => {
    const response = await saveVendorInvoiceReview(
      await buildSaveRequest(
        [
          refreshVendorInvoiceReviewDraftIssues({
            ...buildCompleteDraft("INV-100"),
            invoiceKind: "Customer_Invoices",
            confirmedTmsFileNumber: "TR12345"
          })
        ],
        { invoiceKind: "Customer_Invoices", approveAndStamp: true }
      )
    );

    expect(response.status).toBe(201);
    expect(mocks.tx.vendorInvoiceReviewDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceKind: "Vendor_Invoices" }) })
    );
    expect(mocks.tx.vendorInvoiceReviewInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceKind: "Vendor_Invoices" }) })
    );
  });

  it("saves customer invoices without approval stamp metadata", async () => {
    const response = await saveCustomerInvoiceIntake(
      await buildSaveRequest(
        [
          refreshVendorInvoiceReviewDraftIssues({
            ...buildCompleteDraft("INV-C100"),
            invoiceKind: "Customer_Invoices",
            confirmedTmsFileNumber: "TR12345"
          })
        ],
        { invoiceKind: "Customer_Invoices" }
      )
    );

    expect(response.status).toBe(201);
    expect(mocks.tx.vendorInvoiceReviewDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceKind: "Customer_Invoices",
          approvedAt: null,
          approvedByUserId: null,
          approvedByName: null
        })
      })
    );
    expect(mocks.tx.vendorInvoiceReviewInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceKind: "Customer_Invoices",
          tmsFileNumber: "TR12345"
        })
      })
    );
    expect(mocks.tx.invoiceAutomationInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceType: "CUSTOMER",
          status: "ACCOUNTING_REVIEW",
          entityNameRaw: "Fast Trucking",
          quickBooksEntityId: "qb-customer-fast",
          quickBooksEntityDisplayName: "Fast Trucking",
          quickBooksMatchConfidence: expect.any(Number),
          shipmentFileNumber: "TR12345",
          dueDate: new Date("2026-07-31T00:00:00.000Z"),
          productOrAccountName: "Trucking",
          approvedByUserId: null,
          approvedAt: null
        })
      })
    );
  });

  it("customer page upload cannot create a vendor record", async () => {
    const response = await saveCustomerInvoiceIntake(
      await buildSaveRequest(
        [
          refreshVendorInvoiceReviewDraftIssues({
            ...buildCompleteDraft("INV-C101"),
            invoiceKind: "Vendor_Invoices",
            confirmedTmsFileNumber: "TR12345"
          })
        ],
        { invoiceKind: "Vendor_Invoices" }
      )
    );

    expect(response.status).toBe(201);
    expect(mocks.tx.vendorInvoiceReviewDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceKind: "Customer_Invoices" }) })
    );
    expect(mocks.tx.vendorInvoiceReviewInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceKind: "Customer_Invoices" }) })
    );
  });

  it("leaves unresolved QuickBooks matches for Finance to correct", async () => {
    mocks.getInvoiceAutomationEntityOptions.mockResolvedValue([]);

    const response = await saveVendorInvoiceReview(
      await buildSaveRequest([
        refreshVendorInvoiceReviewDraftIssues({
          ...buildCompleteDraft("INV-NOQB"),
          confirmedTmsFileNumber: "TR12345"
        })
      ])
    );

    expect(response.status).toBe(201);
    expect(mocks.tx.invoiceAutomationInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quickBooksEntityId: null,
          quickBooksEntityDisplayName: null,
          quickBooksMatchConfidence: null,
          issueCodes: expect.arrayContaining(["MISSING_QB_MATCH"])
        })
      })
    );
  });

  it("rejects vendor invoices that were not explicitly approved for stamping", async () => {
    const response = await saveVendorInvoiceReview(
      await buildSaveRequest(
        [
          refreshVendorInvoiceReviewDraftIssues({
            ...buildCompleteDraft("INV-100"),
            confirmedTmsFileNumber: "TR12345"
          })
        ],
        { approveAndStamp: false }
      )
    );

    expect(response.status).toBe(422);
    expect(mocks.tx.vendorInvoiceReviewDocument.create).not.toHaveBeenCalled();
  });

  it("vendor approval stamps the PDF and keeps all original pages", async () => {
    const originalPdfBase64 = await createPdfBase64(2);
    const response = await saveVendorInvoiceReview(
      await buildSaveRequest(
        [
          refreshVendorInvoiceReviewDraftIssues({
            ...buildCompleteDraft("INV-100"),
            confirmedTmsFileNumber: "TR12345"
          })
        ],
        { pdfBase64: originalPdfBase64 }
      )
    );

    expect(response.status).toBe(201);
    const documentCreate = mocks.tx.vendorInvoiceReviewDocument.create.mock.calls.at(-1)?.[0];
    const stampedBytes = documentCreate.data.pdfBytes as Buffer;
    const stampedPdf = await PDFDocument.load(stampedBytes);

    expect(stampedPdf.getPageCount()).toBe(2);
    expect(documentCreate.data.approvedByName).toBe("Ops User");
    expect(documentCreate.data.approvedAt).toBeInstanceOf(Date);
    expect(mocks.tx.invoiceAutomationDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdfBytes: stampedBytes
        })
      })
    );
  });

  it("failed finance handoff preserves the operations record for retry", async () => {
    mocks.tx.invoiceAutomationInvoice.create.mockRejectedValueOnce(new Error("Finance write failed"));

    const response = await saveVendorInvoiceReview(
      await buildSaveRequest([
        refreshVendorInvoiceReviewDraftIssues({
          ...buildCompleteDraft("INV-FAIL"),
          confirmedTmsFileNumber: "TR12345"
        })
      ])
    );

    expect(response.status).toBe(201);
    expect(mocks.tx.vendorInvoiceReviewDocument.create).toHaveBeenCalled();
    expect(mocks.tx.vendorInvoiceReviewDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          financeStatus: "FINANCE_HANDOFF_FAILED",
          financeError: expect.stringContaining("Finance write failed")
        })
      })
    );
  });

  it("lists saved packages with invoice rows", async () => {
    mocks.prisma.vendorInvoiceReviewDocument.findMany.mockResolvedValue([
      {
      id: "document-1",
      invoiceKind: "Vendor_Invoices",
      fileName: "package.pdf",
      uploadedByUserId: "user-1",
      approvedAt: new Date("2026-07-20T12:05:00.000Z"),
      approvedByName: "Ops User",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
        invoices: [savedInvoiceRow()]
      }
    ]);
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "user-1", name: "Ops User", email: "ops@example.com" }]);

    const packages = await getVendorInvoiceReviewPackages(context);

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      fileName: "package.pdf",
      uploadedByName: "Ops User",
      invoiceCount: 1,
      status: "SAVED"
    });
    expect(packages[0].invoices[0]).toMatchObject({
      vendorName: "Fast Trucking",
      invoiceNumber: "INV-100",
      vendorReference: "AWB12345",
      tmsFileNumber: "TR12345"
    });
  });

  it("filters saved package lists by invoice type", async () => {
    await getVendorInvoiceReviewPackages(context, { invoiceKind: "Vendor_Invoices" });
    await getVendorInvoiceReviewPackages(context, { invoiceKind: "Customer_Invoices" });

    expect(mocks.prisma.vendorInvoiceReviewDocument.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { tenantId: "tenant-1", invoiceKind: "Vendor_Invoices" } })
    );
    expect(mocks.prisma.vendorInvoiceReviewDocument.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { tenantId: "tenant-1", invoiceKind: "Customer_Invoices" } })
    );
  });

  it("opens a saved package to review stored invoice rows", async () => {
    mocks.prisma.vendorInvoiceReviewDocument.findFirst.mockResolvedValue({
      id: "document-1",
      invoiceKind: "Vendor_Invoices",
      fileName: "package.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      extractedText: textInvoice,
      uploadedByUserId: "user-1",
      approvedAt: new Date("2026-07-20T12:05:00.000Z"),
      approvedByName: "Ops User",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      invoices: [savedInvoiceRow()]
    });
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "user-1", name: "Ops User", email: "ops@example.com" }]);

    const response = await openVendorInvoiceReviewPackage(new Request("https://newl.test"), {
      params: Promise.resolve({ documentId: "document-1" })
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.fileName).toBe("package.pdf");
    expect(json.invoices[0].invoiceNumber).toBe("INV-100");
  });

  it("downloads the original PDF bytes from a saved package", async () => {
    mocks.prisma.vendorInvoiceReviewDocument.findFirst.mockResolvedValue({
      fileName: "package.pdf",
      contentType: "application/pdf",
      invoiceKind: "Vendor_Invoices",
      approvedAt: new Date("2026-07-20T12:05:00.000Z"),
      pdfBytes: Buffer.from("%PDF-1.4")
    });

    const response = await downloadVendorInvoiceReviewPdf(new Request("https://newl.test"), {
      params: Promise.resolve({ documentId: "document-1" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("package.pdf");
    expect(await response.text()).toBe("%PDF-1.4");
  });

  it("downloads customer original PDF bytes from a saved package", async () => {
    mocks.prisma.vendorInvoiceReviewDocument.findFirst.mockResolvedValue({
      fileName: "customer.pdf",
      contentType: "application/pdf",
      invoiceKind: "Customer_Invoices",
      approvedAt: null,
      pdfBytes: Buffer.from("%PDF-customer")
    });

    const response = await downloadVendorInvoiceReviewPdf(new Request("https://newl.test"), {
      params: Promise.resolve({ documentId: "document-2" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("customer.pdf");
    expect(await response.text()).toBe("%PDF-customer");
  });

  it("does not call the existing OpenAI OCR route from the new workflow", async () => {
    const clientSource = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/modules/vendor-invoice-review/components/vendor-invoice-review-client.tsx", "utf8")
    );

    expect(clientSource).not.toContain("/api/finance/invoice-automation/ocr");
  });
});

function buildCompleteDraft(invoiceNumber: string) {
  return {
    clientId: invoiceNumber,
    documentClientId: "doc-1",
    invoiceKind: "Vendor_Invoices" as const,
    fileName: "package.pdf",
    vendorName: "Fast Trucking",
    invoiceNumber,
    invoiceDate: "2026-07-01",
    tmsFileNumber: "TR12345",
    confirmedTmsFileNumber: null,
    vendorReference: null,
    currency: "CAD",
    subtotalAmount: 100,
    taxAmount: 13,
    totalAmount: 113,
    issueCodes: ["CONFIRM_TMS_FILE_NUMBER"],
    duplicateWarning: null
  };
}

function savedInvoiceRow() {
  return {
    id: "invoice-1",
    documentId: "document-1",
    invoiceKind: "Vendor_Invoices",
    status: VendorInvoiceReviewStatus.SAVED,
    fileName: "package.pdf",
    vendorName: "Fast Trucking",
    invoiceNumber: "INV-100",
    invoiceDate: new Date("2026-07-01T00:00:00.000Z"),
    tmsFileNumber: "TR12345",
    vendorReference: "AWB12345",
    currency: "CAD",
    subtotalAmount: { toString: () => "100" },
    taxAmount: { toString: () => "13" },
    totalAmount: { toString: () => "113" },
    issueCodes: [],
    createdAt: new Date("2026-07-20T12:00:00.000Z")
  };
}

async function buildSaveRequest(
  invoices: ReturnType<typeof buildCompleteDraft>[],
  options: {
    invoiceKind?: "Vendor_Invoices" | "Customer_Invoices";
    approveAndStamp?: boolean;
    pdfBase64?: string;
  } = {}
) {
  const invoiceKind = options.invoiceKind ?? "Vendor_Invoices";
  const pdfBase64 = options.pdfBase64 ?? (await createPdfBase64(1));
  return new Request("https://newl.test/api/operations/vendor-invoice-review/uploads", {
    method: "POST",
    body: JSON.stringify({
      document: {
        clientDocumentId: "doc-1",
        invoiceKind,
        fileName: "package.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        pdfBase64,
        extractedText: textInvoice
      },
      invoices,
      invoiceKind,
      approveAndStamp: options.approveAndStamp ?? invoiceKind === "Vendor_Invoices"
    })
  });
}

async function createPdfBase64(pageCount: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([300, 200]);
    page.drawText(`Page ${index + 1}`, { x: 30, y: 150, size: 12, font });
  }
  const bytes = await pdf.save();
  return `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
}
