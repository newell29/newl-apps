import { createHash } from "node:crypto";

import { ModuleKey } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedContext: vi.fn(),
  requireModule: vi.fn(),
  findFirst: vi.fn()
}));

vi.mock("@/server/tenant-context", () => ({ getAuthenticatedContext: mocks.getAuthenticatedContext }));
vi.mock("@/server/auth/authorization", () => ({ requireModule: mocks.requireModule }));
vi.mock("@/server/db", () => ({ prisma: { tmgOrderIntakeOrder: { findFirst: mocks.findFirst } } }));

import { GET } from "@/app/api/operations/tmg-order-intake/batches/[batchId]/orders/[orderId]/document/route";

describe("TMG consolidated PDF review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedContext.mockResolvedValue({ tenantId: "tenant-example", userId: "user-example" });
    mocks.requireModule.mockResolvedValue(undefined);
  });

  it("returns only the hash-verified PDF from the authenticated tenant, batch, and order", async () => {
    const bytes = Buffer.from("%PDF-1.7\nsynthetic consolidated packet");
    mocks.findFirst.mockResolvedValue({
      combinedPdfFileName: "TMG PS123456.pdf",
      combinedPdfHash: createHash("sha256").update(bytes).digest("hex"),
      combinedPdfBytes: bytes
    });

    const response = await GET(new Request("https://newl.test/api/example"), {
      params: Promise.resolve({ batchId: "batch-example", orderId: "order-example" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="TMG PS123456.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.requireModule).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-example" }), ModuleKey.SHIPMENT_DOCUMENTS);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        id: "order-example",
        batchId: "batch-example",
        tenantId: "tenant-example",
        batch: { tenantId: "tenant-example" }
      },
      select: {
        combinedPdfFileName: true,
        combinedPdfHash: true,
        combinedPdfBytes: true
      }
    });
  });

  it("returns not found when no tenant-scoped document exists", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await GET(new Request("https://newl.test/api/example"), {
      params: Promise.resolve({ batchId: "other-batch", orderId: "other-order" })
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "TMG consolidated PDF not found." });
  });

  it("refuses stored bytes whose PDF signature or approved hash does not match", async () => {
    mocks.findFirst.mockResolvedValue({
      combinedPdfFileName: "TMG PS123456.pdf",
      combinedPdfHash: "a".repeat(64),
      combinedPdfBytes: Buffer.from("%PDF-1.7\ntampered")
    });

    const response = await GET(new Request("https://newl.test/api/example"), {
      params: Promise.resolve({ batchId: "batch-example", orderId: "order-example" })
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "TMG consolidated PDF failed integrity verification." });
  });
});
