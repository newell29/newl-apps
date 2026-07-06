import type { ShipmentDocumentHistoryResponse, ShipmentDocumentRunSummary } from "@/modules/shipment-documents/types";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { prisma } from "@/server/db";

const WORKFLOW_KEY = "GARLAND_CANADA";

type ShipmentDocumentRunQueryClient = typeof prisma & {
  shipmentDocumentRun: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, "asc" | "desc">>;
      take: number;
      select: Record<string, unknown>;
    }): Promise<ShipmentDocumentRunRecord[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

type ShipmentDocumentRunRecord = {
  id: string;
  workflowKey: string;
  documentLabel: string;
  shipmentDate: Date;
  recipientEmail: string | null;
  sourceBolFileName: string | null;
  sourcePickTicketFileName: string | null;
  outputBolFileName: string;
  outputPickTicketFileName: string;
  bolPageCount: number;
  pickTicketPageCount: number;
  bolAiFallbackPageCount: number;
  pickAiFallbackPageCount: number;
  bolPsNumbers: unknown;
  pickPsNumbers: unknown;
  createdAt: Date;
  createdBy: {
    name: string | null;
    email: string;
  } | null;
};

export async function getShipmentDocumentRunHistory(
  context: AuthenticatedContext,
  filters: {
    search?: string;
    take?: number;
  } = {}
): Promise<ShipmentDocumentHistoryResponse> {
  const search = filters.search?.trim() ?? "";
  const take = Math.min(100, Math.max(1, filters.take ?? 40));
  const where = buildShipmentDocumentRunWhere(context.tenantId, search);
  const client = prisma as ShipmentDocumentRunQueryClient;

  const [runs, totalCount] = await Promise.all([
    client.shipmentDocumentRun.findMany({
      where,
      orderBy: [{ shipmentDate: "desc" }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        workflowKey: true,
        documentLabel: true,
        shipmentDate: true,
        recipientEmail: true,
        sourceBolFileName: true,
        sourcePickTicketFileName: true,
        outputBolFileName: true,
        outputPickTicketFileName: true,
        bolPageCount: true,
        pickTicketPageCount: true,
        bolAiFallbackPageCount: true,
        pickAiFallbackPageCount: true,
        bolPsNumbers: true,
        pickPsNumbers: true,
        createdAt: true,
        createdBy: {
          select: {
            name: true,
            email: true
          }
        }
      }
    }),
    client.shipmentDocumentRun.count({ where })
  ]);

  return {
    runs: runs.map(mapShipmentDocumentRunSummary),
    totalCount,
    search
  };
}

export function mapShipmentDocumentRunSummary(record: ShipmentDocumentRunRecord): ShipmentDocumentRunSummary {
  return {
    id: record.id,
    workflowKey: record.workflowKey,
    documentLabel: record.documentLabel,
    shipmentDate: record.shipmentDate.toISOString(),
    recipientEmail: record.recipientEmail,
    sourceBolFileName: record.sourceBolFileName,
    sourcePickTicketFileName: record.sourcePickTicketFileName,
    outputBolFileName: record.outputBolFileName,
    outputPickTicketFileName: record.outputPickTicketFileName,
    bolPageCount: record.bolPageCount,
    pickTicketPageCount: record.pickTicketPageCount,
    bolAiFallbackPageCount: record.bolAiFallbackPageCount,
    pickAiFallbackPageCount: record.pickAiFallbackPageCount,
    bolPsNumbers: readStringArray(record.bolPsNumbers),
    pickPsNumbers: readStringArray(record.pickPsNumbers),
    createdAt: record.createdAt.toISOString(),
    createdByName: record.createdBy?.name?.trim() || record.createdBy?.email || null
  };
}

export function buildShipmentDocumentRunSearchText(input: {
  documentLabel: string;
  shipmentDate: string;
  recipientEmail?: string | null;
  sourceBolFileName?: string | null;
  sourcePickTicketFileName?: string | null;
  bolPsNumbers: string[];
  pickPsNumbers: string[];
}) {
  return [
    input.documentLabel,
    input.shipmentDate,
    input.recipientEmail ?? "",
    input.sourceBolFileName ?? "",
    input.sourcePickTicketFileName ?? "",
    input.bolPsNumbers.join(" "),
    input.pickPsNumbers.join(" ")
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildShipmentDocumentRunWhere(
  tenantId: string,
  search: string
): Record<string, unknown> {
  const trimmedSearch = search.trim();

  return {
    tenantId,
    workflowKey: WORKFLOW_KEY,
    ...(trimmedSearch
      ? {
          OR: [
            { documentLabel: { contains: trimmedSearch, mode: "insensitive" } },
            { recipientEmail: { contains: trimmedSearch, mode: "insensitive" } },
            { sourceBolFileName: { contains: trimmedSearch, mode: "insensitive" } },
            { sourcePickTicketFileName: { contains: trimmedSearch, mode: "insensitive" } },
            { searchText: { contains: trimmedSearch, mode: "insensitive" } }
          ]
        }
      : {})
  };
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}
