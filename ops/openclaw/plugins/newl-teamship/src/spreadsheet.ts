import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export type SpreadsheetValue = string | number | boolean | null;

export type SpreadsheetColumn = {
  key: string;
  header: string;
};

export type SpreadsheetInput = {
  filename: string;
  sheetName: string;
  columns: SpreadsheetColumn[];
  rows: Array<Record<string, SpreadsheetValue>>;
};

const MAX_COLUMNS = 25;
const MAX_ROWS = 500;
const MAX_CELL_LENGTH = 2_000;

export async function writeSpreadsheetFile(workspaceDir: string, input: SpreadsheetInput) {
  if (!isAbsolute(workspaceDir)) throw new Error("OpenClaw did not supply an absolute workspace directory.");
  const normalized = normalizeSpreadsheetInput(input);
  const outputDirectory = join(workspaceDir, "exports");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const storageFilename = normalized.filename.replace(
    /\.xlsx$/i,
    `-${randomUUID().slice(0, 8)}.xlsx`
  );
  const outputPath = join(outputDirectory, storageFilename);
  await writeFile(outputPath, buildSpreadsheetWorkbook(normalized), { mode: 0o600 });
  return {
    filePath: outputPath,
    filename: normalized.filename,
    rowCount: normalized.rows.length,
    columnCount: normalized.columns.length
  };
}

export function buildSpreadsheetWorkbook(input: SpreadsheetInput) {
  const normalized = normalizeSpreadsheetInput(input);
  const entries = [
    zipEntry("[Content_Types].xml", contentTypesXml()),
    zipEntry("_rels/.rels", rootRelationshipsXml()),
    zipEntry("docProps/app.xml", appPropertiesXml()),
    zipEntry("docProps/core.xml", corePropertiesXml()),
    zipEntry("xl/workbook.xml", workbookXml(normalized.sheetName)),
    zipEntry("xl/_rels/workbook.xml.rels", workbookRelationshipsXml()),
    zipEntry("xl/styles.xml", stylesXml()),
    zipEntry("xl/worksheets/sheet1.xml", worksheetXml(normalized))
  ];
  return buildZip(entries);
}

