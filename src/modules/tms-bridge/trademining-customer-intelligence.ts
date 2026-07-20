import {
  searchTradeMining,
  type TradeMiningExcelRow
} from "../../server/integrations/trademining";

const CUSTOMER_SEARCH_FIELDS = {
  customer: "ConsigneeName",
  agent: "MasterShipperName"
} as const;
const MAX_RECENT_RECORDS = 5;

const REVIEW_FIELD_CANDIDATES = [
  "Arrival Date",
  "Country Of Origin",
  "Consignee Name",
  "Shipper Name",
  "Notify Name",
  "Container Content",
  "Container Count",
  "US Arrival Port",
  "Foreign Port",
  "Place Of Receipt",
  "Bill Type",
  "Carrier Name",
  "Vessel Name",
  "Container Load",
  "Containerized"
] as const;

const SUMMARY_FIELD_CANDIDATES = {
  arrivalDate: ["Arrival Date"],
  originCountry: ["Country Of Origin"],
  shipperName: ["Shipper Name"],
  commodity: ["Container Content"],
  arrivalPort: ["US Arrival Port"],
  foreignPort: ["Foreign Port"],
  billType: ["Bill Type"],
  containerLoad: ["Container Load"],
  containerized: ["Containerized"]
} as const;

export type TradeMiningCustomerIntelligenceResult = {
  searchStarted: boolean;
  searchSucceeded: boolean;
  customerNameSearched: string | null;
  customerType: "customer" | "agent";
  searchField: (typeof CUSTOMER_SEARCH_FIELDS)[keyof typeof CUSTOMER_SEARCH_FIELDS];
  dateRange: {
    start: string;
    end: string;
  };
  totalShipmentRecordsFound: number;
  searchId: string | null;
  warning: string | null;
  fieldsUsed: string[];
  summary: Record<string, string | number | string[] | null>;
  recentRecords: Record<string, string>[];
  workbookAttachment: {
    fileName: string;
    content: Buffer;
  } | null;
};

export async function enrichTmsInquiryCustomerWithTradeMining(
  customerName: string | null | undefined,
  customerType: "customer" | "agent" = "customer",
  today = new Date()
): Promise<TradeMiningCustomerIntelligenceResult> {
  const dateRange = buildTrailingSixMonthDateRange(today);
  const trimmedCustomerName = customerName?.trim() || null;
  const searchField = CUSTOMER_SEARCH_FIELDS[customerType];

  if (!trimmedCustomerName) {
    logTradeMiningCustomerIntelligence("skipped", {
      customerName: null,
      customerType,
      searchField,
      dateRange,
      warning: "No customer/company name was identified from the inquiry."
    });
    return buildWarningResult({
      customerName: null,
      customerType,
      searchField,
      dateRange,
      warning: "TradeMining search skipped because no customer/company name was identified from the inquiry."
    });
  }

  logTradeMiningCustomerIntelligence("started", {
    customerName: trimmedCustomerName,
    customerType,
    searchField,
    dateRange
  });

  try {
    const result = await searchTradeMining(
      {
        [searchField]: trimmedCustomerName,
        TradeStartDate: dateRange.start,
        TradeEndDate: dateRange.end
      },
      { saveWorkbook: false }
    );
    const rows = sortRowsByMostRecentArrival(result.rows);
    const fieldsUsed = findExistingFields(rows, REVIEW_FIELD_CANDIDATES);
    const warning = rows.length === 0 ? "TradeMining search succeeded, but no shipment records were found." : null;

    logTradeMiningCustomerIntelligence("completed", {
      customerName: trimmedCustomerName,
      customerType,
      searchField,
      dateRange,
      searchId: result.searchId,
      recordCount: rows.length,
      warning
    });

    return {
      searchStarted: true,
      searchSucceeded: true,
      customerNameSearched: trimmedCustomerName,
      customerType,
      searchField,
      dateRange,
      totalShipmentRecordsFound: rows.length,
      searchId: result.searchId,
      warning,
      fieldsUsed,
      summary: summarizeTradeMiningRows(rows),
      recentRecords: rows.slice(0, MAX_RECENT_RECORDS).map((row) => pickFields(row, fieldsUsed)),
      workbookAttachment: {
        fileName: buildTradeMiningWorkbookFileName(result.searchId, result.exportFileName),
        content: result.rawWorkbook
      }
    };
  } catch (error) {
    const warning = `TradeMining customer enrichment failed: ${error instanceof Error ? error.message : "Unknown error."}`;
    logTradeMiningCustomerIntelligence("failed", {
      customerName: trimmedCustomerName,
      customerType,
      searchField,
      dateRange,
      warning
    });

    return buildWarningResult({
      customerName: trimmedCustomerName,
      customerType,
      searchField,
      dateRange,
      warning
    });
  }
}

