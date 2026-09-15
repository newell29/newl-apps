import { createHash } from "node:crypto";

import { SUPPLY_CHAIN_DESIGN_CSV_MAX_BYTES, formatBytes } from "@/modules/supply-chain-design/file-size";

export const SUPPLY_CHAIN_DESIGN_CSV_PREVIEW_ROW_LIMIT = 10;

export type ParsedSupplyChainDesignCsv = {
  safeFileName: string;
  contentType: string | null;
  sizeBytes: number;
  contentHash: string;
  headers: string[];
  rowCount: number;
  previewRows: string[][];
  bytes: Buffer;
};

export async function parseSupplyChainDesignCsvUpload(file: File): Promise<ParsedSupplyChainDesignCsv> {
  const safeFileName = sanitizeFileName(file.name);

  if (!safeFileName.toLowerCase().endsWith(".csv")) {
    throw new Error("Only .csv files are supported.");
  }

  if (file.size <= 0) {
    throw new Error(`${safeFileName} is empty.`);
  }

  if (file.size > SUPPLY_CHAIN_DESIGN_CSV_MAX_BYTES) {
    throw new Error(
      `${safeFileName} is too large. The current database-backed proof accepts files up to ${formatBytes(
        SUPPLY_CHAIN_DESIGN_CSV_MAX_BYTES
      )}.`
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  if (bytes.byteLength === 0) {
    throw new Error(`${safeFileName} is empty.`);
  }

  const text = decodeCsvBytes(bytes);
  const rows = parseCsvRows(text);
  const headers = rows[0]?.map((header) => header.trim()) ?? [];

  if (headers.length === 0 || headers.every((header) => !header)) {
    throw new Error(`${safeFileName} does not contain a readable header row.`);
  }

  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim()));

  return {
    safeFileName,
    contentType: file.type || "text/csv",
    sizeBytes: bytes.byteLength,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    headers,
    rowCount: dataRows.length,
    previewRows: dataRows.slice(0, SUPPLY_CHAIN_DESIGN_CSV_PREVIEW_ROW_LIMIT),
    bytes
  };
}

function sanitizeFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]+/).pop()?.trim() || "upload.csv";
  return baseName.replace(/[\u0000-\u001f<>:"|?*]+/g, "_").slice(0, 180) || "upload.csv";
}

function decodeCsvBytes(bytes: Buffer) {
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

export function parseCsvRows(text: string): string[][] {
  if (!text.trim()) {
    throw new Error("CSV file is empty.");
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentValue += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentValue += char;
      }
      continue;
    }

    if (char === '"') {
      if (currentValue.length > 0) {
        throw new Error("CSV contains malformed quoted content.");
      }
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(trimCarriageReturn(currentValue));
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (inQuotes) {
    throw new Error("CSV contains an unclosed quoted value.");
  }

  currentRow.push(trimCarriageReturn(currentValue));
  rows.push(currentRow);

  return rows.filter((row) => row.some((value) => value.trim()));
}

function trimCarriageReturn(value: string) {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}
