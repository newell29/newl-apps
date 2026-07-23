import { searchTradeMining, type TradeMiningExcelRow } from "@/server/integrations/trademining";

const SEARCH_FIELDS = {
  customer: "ConsigneeName",
  agent: "MasterShipperName"
} as const;

export type TradeMiningCustomerIntelligenceResult = {
  searchStarted: boolean;
  searchSucceeded: boolean;
  customerNameSearched: string | null;
  customerType: "customer" | "agent";
  searchField: "ConsigneeName" | "MasterShipperName";
  dateRange: { start: string; end: string };
  totalShipmentRecordsFound: number;
  searchId: string | null;
  warning: string | null;
  fieldsUsed: string[];
  summary: Record<string, string | number | string[] | null>;
  recentRecords: Record<string, string>[];
  workbookAttachment: { fileName: string; content: Buffer } | null;
};

export async function enrichShipmentInquiryCustomerWithTradeMining(
  customerName: string | null | undefined,
  customerType: "customer" | "agent" = "customer",
  today = new Date()
): Promise<TradeMiningCustomerIntelligenceResult> {
  const dateRange = buildTrailingSixMonthDateRange(today);
  const trimmedCustomerName = customerName?.trim() || null;
  const searchField = SEARCH_FIELDS[customerType];

  if (!trimmedCustomerName) {
    return warningResult(trimmedCustomerName, customerType, searchField, dateRange, "TradeMining skipped because no customer name was available.");
  }

  try {
    const result = await searchTradeMining(
      {
        [searchField]: trimmedCustomerName,
        TradeStartDate: dateRange.start,
        TradeEndDate: dateRange.end
      },
      { saveWorkbook: false }
    );
    const rows = sortRowsByArrival(result.rows);
    const fieldsUsed = findExistingFields(rows);
    return {
      searchStarted: true,
      searchSucceeded: true,
      customerNameSearched: trimmedCustomerName,
      customerType,
      searchField,
      dateRange,
      totalShipmentRecordsFound: rows.length,
      searchId: result.searchId,
      warning: rows.length === 0 ? "TradeMining search succeeded, but no shipment records were found." : null,
      fieldsUsed,
      summary: summarizeRows(rows),
      recentRecords: rows.slice(0, 5).map((row) => pickFields(row, fieldsUsed)),
      workbookAttachment: {
        fileName: buildWorkbookFileName(result.searchId, result.exportFileName),
        content: result.rawWorkbook
      }
    };
  } catch (error) {
    return warningResult(
      trimmedCustomerName,
      customerType,
      searchField,
      dateRange,
      `TradeMining customer enrichment failed: ${error instanceof Error ? error.message : "Unknown error."}`
    );
  }
}

export function buildSkippedTradeMiningForLtl(customerName: string, customerType: "customer" | "agent"): TradeMiningCustomerIntelligenceResult {
  return warningResult(customerName, customerType, SEARCH_FIELDS[customerType], { start: "", end: "" }, "TradeMining skipped for LTL inquiry. 7L rating is used for LTL after the TMS quote is created.");
}

function warningResult(customerName: string | null, customerType: "customer" | "agent", searchField: "ConsigneeName" | "MasterShipperName", dateRange: { start: string; end: string }, warning: string): TradeMiningCustomerIntelligenceResult {
  return {
    searchStarted: Boolean(customerName),
    searchSucceeded: false,
    customerNameSearched: customerName,
    customerType,
    searchField,
    dateRange,
    totalShipmentRecordsFound: 0,
    searchId: null,
    warning,
    fieldsUsed: [],
    summary: {},
    recentRecords: [],
    workbookAttachment: null
  };
}

function buildTrailingSixMonthDateRange(today: Date) {
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 6);
  return { start: formatDate(startDate), end: formatDate(endDate) };
}

function formatDate(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function findExistingFields(rows: TradeMiningExcelRow[]) {
  const candidates = ["Arrival Date", "Country Of Origin", "Consignee Name", "Shipper Name", "Container Content", "Container Count", "US Arrival Port", "Foreign Port", "Place Of Receipt", "Bill Type", "Carrier Name", "Vessel Name", "Container Load", "Containerized"];
  return candidates.filter((field) => rows.some((row) => row[field]));
}

function summarizeRows(rows: TradeMiningExcelRow[]) {
  return {
    latestArrivalDate: rows[0]?.["Arrival Date"] ?? null,
    topOrigins: topValues(rows, "Country Of Origin"),
    topShippers: topValues(rows, "Shipper Name"),
    topCommodities: topValues(rows, "Container Content")
  };
}

function topValues(rows: TradeMiningExcelRow[], field: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[field]?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value]) => value);
}

function pickFields(row: TradeMiningExcelRow, fields: string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? ""]));
}

function sortRowsByArrival(rows: TradeMiningExcelRow[]) {
  return [...rows].sort((left, right) => Date.parse(right["Arrival Date"] ?? "") - Date.parse(left["Arrival Date"] ?? ""));
}

function buildWorkbookFileName(searchId: string, exportFileName: string | null) {
  const base = exportFileName?.trim() || `trademining-search-${searchId}.xlsx`;
  return base.toLowerCase().endsWith(".xlsx") ? base : `${base}.xlsx`;
}
