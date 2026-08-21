import { beforeEach, describe, expect, it, vi } from "vitest";

const batchTable = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() }));
const attachmentTable = vi.hoisted(() => ({ updateMany: vi.fn() }));
const orderTable = vi.hoisted(() => ({ deleteMany: vi.fn(), create: vi.fn() }));
const jobTable = vi.hoisted(() => ({ create: vi.fn() }));
const auditTable = vi.hoisted(() => ({ create: vi.fn() }));
const prepareBatch = vi.hoisted(() => vi.fn());
const getSettings = vi.hoisted(() => vi.fn());
const createReadSession = vi.hoisted(() => vi.fn());
const findOrders = vi.hoisted(() => vi.fn());
const buildPlan = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: {
    tmgOrderIntakeBatch: batchTable,
    tmgOrderIntakeAttachment: attachmentTable,
    tmgOrderIntakeOrder: orderTable,
    tmgTeamshipExecutionJob: jobTable,
    auditLog: auditTable,
    $transaction: (callback: (transaction: unknown) => unknown) => callback({
      tmgOrderIntakeBatch: batchTable,
      tmgOrderIntakeAttachment: attachmentTable,
      tmgOrderIntakeOrder: orderTable,
      tmgTeamshipExecutionJob: jobTable,
      auditLog: auditTable
    })
  }
}));
vi.mock("@/modules/shipment-documents/tmg-pdf-intake", () => ({ prepareTmgEmailBatch: prepareBatch }));
vi.mock("@/modules/shipment-documents/tmg-settings", () => ({ getTmgOrderIntakeSettings: getSettings }));
vi.mock("@/modules/shipment-documents/tmg-teamship-create", () => ({
  buildTmgTeamshipCreatePlan: buildPlan,
  hasExactTmgTeamshipReference: vi.fn(() => false)
}));
vi.mock("@/server/integrations/teamship", () => ({
  createTeamshipReadSession: createReadSession,
  findTeamshipShippingOrders: findOrders
}));

import { reprocessTmgOrderIntakeBatch } from "@/modules/shipment-documents/tmg-email-intake";

const context = {
  tenantId: "tenant-example",
  userId: "user-example"
} as Parameters<typeof reprocessTmgOrderIntakeBatch>[0];

describe("TMG saved-batch reprocessing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchTable.findFirst.mockResolvedValue(savedBatch());
    batchTable.updateMany.mockResolvedValue({ count: 1 });
    batchTable.update.mockResolvedValue({ id: "batch-example" });
    batchTable.findUniqueOrThrow.mockResolvedValue({ id: "batch-example", status: "READY_FOR_APPROVAL" });
    attachmentTable.updateMany.mockResolvedValue({ count: 1 });
    orderTable.deleteMany.mockResolvedValue({ count: 1 });
    orderTable.create.mockResolvedValue({
      id: "order-example",
      planRequestHash: "plan-hash",
      combinedPdfHash: "packet-hash",
      status: "READY_FOR_APPROVAL"
    });
    jobTable.create.mockResolvedValue({ id: "job-example" });
    auditTable.create.mockResolvedValue({ id: "audit-example" });
    getSettings.mockResolvedValue({ teamship: teamshipProfile() });
    createReadSession.mockResolvedValue({ id: "read-session" });
    findOrders.mockResolvedValue([]);
    prepareBatch.mockResolvedValue(preparedBatch());
    buildPlan.mockResolvedValue(teamshipPlan());
  });

  it("replaces only tenant-scoped unapproved evidence and creates a fresh pending approval", async () => {
    await reprocessTmgOrderIntakeBatch(context, "batch-example");

    expect(batchTable.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "batch-example", tenantId: "tenant-example" }
    }));
    expect(batchTable.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "batch-example", tenantId: "tenant-example", approvedAt: null })
    }));
    expect(orderTable.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-example", batchId: "batch-example" } });
    expect(attachmentTable.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-example", batchId: "batch-example" }),
      data: { documentRole: "SELF_PICKUP_PACKET" }
    }));
    expect(orderTable.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant-example",
        batchId: "batch-example",
        packingSlip: expect.objectContaining({ fulfillmentType: "SELF_PICKUP" })
      })
    }));
    expect(jobTable.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-example", batchId: "batch-example", status: "PENDING_APPROVAL" })
    }));
  });

  it("does not reprocess a batch that already has an approval plan", async () => {
    batchTable.findFirst.mockResolvedValue({ ...savedBatch(), executionJob: { id: "job-example", status: "PENDING_APPROVAL" } });

    await expect(reprocessTmgOrderIntakeBatch(context, "batch-example")).rejects.toThrow("already has an approval plan");
    expect(prepareBatch).not.toHaveBeenCalled();
    expect(batchTable.updateMany).not.toHaveBeenCalled();
  });
});

function savedBatch() {
  return {
    id: "batch-example",
    tenantId: "tenant-example",
    status: "NEEDS_REVIEW",
    approvedAt: null,
    updatedAt: new Date("2026-08-18T14:00:00.000Z"),
    readyOrderCount: 0,
    invalidOrderCount: 1,
    executionJob: null,
    attachments: [{
      id: "attachment-example",
      tenantId: "tenant-example",
      batchId: "batch-example",
      graphAttachmentId: "graph-attachment-example",
      fileName: "pickup-order.pdf",
      contentType: "application/pdf",
      fileBytes: Buffer.from("synthetic-pdf"),
      isDuplicate: false
    }],
    orders: [{ teamshipCreateStatus: "NOT_STARTED", documentUploadStatus: "NOT_STARTED" }]
  };
}

function preparedBatch() {
  return {
    duplicatePdfCount: 0,
    batchIssues: [],
    orders: [{
      customerReference: "US19999",
      fulfillmentType: "SELF_PICKUP",
      packingSlip: {
        customerReference: "US19999",
        orderDate: "2026-08-18",
        shipTo: {
          name: "Synthetic Recipient",
          address: "123 Example Way",
          city: "Example City",
          state: "NY",
          postalCode: "12345",
          countryCode: "US",
          phone: "+1 212-555-0100",
          email: null
        },
        items: [{ sku: "TMG-EXAMPLE-1", quantity: 1 }],
        deliveryNotes: null,
        sourceAttachmentId: "graph-attachment-example",
        sourceFileName: "pickup-order.pdf",
        sourcePageNumber: 3,
        sourceText: "synthetic"
      },
      picklist: null,
      bol: null,
      label: null,
      warehouseInstructions: null,
      deliveryNotesExcludedFromTeamship: true,
      combinedPdfFileName: "TMG US19999.pdf",
      combinedPdfBytes: new Uint8Array([37, 80, 68, 70, 45]),
      combinedPdfHash: "packet-hash",
      validationIssues: [],
      readyForApproval: true
    }]
  };
}

function teamshipProfile() {
  return {
    customerId: "1001",
    customerName: "Synthetic Customer",
    warehouseId: "2001",
    warehouseName: "Synthetic Warehouse",
    inventoryUserId: "1001",
    inventoryLocationId: "3001",
    carrierName: "Synthetic LTL"
  };
}

function teamshipPlan() {
  return {
    workflowKey: "TMG_TEAMSHIP_CREATE_V1",
    customerReference: "US19999",
    fulfillmentType: "SELF_PICKUP",
    packetHash: "packet-hash",
    payload: {},
    products: [],
    requestHash: "plan-hash"
  };
}
