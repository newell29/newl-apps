// QuickBooks customer names are source labels, not canonical customer identity.
// When live import is added, parsed lines should resolve through shared customer
// identity + alias matching so USD/CAD A/R variants and cross-system naming
// mismatches do not create duplicate customers in Newl Apps.

export type QuickBooksProfitAndLossRow = {
  legalEntity?: CashflowLegalEntity | null;
  businessLine?: CashflowBusinessLine | null;
  sourceCustomerId?: string | null;
  transactionDate?: Date | string | null;
  transactionType?: string | null;
  transactionNumber?: string | null;
  name?: string | null;
  classFullName?: string | null;
  description?: string | null;
  splitAccountName?: string | null;
  amount?: number | null;
  accountName?: string | null;
  parentSection?: string | null;
  rawJson?: Record<string, unknown> | null;
};

export type QuickBooksCustomerAlias = {
  sourceSystem: "QUICKBOOKS";
  sourceCustomerId: string | null;
  sourceCustomerName: string;
  normalizedSourceName: string;
  sourceCurrency: string | null;
  sourceLabel: string;
};

export type CashflowLegalEntity = "NEWL_WORLDWIDE" | "NEWL_USA";
export type CashflowBusinessLine = "OCEAN" | "AIR" | "TRUCKING" | "WAREHOUSING" | "OTHER";

export type ParsedQuickBooksCashflowLine = {
  legalEntity: CashflowLegalEntity;
  businessLine: CashflowBusinessLine;
  fileNumber: string | null;
  shipmentType: string | null;
  lineKind: "CUSTOMER_REVENUE" | "VENDOR_COST" | "OTHER";
  transactionDate: Date | null;
  transactionType: string | null;
  transactionNumber: string | null;
  name: string | null;
  classFullName: string | null;
  description: string | null;
  accountName: string | null;
  splitAccountName: string | null;
  amount: number;
  rawJson: Record<string, unknown>;
};

export type QuickBooksParseOptions = {
  legalEntity?: CashflowLegalEntity;
  defaultBusinessLine?: CashflowBusinessLine;
};