function buildWarningResult({
  customerName,
  customerType,
  searchField,
  dateRange,
  warning
}: {
  customerName: string | null;
  customerType: "customer" | "agent";
  searchField: TradeMiningCustomerIntelligenceResult["searchField"];
  dateRange: TradeMiningCustomerIntelligenceResult["dateRange"];
  warning: string;
}): TradeMiningCustomerIntelligenceResult {
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

function buildTradeMiningWorkbookFileName(searchId: string, exportFileName: string | null) {
  const baseName = exportFileName?.trim() || `trademining-search-${searchId}.xlsx`;
  const safeName = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, " ").trim();
  return safeName.toLowerCase().endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
}

function logTradeMiningCustomerIntelligence(
  status: "skipped" | "started" | "completed" | "failed",
  details: {
    customerName: string | null;
    customerType: "customer" | "agent";
    searchField: TradeMiningCustomerIntelligenceResult["searchField"];
    dateRange: TradeMiningCustomerIntelligenceResult["dateRange"];
    searchId?: string | null;
    recordCount?: number;
    warning?: string | null;
  }
) {
  console.log(
    [
      `[tms-bridge:trademining] status=${status}`,
      `searchStarted=${status !== "skipped"}`,
      `customerName=${details.customerName ?? "(none)"}`,
      `customerType=${details.customerType}`,
      `searchField=${details.searchField}`,
      `dateRange=${details.dateRange.start}-${details.dateRange.end}`,
      `searchId=${details.searchId ?? "(none)"}`,
      `shipmentRecords=${details.recordCount ?? 0}`,
      `warning=${details.warning ?? "(none)"}`
    ].join(" ")
  );
}

function buildTrailingSixMonthDateRange(today: Date) {
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 6);

  return {
    start: formatTradeMiningDate(startDate),
    end: formatTradeMiningDate(endDate)
  };
}

function formatTradeMiningDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function sortRowsByMostRecentArrival(rows: TradeMiningExcelRow[]) {
  return [...rows].sort((left, right) => parseTradeMiningDate(right["Arrival Date"]) - parseTradeMiningDate(left["Arrival Date"]));
}

function parseTradeMiningDate(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const normalized = value.trim();
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return new Date(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2])).getTime();
  }

  const dashMatch = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    return new Date(Number(dashMatch[3]), Number(dashMatch[1]) - 1, Number(dashMatch[2])).getTime();
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findExistingFields(rows: TradeMiningExcelRow[], candidates: readonly string[]) {
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  return candidates.filter((field) => available.has(field));
}

function summarizeTradeMiningRows(rows: TradeMiningExcelRow[]): TradeMiningCustomerIntelligenceResult["summary"] {
  if (rows.length === 0) {
    return {};
  }

  return {
    mostRecentArrivalDate: firstExistingValue(rows, SUMMARY_FIELD_CANDIDATES.arrivalDate),
    topOriginCountries: topValues(rows, SUMMARY_FIELD_CANDIDATES.originCountry, 5),
    topUSArrivalPorts: topValues(rows, SUMMARY_FIELD_CANDIDATES.arrivalPort, 5),
    topForeignPorts: topValues(rows, SUMMARY_FIELD_CANDIDATES.foreignPort, 5),
    topShippers: topValues(rows, SUMMARY_FIELD_CANDIDATES.shipperName, 5),
    topBillTypes: topValues(rows, SUMMARY_FIELD_CANDIDATES.billType, 5),
    containerLoads: topValues(rows, SUMMARY_FIELD_CANDIDATES.containerLoad, 5),
    containerizedValues: topValues(rows, SUMMARY_FIELD_CANDIDATES.containerized, 5),
    commoditySamples: uniqueValues(rows, SUMMARY_FIELD_CANDIDATES.commodity, 3)
  };
}

function firstExistingValue(rows: TradeMiningExcelRow[], candidates: readonly string[]) {
  for (const row of rows) {
    const value = readFirstField(row, candidates);
    if (value) {
      return value;
    }
  }

  return null;
}

function topValues(rows: TradeMiningExcelRow[], candidates: readonly string[], limit: number) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = readFirstField(row, candidates);
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => `${value} (${count})`);
}

function uniqueValues(rows: TradeMiningExcelRow[], candidates: readonly string[], limit: number) {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = readFirstField(row, candidates);
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      values.push(value);
    }

    if (values.length >= limit) {
      break;
    }
  }

  return values;
}

function readFirstField(row: TradeMiningExcelRow, candidates: readonly string[]) {
  for (const candidate of candidates) {
    const value = row[candidate]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function pickFields(row: TradeMiningExcelRow, fields: string[]) {
  return Object.fromEntries(
    fields
      .map((field) => [field, row[field]?.trim() ?? ""] as const)
      .filter(([, value]) => value)
  );
}
