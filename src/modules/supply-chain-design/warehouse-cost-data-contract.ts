import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";

type DataContractFile = {
  tableType: string;
  fileBytes: Buffer;
  fieldMappings: Array<{ standardField: string; sourceColumn: string }>;
};

export type CandidateWarehouseCostContractRow = {
  candidateFacilityId: string;
  inboundFeePerPallet: number | null;
  outboundFeePerPallet: number | null;
  storageFeePerPalletPerMonth: number | null;
};

export type HistoricalShipmentWarehouseCostContractRow = {
  shipmentReference: string;
  inventoryDwellTimeDays: number | null;
};

export type WarehouseCostPreparedRequestProfileSource = {
  rateRequestKey: string;
  representedShipments: number;
  representativePallets: number | null;
  historicalShipmentRowIds: string[];
  shipmentOrderReferences: string[];
};

export function parseOptionalNonNegativeWarehouseCostNumber(
  value: string | undefined,
  fieldLabel: string,
  tableType: string
): number | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${tableType} ${fieldLabel} value "${trimmed}" is not a valid number.`);
  }
  if (parsed < 0) {
    throw new Error(`${tableType} ${fieldLabel} cannot be negative.`);
  }

  return parsed;
}

export function readCandidateWarehouseCostContractRows(file: DataContractFile): CandidateWarehouseCostContractRow[] {
  const rows = readMappedRows(file);
  return rows.map((row) => ({
    candidateFacilityId: row.candidate_facility_id?.trim() ?? "",
    inboundFeePerPallet: parseOptionalNonNegativeWarehouseCostNumber(
      row.inbound_fee_per_pallet,
      "inbound_fee_per_pallet",
      file.tableType
    ),
    outboundFeePerPallet: parseOptionalNonNegativeWarehouseCostNumber(
      row.outbound_fee_per_pallet,
      "outbound_fee_per_pallet",
      file.tableType
    ),
    storageFeePerPalletPerMonth: parseOptionalNonNegativeWarehouseCostNumber(
      row.storage_fee_per_pallet_per_month,
      "storage_fee_per_pallet_per_month",
      file.tableType
    )
  }));
}

export function readHistoricalShipmentWarehouseCostContractRows(file: DataContractFile): HistoricalShipmentWarehouseCostContractRow[] {
  const rows = readMappedRows(file);
  return rows.map((row) => ({
    shipmentReference: row.shipment_id?.trim() || row.shipment_reference?.trim() || "",
    inventoryDwellTimeDays: parseOptionalNonNegativeWarehouseCostNumber(
      row.inventory_dwell_time_days,
      "inventory_dwell_time_days",
      file.tableType
    )
  }));
}

export function buildWarehouseCostProfilesFromPreparedRequests(input: {
  preparedRequests: WarehouseCostPreparedRequestProfileSource[];
  shipmentFileId: string;
  shipmentWarehouseCostRows: HistoricalShipmentWarehouseCostContractRow[];
}) {
  const dwellBySourceRowId = new Map(
    input.shipmentWarehouseCostRows.map((row, index) => [`${input.shipmentFileId}:row-${index + 2}`, row.inventoryDwellTimeDays])
  );

  return Object.fromEntries(input.preparedRequests.map((request) => [
    request.rateRequestKey,
    {
      profileKey: request.rateRequestKey,
      representedShipments: request.representedShipments,
      representativePallets: request.representativePallets,
      inventoryDwellTimeDays: firstAvailableDwell(request.historicalShipmentRowIds.map((sourceRowId) => dwellBySourceRowId.get(sourceRowId) ?? null)),
      sourceLineage: request.historicalShipmentRowIds.map((sourceRowId, index) => ({
        sourceRowId,
        shipmentReference: request.shipmentOrderReferences[index] ?? request.rateRequestKey,
        representedShipments: request.representedShipments
      }))
    }
  ]));
}

function firstAvailableDwell(values: Array<number | null>) {
  const found = values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
  return found ?? null;
}

function readMappedRows(file: DataContractFile): Array<Record<string, string>> {
  const [headers = [], ...rows] = parseCsvRows(file.fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headerIndexByName = new Map(headers.map((header, index) => [header, index]));
  const mappingByField = new Map(file.fieldMappings.map((mapping) => [mapping.standardField, mapping.sourceColumn]));

  return rows.map((row) => {
    const mappedRow: Record<string, string> = {};
    for (const [standardField, sourceColumn] of mappingByField.entries()) {
      const index = headerIndexByName.get(sourceColumn);
      if (index === undefined) {
        throw new Error(`${file.tableType} mapped source column "${sourceColumn}" was not found in the CSV headers.`);
      }
      mappedRow[standardField] = row[index] ?? "";
    }
    return mappedRow;
  });
}