const FILE_NUMBER_PATTERN = /\b(AI|AE|OI|OE|TR|WH|CI|CE)\s*[-#:]?\s*(\d+[A-Z]?\d*)\b/i;

export const SHIPMENT_TYPE_LABELS: Record<string, string> = {
  AI: "Air Import",
  AE: "Air Export",
  OI: "Ocean Import",
  OE: "Ocean Export",
  TR: "Trucking",
  WH: "Warehouse",
  CI: "Customs Import",
  CE: "Customs Export"
};

const WAREHOUSE_ACCOUNT_PATTERN = /\b(warehouse|warehousing|storage)\b/i;
const OCEAN_ACCOUNT_PATTERN = /\bocean\b/i;
const AIR_ACCOUNT_PATTERN = /\bair\b/i;
const TRUCKING_ACCOUNT_PATTERN = /\b(trucking|truck|delivery|dray|drayage)\b/i;

export function extractFileNumber(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(FILE_NUMBER_PATTERN);
  if (!match) {
    return null;
  }

  return `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
}

export function getShipmentTypeFromFileNumber(fileNumber?: string | null) {
  if (!fileNumber) {
    return null;
  }

  const prefix = fileNumber.match(/^[A-Z]+/)?.[0] ?? null;
  return prefix && SHIPMENT_TYPE_LABELS[prefix] ? prefix : prefix;
}

export function classifyProfitAndLossLine(parentSection?: string | null, accountName?: string | null) {
  const section = normalize(parentSection);
  const account = normalize(accountName);

  if (section === "income") {
    return "CUSTOMER_REVENUE" as const;
  }

  if (section === "cost of goods sold") {
    return "VENDOR_COST" as const;
  }

  if (section && section !== "income" && section !== "cost of goods sold") {
    return "OTHER" as const;
  }

  if (account.startsWith("4")) {
    return "CUSTOMER_REVENUE" as const;
  }

  if (
    account.startsWith("5014") ||
    account.startsWith("5015") ||
    account.startsWith("5020") ||
    account.startsWith("5030") ||
    account.startsWith("5300")
  ) {
    return "VENDOR_COST" as const;
  }

  return "OTHER" as const;
}

export function parseQuickBooksProfitAndLossRow(
  row: QuickBooksProfitAndLossRow,
  options: QuickBooksParseOptions = {}
): ParsedQuickBooksCashflowLine {
  const fileNumber = extractFileNumber(row.description);
  const shipmentType = getShipmentTypeFromFileNumber(fileNumber);
  const legalEntity = row.legalEntity ?? options.legalEntity ?? "NEWL_WORLDWIDE";
  const businessLine =
    row.businessLine ??
    inferBusinessLine({
      fileNumber,
      accountName: row.accountName,
      classFullName: row.classFullName,
      description: row.description,
      defaultBusinessLine: options.defaultBusinessLine
    });

  return {
    legalEntity,
    businessLine,
    fileNumber,
    shipmentType,
    lineKind: classifyProfitAndLossLine(row.parentSection, row.accountName),
    transactionDate: parseDate(row.transactionDate),
    transactionType: clean(row.transactionType),
    transactionNumber: clean(row.transactionNumber),
    name: clean(row.name),
    classFullName: clean(row.classFullName),
    description: clean(row.description),
    accountName: clean(row.accountName),
    splitAccountName: clean(row.splitAccountName),
    amount: Number(row.amount ?? 0),
    rawJson: row.rawJson ?? { ...row }
  };
}

export function buildQuickBooksCustomerAlias(row: Pick<QuickBooksProfitAndLossRow, "name" | "sourceCustomerId">): QuickBooksCustomerAlias | null {
  const sourceCustomerName = clean(row.name);
  if (!sourceCustomerName) {
    return null;
  }

  return {
    sourceSystem: "QUICKBOOKS",
    sourceCustomerId: clean(row.sourceCustomerId),
    sourceCustomerName,
    normalizedSourceName: normalizeQuickBooksCustomerName(sourceCustomerName),
    sourceCurrency: inferCurrencyFromQuickBooksName(sourceCustomerName),
    sourceLabel: sourceCustomerName
  };
}

export function normalizeQuickBooksCustomerName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+-\s+(usd|cad|cdn)$/i, "")
    .replace(/\s+\((usd|cad|cdn)\)$/i, "")
    .replace(/\b(usd|cad|cdn)\b$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferCurrencyFromQuickBooksName(value: string) {
  const normalized = value.trim().toUpperCase();
  if (/(^|[\s(-])USD[\s)]*$/.test(normalized)) {
    return "USD";
  }

  if (/(^|[\s(-])(CAD|CDN)[\s)]*$/.test(normalized)) {
    return "CAD";
  }

  return null;
}

export function isFileNumberRequiredForLine(line: Pick<ParsedQuickBooksCashflowLine, "businessLine" | "lineKind">) {
  if (line.businessLine === "WAREHOUSING") {
    return false;
  }

  return line.lineKind === "CUSTOMER_REVENUE" || line.lineKind === "VENDOR_COST";
}

export function groupQuickBooksLinesByFile(lines: ParsedQuickBooksCashflowLine[]) {
  const grouped = new Map<
    string,
    {
      fileNumber: string;
      shipmentType: string | null;
      customerRevenue: number;
      vendorCost: number;
      customerInvoiceCount: number;
      vendorBillCount: number;
      hasCustomerInvoice: boolean;
      hasVendorCost: boolean;
    }
  >();

  for (const line of lines) {
    if (!line.fileNumber) {
      continue;
    }

    const existing =
      grouped.get(line.fileNumber) ??
      {
        fileNumber: line.fileNumber,
        shipmentType: line.shipmentType,
        customerRevenue: 0,
        vendorCost: 0,
        customerInvoiceCount: 0,
        vendorBillCount: 0,
        hasCustomerInvoice: false,
        hasVendorCost: false
      };

    if (line.lineKind === "CUSTOMER_REVENUE") {
      existing.customerRevenue += line.amount;
      existing.customerInvoiceCount += 1;
      existing.hasCustomerInvoice = true;
    }

    if (line.lineKind === "VENDOR_COST") {
      existing.vendorCost += line.amount;
      existing.vendorBillCount += 1;
      existing.hasVendorCost = true;
    }

    grouped.set(line.fileNumber, existing);
  }

  return [...grouped.values()].map((file) => ({
    ...file,
    customerRevenue: roundCurrency(file.customerRevenue),
    vendorCost: roundCurrency(file.vendorCost),
    vendorCostWithoutCustomerInvoice: file.hasVendorCost && !file.hasCustomerInvoice
  }));
}

export function summarizeUnmatchedQuickBooksLines(lines: ParsedQuickBooksCashflowLine[]) {
  return lines.reduce(
    (summary, line) => {
      if (!line.fileNumber && isFileNumberRequiredForLine(line)) {
        summary.fileNumberRequired += 1;
      }

      if (!line.fileNumber && !isFileNumberRequiredForLine(line) && line.businessLine === "WAREHOUSING") {
        summary.warehouseAggregateLines += 1;
      }

      return summary;
    },
    {
      fileNumberRequired: 0,
      warehouseAggregateLines: 0
    }
  );
}

function inferBusinessLine({
  fileNumber,
  accountName,
  classFullName,
  description,
  defaultBusinessLine
}: {
  fileNumber: string | null;
  accountName?: string | null;
  classFullName?: string | null;
  description?: string | null;
  defaultBusinessLine?: CashflowBusinessLine;
}): CashflowBusinessLine {
  if (fileNumber) {
    return getBusinessLineFromFileNumber(fileNumber);
  }

  const searchable = [accountName, classFullName, description].filter(Boolean).join(" ");
  if (WAREHOUSE_ACCOUNT_PATTERN.test(searchable)) {
    return "WAREHOUSING";
  }

  if (OCEAN_ACCOUNT_PATTERN.test(searchable)) {
    return "OCEAN";
  }

  if (AIR_ACCOUNT_PATTERN.test(searchable)) {
    return "AIR";
  }

  if (TRUCKING_ACCOUNT_PATTERN.test(searchable)) {
    return "TRUCKING";
  }

  return defaultBusinessLine ?? "OTHER";
}

function getBusinessLineFromFileNumber(fileNumber: string): CashflowBusinessLine {
  const shipmentType = getShipmentTypeFromFileNumber(fileNumber);

  if (shipmentType === "OI" || shipmentType === "OE") {
    return "OCEAN";
  }

  if (shipmentType === "AI" || shipmentType === "AE") {
    return "AIR";
  }

  if (shipmentType === "TR") {
    return "TRUCKING";
  }

  if (shipmentType === "WH") {
    return "WAREHOUSING";
  }

  return "OTHER";
}

function clean(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalize(value?: string | null) {
  return clean(value)?.toLowerCase() ?? "";
}

function parseDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
