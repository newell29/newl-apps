import { beforeEach, describe, expect, it, vi } from "vitest";

const getGarlandCarrierManifestHistoryMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  shipmentCarrierManifestRun: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock("@/modules/shipment-documents/carrier-manifest-queries", () => ({
  getGarlandCarrierManifestHistory: getGarlandCarrierManifestHistoryMock
}));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    role: "OPERATIONS",
    tenantSlug: "newl",
    tenantName: "Newl"
  }))
}));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: vi.fn(async () => undefined),
  requireMutationAccess: vi.fn(async () => undefined)
}));

import { POST } from "@/app/api/shipment-documents/carrier-manifest/runs/route";
import { GET } from "@/app/api/shipment-documents/carrier-manifest/runs/[runId]/route";

describe("Carrier manifest saved runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shipmentCarrierManifestRun.create.mockResolvedValue({ id: "run-1" });
    getGarlandCarrierManifestHistoryMock.mockResolvedValue({ runs: [], totalCount: 1 });
  });

  it("stores a separate Clarke workbook and count in the tenant-scoped run", async () => {
    const workbookBytes = Buffer.from("synthetic Clarke workbook");
    const response = await POST(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate: "2026-07-30",
          documentLabel: "July 30, 2026",
          sourceBolFileName: "synthetic-bols.pdf",
          rows: [
            {
              carrier: "CLARKE",
              pageNumber: 1,
              srNumber: "812345",
              psNumber: "PS123456",
              cityProvince: "EDMONTON, AB",
              skids: 1,
              confidence: "HIGH",
              notes: null
            }
          ],
          workbooks: {
            CLARKE: {
              fileName: "Clarke Manifest July 30, 2026.xls",
              base64: workbookBytes.toString("base64")
            }
          }
        })
      })
    );

    expect(response.status).toBe(201);
    expect(prismaMock.shipmentCarrierManifestRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        carrierCounts: {
          MIDLAND: 0,
          SPEEDY: 0,
          SURETRACK: 0,
          CLARKE: 1,
          GUILBAULT: 0,
          ROSEDALE: 0
        },
        clarkeFileName: "Clarke Manifest July 30, 2026.xls",
        clarkeWorkbookBytes: workbookBytes
      })
    });
  });

  it("downloads only the Clarke workbook from the requested tenant run", async () => {
    const workbookBytes = Buffer.from("synthetic Clarke workbook");
    prismaMock.shipmentCarrierManifestRun.findFirst.mockResolvedValue({
      clarkeFileName: "Clarke Manifest July 30, 2026.xls",
      clarkeWorkbookBytes: workbookBytes
    });

    const response = await GET(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1?documentType=clarke"),
      { params: Promise.resolve({ runId: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.ms-excel");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="Clarke Manifest July 30, 2026.xls"'
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(workbookBytes);
    expect(prismaMock.shipmentCarrierManifestRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-1",
          tenantId: "tenant-1",
          deletedAt: null
        },
        select: expect.objectContaining({
          clarkeFileName: true,
          clarkeWorkbookBytes: true
        })
      })
    );
  });

  it("stores a separate Guilbault workbook and count in the tenant-scoped run", async () => {
    const workbookBytes = Buffer.from("synthetic Guilbault workbook");
    const response = await POST(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate: "2026-08-04",
          documentLabel: "August 4, 2026",
          sourceBolFileName: "synthetic-bols.pdf",
          rows: [
            {
              carrier: "GUILBAULT",
              pageNumber: 1,
              srNumber: "812345",
              psNumber: "PS123456",
              cityProvince: "MONTREAL, QC",
              skids: 2,
              confidence: "HIGH",
              notes: null
            }
          ],
          workbooks: {
            GUILBAULT: {
              fileName: "Guilbault Transport Manifest August 4, 2026.xls",
              base64: workbookBytes.toString("base64")
            }
          }
        })
      })
    );

    expect(response.status).toBe(201);
    expect(prismaMock.shipmentCarrierManifestRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        carrierCounts: {
          MIDLAND: 0,
          SPEEDY: 0,
          SURETRACK: 0,
          CLARKE: 0,
          GUILBAULT: 1,
          ROSEDALE: 0
        },
        guilbaultFileName: "Guilbault Transport Manifest August 4, 2026.xls",
        guilbaultWorkbookBytes: workbookBytes
      })
    });
  });

  it("downloads only the Guilbault workbook from the requested tenant run", async () => {
    const workbookBytes = Buffer.from("synthetic Guilbault workbook");
    prismaMock.shipmentCarrierManifestRun.findFirst.mockResolvedValue({
      guilbaultFileName: "Guilbault Transport Manifest August 4, 2026.xls",
      guilbaultWorkbookBytes: workbookBytes
    });

    const response = await GET(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1?documentType=guilbault"),
      { params: Promise.resolve({ runId: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.ms-excel");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="Guilbault Transport Manifest August 4, 2026.xls"'
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(workbookBytes);
    expect(prismaMock.shipmentCarrierManifestRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-1",
          tenantId: "tenant-1",
          deletedAt: null
        },
        select: expect.objectContaining({
          guilbaultFileName: true,
          guilbaultWorkbookBytes: true
        })
      })
    );
  });

  it("stores a separate Rosedale workbook and count in the tenant-scoped run", async () => {
    const workbookBytes = Buffer.from("synthetic Rosedale workbook");
    const response = await POST(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate: "2026-08-11",
          documentLabel: "August 11, 2026",
          sourceBolFileName: "synthetic-bols.pdf",
          rows: [
            {
              carrier: "ROSEDALE",
              pageNumber: 1,
              srNumber: "812345",
              psNumber: "PS123456",
              cityProvince: "OTTAWA, ON",
              skids: 1,
              confidence: "HIGH",
              notes: null
            }
          ],
          workbooks: {
            ROSEDALE: {
              fileName: "Rosedale Manifest August 11, 2026.xls",
              base64: workbookBytes.toString("base64")
            }
          }
        })
      })
    );

    expect(response.status).toBe(201);
    expect(prismaMock.shipmentCarrierManifestRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        carrierCounts: {
          MIDLAND: 0,
          SPEEDY: 0,
          SURETRACK: 0,
          CLARKE: 0,
          GUILBAULT: 0,
          ROSEDALE: 1
        },
        rosedaleFileName: "Rosedale Manifest August 11, 2026.xls",
        rosedaleWorkbookBytes: workbookBytes
      })
    });
  });

  it("downloads only the Rosedale workbook from the requested tenant run", async () => {
    const workbookBytes = Buffer.from("synthetic Rosedale workbook");
    prismaMock.shipmentCarrierManifestRun.findFirst.mockResolvedValue({
      rosedaleFileName: "Rosedale Manifest August 11, 2026.xls",
      rosedaleWorkbookBytes: workbookBytes
    });

    const response = await GET(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1?documentType=rosedale"),
      { params: Promise.resolve({ runId: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.ms-excel");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="Rosedale Manifest August 11, 2026.xls"'
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(workbookBytes);
    expect(prismaMock.shipmentCarrierManifestRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-1",
          tenantId: "tenant-1",
          deletedAt: null
        },
        select: expect.objectContaining({
          rosedaleFileName: true,
          rosedaleWorkbookBytes: true
        })
      })
    );
  });
});
