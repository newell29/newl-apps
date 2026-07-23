import { inflateRawSync } from "node:zlib";

const DEFAULT_BASE_URL = "https://www.trademining.com";
const LOGIN_PAGE_PATH = "/Account/LogIn";
const LOGIN_POST_PATH = "/Account/Login";
const IMPORT_SEARCH_PATH = "/ImportSearch";
const IMPORT_SEARCH_DATA_PATH = "/ImportSearch/Data";

const TRADEMINING_EXPORT_COLUMNS = [
  { field: "ArrivalDate", title: "Arrival Date", width: 200, format: "{0:MM-dd-yyyy}" },
  { field: "CountryOfOrigin.Name", title: "Country Of Origin", width: 200 },
  { field: "ConsigneeGroup.Name", title: "Consignee Name", width: 600 },
  { field: "ShipperGroup.Name", title: "Shipper Name", width: 600 },
  { field: "Commodity", title: "Container Content", width: 450, sortable: false },
  { field: "ContainerCount", title: "Container Count", width: 150 },
  { field: "PortOfUnlading.Name", title: "US Arrival Port", width: 250 },
  { field: "ForeignPort.Name", title: "Foreign Port", width: 250 },
  { field: "PlaceOfReceipt", title: "Place Of Receipt", width: 280 },
  { field: "TeuType", title: "Container Load", width: 150 },
  { field: "ContainerFlag", title: "Containerized", width: 150 },
  { field: "BillType.Description", title: "Bill Type", width: 150 },
  { field: "CarrierCode.Name", title: "Carrier Name", width: 250 },
  { field: "Vessel.Name", title: "Vessel Name", width: 250 }
];

const TRADEMINING_SEARCH_FIELDS = [
  "TradeStartDate",
  "TradeEndDate",
  "BillTypeHouse",
  "BillTypeNormal",
  "UnifiedSearch",
  "ContainerCommodity",
  "ConsigneeName",
  "ConsigneeAddress",
  "ConsigneeZip",
  "ZipRadius",
  "ShipperName",
  "ShipperAddress",
  "ShipperCity",
  "ShipperZip",
  "PlaceOfReceipt",
  "NotifyName",
  "MasterConsigneeName",
  "MasterShipperName",
  "BolNumber",
  "ContainerNumber",
  "ContainerLoad",
  "ContainerFlag",
  "SaveSearchId",
  "RollUpType",
  "ConsigneeGroupId"
] as const;

type TradeMiningSearchField = (typeof TRADEMINING_SEARCH_FIELDS)[number];

export type TradeMiningSearchParams = Partial<Record<TradeMiningSearchField, string | number | boolean | null | undefined>>;
export type TradeMiningExcelRow = Record<string, string>;

export type TradeMiningSearchResult = {
  searchId: string;
  exportFileName: string | null;
  rows: TradeMiningExcelRow[];
  rawWorkbook: Buffer;
};

type TradeMiningClientOptions = {
  baseUrl?: string;
  saveWorkbook?: boolean;
  credentials?: {
    username: string;
    password: string;
  };
};

class TradeMiningSession {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async get(path: string, headers: Record<string, string> = {}) {
    return this.request(path, { method: "GET", headers, redirect: "manual" });
  }

  async postForm(path: string, form: URLSearchParams, headers: Record<string, string> = {}) {
    return this.request(path, {
      method: "POST",
      body: form,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers
      },
      redirect: "manual"
    });
  }

  private async request(path: string, init: RequestInit) {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        Accept: "*/*",
        "User-Agent": "NewlAppsTradeMiningConnector/1.0",
        ...this.cookieHeader(),
        ...init.headers
      }
    });
    this.storeCookies(response.headers);
    return response;
  }

  get origin() {
    return new URL(this.baseUrl).origin;
  }

  private cookieHeader(): Record<string, string> {
    return this.cookies.size > 0
      ? { Cookie: [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ") }
      : {};
  }

  private storeCookies(headers: Headers) {
    for (const value of readSetCookieHeaders(headers)) {
      const [cookie] = value.split(";");
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex > 0) {
        this.cookies.set(cookie.slice(0, separatorIndex).trim(), cookie.slice(separatorIndex + 1).trim());
      }
    }
  }
}

