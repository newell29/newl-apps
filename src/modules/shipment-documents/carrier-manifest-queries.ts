import type {
  GarlandCarrierKey,
  GarlandCarrierManifestHistoryResponse,
  GarlandCarrierManifestRunSummary
} from "@/modules/shipment-documents/carrier-manifest-types";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const WORKFLOW_KEY = "GARLAND_CARRIER_MANIFEST";
const CARRIERS: GarlandCarrierKey[] = ["MIDLAND", "SPEEDY", "SURETRACK"];

type CarrierManifestRunQueryClient = typeof prisma & {
  shipmentCarrierManifestRun: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, "asc" | "desc">>;
      take: number;
      select: Record<string, unknown>;
    }): Promise<CarrierManifestRunRecord[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

type CarrierManifestRunRecord = {
  id: string;
  documentLabel: string;
  shipmentDate: Date;
  sourceBolFileName: string | null;
  carrierCounts: unknown;
  midlandWorkbookBytes: Uint8Array | null;
  speedyWorkbookBytes: Uint8Array | null;
  suretrackWorkbookBytes: Uint8Array | null;
  signedCopyFileName: string | null;
  signedCopyUploadedAt: Date | null;
  createdAt: Date;
  createdBy: {
    name: string | null;
    email: string;
  } | null;
};

export async function getGarlandCarrierManifestHistory(
  context: AuthenticatedContext,
  filters: { take?: number } = {}
): Promise<GarlandCarrierManifestHistoryResponse> {
  const take = Math.min(100, Math.max(1, filters.take ?? 40));
  const where = {
    tenantId: context.tenantId,
    workflowKey: WORKFLOW_KEY,
    deletedAt: null
  };
  const client = prisma as CarrierManifestRunQueryClient;

  const [runs, totalCount] = await Promise.all([
    client.shipmentCarrierManifestRun.findMany({
      where,
      orderBy: [{ shipmentDate: "desc" }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        documentLabel: true,
        shipmentDate: true,
        sourceBolFileName: true,
        carrierCounts: true,
        midlandWorkbookBytes: true,
        speedyWorkbookBytes: true,
        suretrackWorkbookBytes: true,
        signedCopyFileName: true,
        signedCopyUploadedAt: true,
        createdAt: true,
        createdBy: {
          select: {
            name: true,
            email: true
          }
        }
      }
    }),
    client.shipmentCarrierManifestRun.count({ where })
  ]);

  return {
    runs: runs.map(mapGarlandCarrierManifestRunSummary),
    totalCount
  };
}

function mapGarlandCarrierManifestRunSummary(record: CarrierManifestRunRecord): GarlandCarrierManifestRunSummary {
  return {
    id: record.id,
    documentLabel: record.documentLabel,
    shipmentDate: record.shipmentDate.toISOString(),
    sourceBolFileName: record.sourceBolFileName,
    carrierCounts: readCarrierCounts(record.carrierCounts),
    createdAt: record.createdAt.toISOString(),
    createdByName: record.createdBy?.name?.trim() || record.createdBy?.email || null,
    hasMidlandWorkbook: Boolean(record.midlandWorkbookBytes),
    hasSpeedyWorkbook: Boolean(record.speedyWorkbookBytes),
    hasSuretrackWorkbook: Boolean(record.suretrackWorkbookBytes),
    signedCopyFileName: record.signedCopyFileName,
    signedCopyUploadedAt: record.signedCopyUploadedAt?.toISOString() ?? null
  };
}

function readCarrierCounts(value: unknown): Record<GarlandCarrierKey, number> {
  const counts: Record<GarlandCarrierKey, number> = {
    MIDLAND: 0,
    SPEEDY: 0,
    SURETRACK: 0
  };

  if (!value || typeof value !== "object") {
    return counts;
  }

  const record = value as Record<string, unknown>;
  for (const carrier of CARRIERS) {
    counts[carrier] = typeof record[carrier] === "number" ? record[carrier] : 0;
  }

  return counts;
}