export function normalizeSpreadsheetInput(input: SpreadsheetInput): SpreadsheetInput {
  if (!input || typeof input !== "object") throw new Error("Spreadsheet input is required.");
  if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > MAX_COLUMNS) {
    throw new Error(`Spreadsheet columns must contain between 1 and ${MAX_COLUMNS} entries.`);
  }
  if (!Array.isArray(input.rows) || input.rows.length > MAX_ROWS) {
    throw new Error(`Spreadsheet rows must contain at most ${MAX_ROWS} entries.`);
  }

  const keys = new Set<string>();
  const columns = input.columns.map((column) => {
    const key = cleanText(column?.key, 80, "column key");
    const header = cleanText(column?.header, 120, "column header");
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      throw new Error("Spreadsheet column keys must start with a letter and contain only letters, numbers, and underscores.");
    }
    if (keys.has(key)) throw new Error(`Spreadsheet column key "${key}" is duplicated.`);
    keys.add(key);
    return { key, header };
  });

  const rows = input.rows.map((row, rowIndex) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Spreadsheet row ${rowIndex + 1} must be an object.`);
    }
    const unknownKeys = Object.keys(row).filter((key) => !keys.has(key));
    if (unknownKeys.length > 0) {
      throw new Error(`Spreadsheet row ${rowIndex + 1} contains an unknown column key.`);
    }
    return Object.fromEntries(columns.map(({ key }) => [key, normalizeCellValue(row[key])]));
  });

  return {
    filename: normalizeFilename(input.filename),
    sheetName: normalizeSheetName(input.sheetName),
    columns,
    rows
  };
}

function normalizeCellValue(value: unknown): SpreadsheetValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Spreadsheet numbers must be finite.");
    return value;
  }
  if (typeof value !== "string") throw new Error("Spreadsheet cells may contain only text, numbers, booleans, or null.");
  let normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .slice(0, MAX_CELL_LENGTH);
  if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return normalized;
}

function normalizeFilename(value: unknown) {
  const base = typeof value === "string"
    ? value.trim().replace(/\.xlsx$/i, "")
    : "nemo-spreadsheet";
  const safe = base
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return `${safe || "nemo-spreadsheet"}.xlsx`;
}

function normalizeSheetName(value: unknown) {
  const normalized = (typeof value === "string" ? value : "Sheet1")
    .replace(/[\u0000-\u001f\u007f:[\]/*?\\]/g, " ")
    .trim()
    .slice(0, 31);
  return normalized || "Sheet1";
}

function cleanText(value: unknown, maxLength: number, label: string) {
  if (typeof value !== "string") throw new Error(`Spreadsheet ${label} is required.`);
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
  if (!normalized) throw new Error(`Spreadsheet ${label} is required.`);
  return normalized;
}

function worksheetXml(input: SpreadsheetInput) {
  const header = input.columns
    .map((column, index) => stringCell(`${columnName(index)}1`, column.header, 1))
    .join("");
  const rows = input.rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    const cells = input.columns.map((column, columnIndex) =>
      valueCell(`${columnName(columnIndex)}${excelRow}`, row[column.key])
    ).join("");
    return `<row r="${excelRow}">${cells}</row>`;
  }).join("");
  const columnDefinitions = input.columns.map((column, index) => {
    const values = input.rows.map((row) => String(row[column.key] ?? ""));
    const width = Math.min(50, Math.max(10, column.header.length + 2, ...values.map((value) => value.length + 2)));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const lastCell = `${columnName(input.columns.length - 1)}${Math.max(1, input.rows.length + 1)}`;
  const autoFilter = input.rows.length > 0 ? `<autoFilter ref="A1:${lastCell}"/>` : "";

  return xmlDocument(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<dimension ref="A1:${lastCell}"/>`
      + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/>`
      + `<cols>${columnDefinitions}</cols>`
      + `<sheetData><row r="1">${header}</row>${rows}</sheetData>`
      + autoFilter
      + `</worksheet>`
  );
}

function valueCell(reference: string, value: SpreadsheetValue | undefined) {
  if (value === null || value === undefined) return `<c r="${reference}"/>`;
  if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return stringCell(reference, value, 0);
}

function stringCell(reference: string, value: string, style: number) {
  const styleAttribute = style ? ` s="${style}"` : "";
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function workbookXml(sheetName: string) {
  return xmlDocument(
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
}

function stylesXml() {
  return xmlDocument(
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`
      + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>`
      + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
      + `</styleSheet>`
  );
}

function contentTypesXml() {
  return xmlDocument(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
      + `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`
      + `</Types>`
  );
}

function rootRelationshipsXml() {
  return xmlDocument(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
      + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`
      + `</Relationships>`
  );
}

function workbookRelationshipsXml() {
  return xmlDocument(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `</Relationships>`
  );
}

function appPropertiesXml() {
  return xmlDocument(
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" `
      + `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
      + `<Application>Newl Nemo</Application></Properties>`
  );
}

function corePropertiesXml() {
  return xmlDocument(
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" `
      + `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" `
      + `xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:creator>Newl Nemo</dc:creator><cp:lastModifiedBy>Newl Nemo</cp:lastModifiedBy>`
      + `</cp:coreProperties>`
  );
}

function xmlDocument(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

type ZipEntry = {
  name: Buffer;
  data: Buffer;
  crc: number;
};

function zipEntry(name: string, content: string): ZipEntry {
  const data = Buffer.from(content, "utf8");
  return { name: Buffer.from(name, "utf8"), data, crc: crc32(data) };
}

function buildZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(entry.name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, entry.name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, entry.name);
    offset += local.length + entry.name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
