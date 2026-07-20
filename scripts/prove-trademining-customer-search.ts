import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { searchTradeMining, type TradeMiningExcelRow, type TradeMiningSearchParams } from "../src/server/integrations/trademining";

const CUSTOMER_SEARCH_FIELD: keyof TradeMiningSearchParams = "ConsigneeName";

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const customerName = await readCustomerName(cliArgs);
  const { startDate, endDate } = await readDateRange(cliArgs);
  const searchParams: TradeMiningSearchParams = {
    [CUSTOMER_SEARCH_FIELD]: customerName,
    TradeStartDate: startDate,
    TradeEndDate: endDate
  };

  console.log(`\nRunning TradeMining customer search`);
  console.log(`Search field: ${CUSTOMER_SEARCH_FIELD}`);
  console.log(`Customer name: ${customerName}`);
  console.log(`Trade start date: ${startDate}`);
  console.log(`Trade end date: ${endDate}`);

  const result = await searchTradeMining(searchParams);
  const columns = collectColumns(result.rows);
  const example = result.rows[0] ? redactRecord(result.rows[0]) : null;

  console.log("\nTradeMining customer search result");
  console.log(JSON.stringify({
    searchWorked: true,
    searchId: result.searchId,
    exportFileName: result.exportFileName,
    shipmentRecordCount: result.rows.length,
    columns,
    exampleRecord: example
  }, null, 2));

  if (result.rows.length === 0) {
    console.log("\nSearch completed, but the downloaded report did not contain shipment records for that customer name.");
  }
}

async function readCustomerName(cliArgs: CliArgs) {
  const argValue = cliArgs.customer?.trim() ?? "";
  const envValue = process.env.TRADEMINING_CUSTOMER_NAME?.trim();
  const customerName = argValue || envValue;

  if (customerName) {
    return customerName;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Enter TradeMining customer/company name to search as ConsigneeName: ");
    const trimmed = answer.trim();
    if (!trimmed) {
      throw new Error("Customer name is required.");
    }

    return trimmed;
  } finally {
    rl.close();
  }
}

async function readDateRange(cliArgs: CliArgs) {
  const envStartDate = process.env.TRADEMINING_START_DATE?.trim();
  const envEndDate = process.env.TRADEMINING_END_DATE?.trim();
  const startDate = cliArgs.start?.trim() || envStartDate || "";
  const endDate = cliArgs.end?.trim() || envEndDate || "";

  if (startDate && endDate) {
    return validateDateRange(startDate, endDate);
  }

  const rl = createInterface({ input, output });
  try {
    const promptedStartDate = startDate || (await rl.question("Enter TradeMining start date (MM/DD/YYYY): ")).trim();
    const promptedEndDate = endDate || (await rl.question("Enter TradeMining end date (MM/DD/YYYY): ")).trim();
    return validateDateRange(promptedStartDate, promptedEndDate);
  } finally {
    rl.close();
  }
}

function validateDateRange(startDate: string, endDate: string) {
  validateTradeMiningDate(startDate, "Start date");
  validateTradeMiningDate(endDate, "End date");

  return {
    startDate,
    endDate
  };
}

function validateTradeMiningDate(value: string, label: string) {
  if (!/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/.test(value)) {
    throw new Error(`${label} must use MM/DD/YYYY format.`);
  }
}

type CliArgs = {
  customer?: string;
  start?: string;
  end?: string;
};

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--customer") {
      parsed.customer = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--start") {
      parsed.start = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--end") {
      parsed.end = args[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function collectColumns(rows: TradeMiningExcelRow[]) {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      columns.add(column);
    }
  }

  return [...columns];
}

function redactRecord(record: TradeMiningExcelRow) {
  return Object.fromEntries(
    Object.entries(record).map(([column, value]) => [
      column,
      shouldRedactColumn(column) ? redactValue(value) : value
    ])
  );
}

function shouldRedactColumn(column: string) {
  return /address|zip|postal|phone|email|contact|bol|bill\s*of\s*lading|container|seal|reference|tax|ein|account|id|number/i.test(column);
}

function redactValue(value: string) {
  if (!value) {
    return value;
  }

  return "[redacted]";
}

main().catch((error) => {
  console.log("\nTradeMining customer search failed.");
  console.log(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