export async function searchTradeMining(
  params: TradeMiningSearchParams,
  options: TradeMiningClientOptions = {}
): Promise<TradeMiningSearchResult> {
  const session = new TradeMiningSession(options.baseUrl ?? process.env.TRADEMINING_BASE_URL?.trim() ?? DEFAULT_BASE_URL);
  const credentials = options.credentials ?? readTradeMiningCredentialsFromEnv();

  await loginToTradeMining(session, credentials);
  const importSearchPage = await fetchImportSearchPage(session);
  const token = extractRequestVerificationToken(importSearchPage);
  const searchId = await submitTradeMiningSearch(session, params, token);
  const exportResponse = await exportTradeMiningResults(session, searchId);
  const rawWorkbook = Buffer.from(await exportResponse.arrayBuffer());

  return {
    searchId,
    exportFileName: readDownloadFileName(exportResponse.headers),
    rows: parseFirstWorksheet(rawWorkbook),
    rawWorkbook
  };
}

async function loginToTradeMining(session: TradeMiningSession, credentials: { username: string; password: string }) {
  const loginPageResponse = await session.get(LOGIN_PAGE_PATH);
  assertOk(loginPageResponse, "TradeMining login page failed");
  const loginPage = await loginPageResponse.text();
  const token = extractRequestVerificationToken(loginPage);
  const form = extractFormFields(loginPage);
  form.set(process.env.TRADEMINING_LOGIN_USERNAME_FIELD?.trim() || "Email", credentials.username);
  form.set(process.env.TRADEMINING_LOGIN_PASSWORD_FIELD?.trim() || "Password", credentials.password);
  form.set("__RequestVerificationToken", token);
  const action = extractFormAction(loginPage) ?? LOGIN_POST_PATH;
  const response = await session.postForm(action, form, {
    Origin: session.origin,
    Referer: new URL(LOGIN_PAGE_PATH, session.origin).toString()
  });
  const location = response.headers.get("location");
  if (![200, 302, 303].includes(response.status) || (location && isLoginRedirect(location))) {
    throw new Error(`TradeMining login failed. status=${response.status} redirect=${location ?? "none"}`);
  }
  if (location) {
    await session.get(location);
  }
}

async function fetchImportSearchPage(session: TradeMiningSession) {
  const response = await session.get(IMPORT_SEARCH_PATH);
  const location = response.headers.get("location");
  if (location && isLoginRedirect(location)) {
    throw new Error(`TradeMining login did not create an authenticated session. ImportSearch redirected to login: ${location}.`);
  }
  assertOk(response, "TradeMining ImportSearch page failed");
  return response.text();
}

async function submitTradeMiningSearch(session: TradeMiningSession, params: TradeMiningSearchParams, token: string) {
  const form = new URLSearchParams();
  for (const field of TRADEMINING_SEARCH_FIELDS) {
    form.set(field, params[field] === null || params[field] === undefined ? "" : String(params[field]));
  }
  form.set("BillTypeHouse", params.BillTypeHouse === undefined ? "on" : String(params.BillTypeHouse ?? ""));
  form.set("BillTypeNormal", params.BillTypeNormal === undefined ? "on" : String(params.BillTypeNormal ?? ""));
  form.set("ContainerLoad", params.ContainerLoad === undefined ? "All" : String(params.ContainerLoad ?? ""));
  form.set("ContainerFlag", params.ContainerFlag === undefined ? "All" : String(params.ContainerFlag ?? ""));
  form.set("__RequestVerificationToken", token);
  const response = await session.postForm(IMPORT_SEARCH_DATA_PATH, form, {
    Referer: new URL(IMPORT_SEARCH_PATH, session.origin).toString()
  });
  const location = response.headers.get("location");
  const searchId = location ? extractSearchId(location) : extractSearchId(await response.text());
  if (!searchId) {
    throw new Error(`TradeMining search completed without a discoverable search ID. status=${response.status} redirect=${location ?? "none"}`);
  }
  return searchId;
}

async function exportTradeMiningResults(session: TradeMiningSession, searchId: string) {
  const form = new URLSearchParams();
  form.set("jsonString", JSON.stringify({ columns: TRADEMINING_EXPORT_COLUMNS }));
  form.set("sort", "");
  form.set("filter", "");
  form.set("ExcelPageNumber", "0");
  const response = await session.postForm(`/ImportSearch/ExportToExcel/${encodeURIComponent(searchId)}`, form);
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`TradeMining export failed with status ${response.status}.`);
  }
  return response;
}

function extractRequestVerificationToken(html: string) {
  const match = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i);
  if (!match?.[1]) {
    throw new Error("Could not find TradeMining __RequestVerificationToken.");
  }
  return decodeHtmlEntity(match[1]);
}

function extractFormFields(html: string) {
  const form = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const input = match[0];
    const name = readHtmlAttribute(input, "name");
    if (name) {
      form.set(name, readHtmlAttribute(input, "value") ?? "");
    }
  }
  return form;
}

function parseFirstWorksheet(workbook: Buffer): TradeMiningExcelRow[] {
  const entries = readZipEntries(workbook);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  const worksheetPath = [...entries.keys()].find((key) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(key));
  const worksheetXml = worksheetPath ? entries.get(worksheetPath)?.toString("utf8") : null;
  if (!worksheetXml) return [];
  const rows = parseWorksheetRows(worksheetXml, sharedStrings);
  const headers = rows[3]?.map((header) => header.replace(/\s+/g, " ").trim()) ?? [];
  return rows
    .slice(4)
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]).filter(([header]) => header)));
}

function parseSharedStrings(xml: string) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => extractTextFromXml(match[1]));
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = cellMatch[1].match(/\br=["']([A-Z]+)\d+["']/i)?.[1];
      const index = ref ? columnNameToIndex(ref) : cells.length;
      cells[index] = parseCellValue(cellMatch[1], cellMatch[2], sharedStrings);
    }
    return cells.map((value) => value ?? "");
  });
}

function parseCellValue(attrs: string, body: string, sharedStrings: string[]) {
  const type = attrs.match(/\bt=["']([^"']+)["']/i)?.[1];
  if (type === "inlineStr") return extractTextFromXml(body);
  const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
  return type === "s" ? sharedStrings[Number(rawValue)] ?? "" : decodeHtmlEntity(rawValue);
}

function readZipEntries(buffer: Buffer) {
  const entries = new Map<string, Buffer>();
  const centralDirectory = findEndOfCentralDirectory(buffer);
  const size = buffer.readUInt32LE(centralDirectory + 12);
  const start = buffer.readUInt32LE(centralDirectory + 16);
  let offset = start;
  while (offset < start + size && buffer.readUInt32LE(offset) === 0x02014b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.set(fileName, readZipEntry(buffer, localHeaderOffset, compressionMethod, compressedSize));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, offset: number, compressionMethod: number, compressedSize: number) {
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
  if (compressionMethod === 0) return Buffer.from(compressed);
  if (compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported XLSX compression method ${compressionMethod}.`);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid XLSX file: missing central directory.");
}

function extractTextFromXml(xml: string) {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeHtmlEntity(match[1])).join("");
}

function columnNameToIndex(name: string) {
  return [...name.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function readTradeMiningCredentialsFromEnv() {
  const username = process.env.TRADEMINING_USER?.trim();
  const password = process.env.TRADEMINING_PASSWORD?.trim();
  if (!username || !password) throw new Error("TRADEMINING_USER and TRADEMINING_PASSWORD are required.");
  return { username, password };
}

function readSetCookieHeaders(headers: Headers) {
  const headerWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  return typeof headerWithGetSetCookie.getSetCookie === "function"
    ? headerWithGetSetCookie.getSetCookie()
    : headers.get("set-cookie")?.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((cookie) => cookie.trim()) ?? [];
}

function extractFormAction(html: string) {
  return readHtmlAttribute(html.match(/<form\b[^>]*>/i)?.[0] ?? "", "action");
}

function readHtmlAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeHtmlEntity(match[1]) : null;
}

function extractSearchId(value: string) {
  const match = decodeHtmlEntity(value).match(/\/ImportSearch\/Results\/([^/?#"']+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function readDownloadFileName(headers: Headers) {
  return headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function isLoginRedirect(location: string) {
  return /\/Account\/LogIn\b|\/Account\/Login\b/i.test(location);
}

function assertOk(response: Pick<Response, "status">, message: string) {
  if (response.status < 200 || response.status >= 400) throw new Error(`${message} with status ${response.status}.`);
}

function decodeHtmlEntity(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
