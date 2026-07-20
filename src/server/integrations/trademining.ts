import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const DEFAULT_BASE_URL = "https://www.trademining.com";
const LOGIN_PAGE_PATH = "/Account/LogIn";
const LOGIN_POST_PATH = "/Account/Login";
const IMPORT_SEARCH_PATH = "/ImportSearch";
const IMPORT_SEARCH_DATA_PATH = "/ImportSearch/Data";
const TRADEMINING_DOWNLOAD_DIR = path.join(process.cwd(), ".tmp", "trademining-downloads");
const TRADEMINING_BROWSER_EXPORT_COLUMNS = [
  { field: "Select", hidden: true, width: 60 },
  { field: "Id", title: "Id", hidden: true, width: 60 },
  { field: "Id", title: "Id", hidden: true, width: 60 },
  { field: "ArrivalDate", title: "Arrival Date", width: 200, format: "{0:MM-dd-yyyy}" },
  { field: "CountryOfOrigin.Name", title: "Country Of Origin", width: 200 },
  { field: "TEU", title: "TEU", width: 100 },
  { field: "ConsigneeGroup.Name", title: "Consignee Name", width: 600 },
  { field: "NotifyGroup.Name", title: "Notify Name", width: 600 },
  { field: "ShipperGroup.Name", title: "Shipper Name", width: 600 },
  { field: "Commodity", title: "Container Content", width: 450, sortable: false },
  { field: "HSCode", title: "HS Code", width: 150, sortable: false },
  { field: "ContainerCount", title: "Container Count", width: 150 },
  { field: "ConsigneeAddress.AddressLine1", title: "Consignee Address", width: 600 },
  { field: "ConsigneeAddress.City", title: "Consignee City", width: 200 },
  { field: "ConsigneeAddress.Region.Name", title: "Consignee State", width: 400 },
  { field: "ConsigneeAddress.PostCode", title: "Consignee Zip", width: 200 },
  { field: "PortOfUnlading.Name", title: "US Arrival Port", width: 250 },
  { field: "ForeignPort.Name", title: "Foreign Port", width: 250 },
  { field: "PlaceOfReceipt", title: "Place Of Receipt", width: 280 },
  { field: "ShipperAddress.AddressLine1", title: "Shipper Address", width: 600 },
  { field: "ShipperAddress.City", title: "Shipper City", width: 200 },
  { field: "ShipperAddress.Region.Name", title: "Shipper State", width: 400 },
  { field: "MarksAndNumbers", title: "Marks And Numbers", width: 450, sortable: false },
  { field: "NVOCCCode.Name", title: "NVOCC Name", width: 250 },
  { field: "VOCCCode.Name", title: "VOCC Name", width: 250 },
  { field: "MasterConsigneeGroup.Name", title: "Master Consignee Name", width: 600 },
  { field: "MasterShipperGroup.Name", title: "Master Shipper Name", width: 600 },
  { field: "NotifyAddress.City", title: "Notify City", width: 200 },
  { field: "NotifyAddress.Region.Name", title: "Notify State", width: 400 },
  { field: "NotifyAddress.PostCode", title: "Notify Zip", width: 200 },
  { field: "NotifyAddress.Country.Name", title: "Notify Country", width: 200 },
  { field: "TeuType", title: "Container Load", width: 150 },
  { field: "Weight", title: "Weight(KG)", width: 150, format: "{0:n}" },
  { field: "WeightTon", title: "Weight(M. Ton)", width: 200, format: "{0:n}" },
  { field: "Volume", title: "Volume(CM)", width: 150, format: "{0:n}" },
  { field: "Quantity", title: "Quantity", width: 150, format: "{0:n}" },
  { field: "QuantityUnit", title: "Quantity Unit", width: 150 },
  { field: "ContainerFlag", title: "Containerized", width: 150 },
  { field: "DistributionPort.Name", title: "US Inland Clearing Port", width: 250 },
  { field: "BillType.Description", title: "Bill Type", width: 150 },
  { field: "CarrierCode.Name", title: "Carrier Name", width: 250 },
  { field: "Vessel.Name", title: "Vessel Name", width: 250 },
  { field: "VoyageNumber", title: "Voyage", width: 200 },
  { field: "HouseBolNumber", title: "House BOL Number", width: 200 },
  { field: "MasterBolNumber", title: "Master BOL Number", width: 200 },
  { field: "ContainerNumber", title: "Container Number", width: 150, sortable: false },
  { field: "BillTypeCode", title: "FROB Flag", width: 150 },
  { field: "VOCCCode.Code", title: "VOCC Code", width: 250 },
  { field: "CarrierCode.Code", title: "Carrier Code", width: 150 },
  { field: "NVOCCCode.Code", title: "NVOCC Code", width: 250 },
  { field: "ShipperAddress.Country.Name", title: "Shipper Country", width: 200 },
  { field: "ConsigneeAddress.Country.Name", title: "Consignee Country", width: 200 }
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

const TRADEMINING_MANUAL_SEARCH_FIELDS = [
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

export type TradeMiningCredentials = {
  username: string;
  password: string;
};

export type TradeMiningSearchParams = Partial<Record<TradeMiningSearchField, string | number | boolean | null | undefined>>;

export type TradeMiningSearchResult = {
  searchId: string;
  exportFileName: string | null;
  rows: TradeMiningExcelRow[];
  rawWorkbook: Buffer;
};

export type TradeMiningExcelRow = Record<string, string>;

type TradeMiningClientOptions = {
  baseUrl?: string;
  credentials?: TradeMiningCredentials;
  saveWorkbook?: boolean;
  loginFields?: {
    username: string;
    password: string;
  };
};

type HttpResponse = {
  status: number;
  headers: Headers;
  url: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

class TradeMiningHttpSession {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async get(path: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
    return this.request(path, {
      method: "GET",
      headers,
      redirect: "manual"
    });
  }

  async postForm(path: string, form: URLSearchParams, headers: Record<string, string> = {}): Promise<HttpResponse> {
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

  private async request(path: string, init: RequestInit): Promise<HttpResponse> {
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

  getCookieNames() {
    return [...this.cookies.keys()];
  }

  private cookieHeader(): Record<string, string> {
    if (this.cookies.size === 0) {
      return {};
    }

    return {
      Cookie: [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
    };
  }

  private storeCookies(headers: Headers) {
    const values = readSetCookieHeaders(headers);
    for (const value of values) {
      const [cookie] = value.split(";");
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      this.cookies.set(cookie.slice(0, separatorIndex).trim(), cookie.slice(separatorIndex + 1).trim());
    }
  }
}

export async function searchTradeMining(
  params: TradeMiningSearchParams,
  options: TradeMiningClientOptions = {}
): Promise<TradeMiningSearchResult> {
  const baseUrl = options.baseUrl ?? process.env.TRADEMINING_BASE_URL?.trim() ?? DEFAULT_BASE_URL;
  const credentials = options.credentials ?? readTradeMiningCredentialsFromEnv();
  const loginFields = options.loginFields ?? {
    username: process.env.TRADEMINING_LOGIN_USERNAME_FIELD?.trim() || "Email",
    password: process.env.TRADEMINING_LOGIN_PASSWORD_FIELD?.trim() || "Password"
  };
  const session = new TradeMiningHttpSession(baseUrl);

  await loginToTradeMining(session, credentials, loginFields);
  debugTradeMiningSession("TradeMining login completed", session);
  const importSearchPage = await fetchImportSearchPage(session);
  const verificationToken = extractRequestVerificationToken(importSearchPage);
  const searchId = await submitTradeMiningSearch(session, params, verificationToken, importSearchPage);
  const exportResponse = await exportTradeMiningResults(session, searchId);

  const exportFileName = readDownloadFileName(exportResponse.headers);
  const rawWorkbook = Buffer.from(await exportResponse.arrayBuffer());
  if (options.saveWorkbook ?? true) {
    const savedWorkbookPath = await saveTradeMiningWorkbook(searchId, exportFileName, rawWorkbook);
    console.log(`TradeMining workbook saved to: ${savedWorkbookPath}`);
  }
  debugDownloadedReportCriteria(rawWorkbook);

  return {
    searchId,
    exportFileName,
    rows: parseFirstWorksheet(rawWorkbook),
    rawWorkbook
  };
}

async function loginToTradeMining(
  session: TradeMiningHttpSession,
  credentials: TradeMiningCredentials,
  loginFields: { username: string; password: string }
): Promise<void> {
  const loginPageResponse = await session.get(LOGIN_PAGE_PATH);
  assertSuccessfulResponse(loginPageResponse, "TradeMining login page failed");
  const loginPage = await loginPageResponse.text();
  const token = extractRequestVerificationToken(loginPage);
  const loginFormAction = extractFormAction(loginPage) ?? LOGIN_POST_PATH;
  const form = extractFormFields(loginPage);
  debugTradeMiningLoginForm(loginFormAction, form, loginFields);
  form.set(loginFields.username, credentials.username);
  form.set(loginFields.password, credentials.password);
  form.set("__RequestVerificationToken", token);

  const response = await session.postForm(loginFormAction, form, {
    Origin: session.origin,
    Referer: new URL(LOGIN_PAGE_PATH, session.origin).toString()
  });

  if (![200, 302, 303].includes(response.status)) {
    throw new Error(`TradeMining login failed with status ${response.status}.`);
  }

  const location = response.headers.get("location");
  debugTradeMiningLoginResponse(response.status, location, session);
  if (location && isLoginRedirect(location)) {
    throw new Error(`TradeMining login was redirected back to the login page: ${location}`);
  }

  if (!location) {
    const body = await response.text();
    const loginError = extractVisibleLoginError(body);
    throw new Error(
      `TradeMining login did not redirect after form submit. Status: ${response.status}. ` +
        `Visible login error: ${loginError ?? "none found"}. ` +
        `Captured cookies: ${summarizeCookieNames(session.getCookieNames())}`
    );
  }

  const redirectResponse = await session.get(location);
  const redirectLocation = redirectResponse.headers.get("location");
  if (redirectLocation && isLoginRedirect(redirectLocation)) {
    throw new Error(`TradeMining login redirect returned to the login page: ${redirectLocation}`);
  }
}

async function fetchImportSearchPage(session: TradeMiningHttpSession): Promise<string> {
  const response = await session.get(IMPORT_SEARCH_PATH);
  const location = response.headers.get("location");
  if (location && isLoginRedirect(location)) {
    throw new Error(
      `TradeMining login did not create an authenticated session. ImportSearch redirected to login: ${location}. ` +
        `Captured cookies: ${summarizeCookieNames(session.getCookieNames())}`
    );
  }

  assertSuccessfulResponse(response, "TradeMining ImportSearch page failed");
  return response.text();
}

async function submitTradeMiningSearch(
  session: TradeMiningHttpSession,
  params: TradeMiningSearchParams,
  verificationToken: string,
  importSearchPage: string
): Promise<string> {
  const form = buildTradeMiningSearchForm(params, verificationToken, importSearchPage);
  debugTradeMiningSession("Submitting TradeMining search", session);
  const response = await session.postForm(IMPORT_SEARCH_DATA_PATH, form, {
    Referer: new URL(IMPORT_SEARCH_PATH, session.origin).toString()
  });
  const location = response.headers.get("location");
  const searchId = location ? extractSearchIdFromLocation(location) : null;

  if (searchId) {
    debugTradeMiningSearchResult(response.status, location, searchId);
    return searchId;
  }

  const body = await response.text();
  const bodySearchId = extractSearchId(body);
  if (bodySearchId) {
    debugTradeMiningSearchResult(response.status, location, bodySearchId);
    return bodySearchId;
  }

  throw new Error(
    `TradeMining search completed without a discoverable search ID. Response status: ${response.status}. ` +
      `Redirect location: ${location ?? "none"}. ` +
      `Content-Type: ${response.headers.get("content-type") ?? "unknown"}. Body preview: ${summarizeResponseBody(body)}`
  );
}

async function exportTradeMiningResults(session: TradeMiningHttpSession, searchId: string): Promise<HttpResponse> {
  const exportPath = `/ImportSearch/ExportToExcel/${encodeURIComponent(searchId)}`;
  const exportForm = buildTradeMiningExportForm();
  debugTradeMiningDirectExport(searchId, exportPath, exportForm);
  const exportResponse = await session.postForm(exportPath, exportForm);

  if (exportResponse.status < 200 || exportResponse.status >= 400) {
    const body = await exportResponse.text();
    const visibleError = extractVisibleLoginError(body);
    throw new Error(
      `TradeMining export failed with status ${exportResponse.status}. ` +
        `Export method: POST. Export path: ${exportPath}. ` +
        `Redirect location: ${exportResponse.headers.get("location") ?? "none"}. ` +
        `Content-Type: ${exportResponse.headers.get("content-type") ?? "unknown"}. ` +
        `Visible error: ${visibleError ?? "none found"}. Body preview: ${summarizeResponseBody(body)}`
    );
  }

  return exportResponse;
}

function buildTradeMiningExportForm(): URLSearchParams {
  const form = new URLSearchParams();
  form.set("jsonString", JSON.stringify({ columns: TRADEMINING_BROWSER_EXPORT_COLUMNS }));
  form.set("sort", "");
  form.set("filter", "");
  form.set("ExcelPageNumber", "0");
  return form;
}

function buildTradeMiningSearchForm(
  params: TradeMiningSearchParams,
  verificationToken: string,
  importSearchPage: string
): URLSearchParams {
  const form = new URLSearchParams();
  for (const field of TRADEMINING_MANUAL_SEARCH_FIELDS) {
    const value = params[field];
    if (value !== null && value !== undefined) {
      form.set(field, String(value));
    } else {
      form.set(field, "");
    }
  }

  applyTradeMiningDateDefaults(form, params, importSearchPage);
  applyTradeMiningBillTypeDefaults(form, params);
  applyTradeMiningRadioDefaults(form, params);
  form.set("__RequestVerificationToken", verificationToken);
  assertNoDuplicateFormFields(form);
  debugTradeMiningSearchForm(form, importSearchPage);
  return form;
}

function applyTradeMiningBillTypeDefaults(form: URLSearchParams, params: TradeMiningSearchParams) {
  if (params.BillTypeHouse === null || params.BillTypeHouse === undefined) {
    form.set("BillTypeHouse", "on");
  }

  if (params.BillTypeNormal === null || params.BillTypeNormal === undefined) {
    form.set("BillTypeNormal", "on");
  }
}

function applyTradeMiningRadioDefaults(form: URLSearchParams, params: TradeMiningSearchParams) {
  if (params.ContainerLoad === null || params.ContainerLoad === undefined) {
    form.set("ContainerLoad", "All");
  }

  if (params.ContainerFlag === null || params.ContainerFlag === undefined) {
    form.set("ContainerFlag", "All");
  }
}

function assertNoDuplicateFormFields(form: URLSearchParams) {
  const counts = new Map<string, number>();
  for (const key of form.keys()) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length > 0) {
    throw new Error(`TradeMining search form contains duplicate fields: ${duplicates.join(", ")}`);
  }
}

function extractRequestVerificationToken(html: string): string {
  const tokenMatch = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i);
  if (!tokenMatch?.[1]) {
    throw new Error("Could not find TradeMining __RequestVerificationToken.");
  }

  return decodeHtmlEntity(tokenMatch[1]);
}

function extractFormFields(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const input = match[0];
    const name = readHtmlAttribute(input, "name");
    if (!name) {
      continue;
    }

    const type = (readHtmlAttribute(input, "type") ?? "text").toLowerCase();
    const value = readHtmlAttribute(input, "value") ?? "";
    const checked = hasHtmlAttribute(input, "checked");

    if (type === "radio") {
      if (checked) {
        form.set(name, value);
      }
      continue;
    }

    if (type === "checkbox") {
      if (checked) {
        form.set(name, value);
      } else if (!form.has(name)) {
        form.set(name, "");
      }
      continue;
    }

    form.set(name, value);
  }

  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const openTag = match[0].match(/<select\b[^>]*>/i)?.[0] ?? "";
    const name = readHtmlAttribute(openTag, "name");
    if (!name) {
      continue;
    }

    form.set(name, readSelectedOptionValue(match[2]));
  }

  for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const openTag = match[0].match(/<textarea\b[^>]*>/i)?.[0] ?? "";
    const name = readHtmlAttribute(openTag, "name");
    if (!name) {
      continue;
    }

    form.set(name, decodeHtmlEntity(match[2]).trim());
  }

  return form;
}

function readSelectedOptionValue(selectBody: string) {
  const options = [...selectBody.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)];
  const selectedOption = options.find((option) => /\sselected(?:=["'][^"']*["'])?/i.test(option[0])) ?? options[0];
  if (!selectedOption) {
    return "";
  }

  const value = readHtmlAttribute(selectedOption[0], "value");
  return value ?? stripHtml(selectedOption[1]).trim();
}

function hasHtmlAttribute(tag: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}(?:\\s*=|\\s|>|$)`, "i").test(tag);
}

function extractNamedFormFields(html: string, formId: string): URLSearchParams {
  const form = findFormById(html, formId);
  return form ? extractFormFields(form.html) : new URLSearchParams();
}

function findFormById(html: string, formId: string): { openTag: string; html: string } | null {
  for (const match of html.matchAll(/(<form\b[^>]*>)([\s\S]*?<\/form>)/gi)) {
    const openTag = match[1];
    if (readHtmlAttribute(openTag, "id") !== formId) {
      continue;
    }

    return {
      openTag,
      html: `${match[1]}${match[2]}`
    };
  }

  return null;
}

function extractGridColumnState(html: string) {
  const columns = extractKendoGridColumns(html);
  if (columns.length === 0) {
    return null;
  }

  if (process.env.TRADEMINING_DEBUG === "true") {
    console.log(`TradeMining export grid columns extracted: ${columns.length}`);
    console.log(`TradeMining export grid columns preview: ${summarizeGridColumns(columns)}`);
  }

  return JSON.stringify({
    columns
  });
}

function extractKendoGridColumns(html: string): unknown[] {
  const gridInitializerPattern = /(?:\$|jQuery)\(\s*["']#grid["']\s*\)\.kendoGrid\s*\(/gi;
  let initializerCount = 0;
  let columnsPropertyFound = false;
  for (const match of html.matchAll(gridInitializerPattern)) {
    initializerCount += 1;
    const objectStart = html.indexOf("{", match.index + match[0].length);
    if (objectStart < 0) {
      continue;
    }

    const gridOptions = readBalancedJavaScriptObject(html, objectStart);
    if (!gridOptions) {
      continue;
    }

    const columnsArray = extractColumnsArrayFromGridOptions(gridOptions);
    if (columnsArray) {
      columnsPropertyFound = true;
    }

    const columns = columnsArray ? parseKendoColumnsArray(columnsArray) : [];
    if (columns.length > 0) {
      return columns;
    }
  }

  if (process.env.TRADEMINING_DEBUG === "true") {
    console.log(`TradeMining #grid kendoGrid initializers found: ${initializerCount}`);
    console.log(`TradeMining #grid columns property found: ${columnsPropertyFound}`);
  }

  return extractColumnsFromRenderedGrid(html);
}

function extractColumnsArrayFromGridOptions(gridOptions: string): string | null {
  const property = findTopLevelJavaScriptProperty(gridOptions, "columns");
  if (!property) {
    return null;
  }

  const arrayStart = gridOptions.indexOf("[", property.valueStart);
  if (arrayStart < 0) {
    return null;
  }

  return readBalancedJavaScriptArray(gridOptions, arrayStart);
}

function parseKendoColumnsArray(arrayText: string): unknown[] {
  try {
    return JSON.parse(toJsonCompatibleJavaScript(arrayText));
  } catch {
    return [];
  }
}

function findTopLevelJavaScriptProperty(source: string, propertyName: string): { valueStart: number } | null {
  let objectDepth = 0;
  let arrayDepth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      if (objectDepth === 1 && arrayDepth === 0) {
        const match = readQuotedPropertyName(source, index);
        if (match?.name === propertyName) {
          const colonIndex = skipWhitespace(source, match.endIndex);
          if (source[colonIndex] === ":") {
            return {
              valueStart: skipWhitespace(source, colonIndex + 1)
            };
          }
        }
      }

      quote = char;
      continue;
    }

    if (char === "{") {
      objectDepth += 1;
      continue;
    }

    if (char === "}") {
      objectDepth -= 1;
      continue;
    }

    if (char === "[") {
      arrayDepth += 1;
      continue;
    }

    if (char === "]") {
      arrayDepth -= 1;
      continue;
    }

    if (objectDepth === 1 && arrayDepth === 0 && isIdentifierStart(char)) {
      const endIndex = readIdentifierEnd(source, index);
      const name = source.slice(index, endIndex);
      const colonIndex = skipWhitespace(source, endIndex);
      if (name === propertyName && source[colonIndex] === ":") {
        return {
          valueStart: skipWhitespace(source, colonIndex + 1)
        };
      }

      index = endIndex - 1;
    }
  }

  return null;
}

function readQuotedPropertyName(source: string, startIndex: number): { name: string; endIndex: number } | null {
  const quote = source[startIndex];
  let escaped = false;
  let value = "";

  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === quote) {
      return {
        name: value,
        endIndex: index + 1
      };
    }

    value += char;
  }

  return null;
}

function skipWhitespace(source: string, startIndex: number) {
  let index = startIndex;
  while (/\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_$]/.test(char);
}

function readIdentifierEnd(source: string, startIndex: number) {
  let index = startIndex + 1;
  while (/[\w$]/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function extractColumnsFromRenderedGrid(html: string): unknown[] {
  const columns = [...html.matchAll(/<th\b[^>]*\bdata-field=["']([^"']+)["'][^>]*>([\s\S]*?)<\/th>/gi)]
    .map((match) => ({
      field: decodeHtmlEntity(match[1]),
      title: stripHtml(match[2]).trim() || decodeHtmlEntity(match[1])
    }));

  return columns;
}

function summarizeGridColumns(columns: unknown[]) {
  return columns
    .slice(0, 12)
    .map((column) => {
      if (!column || typeof column !== "object") {
        return "";
      }

      const record = column as { field?: unknown; title?: unknown };
      return String(record.field ?? record.title ?? "").trim();
    })
    .filter(Boolean)
    .join(", ") || "none";
}

function readBalancedJavaScriptObject(value: string, startIndex: number): string | null {
  return readBalancedJavaScriptBlock(value, startIndex, "{", "}");
}

function readBalancedJavaScriptArray(value: string, startIndex: number): string | null {
  return readBalancedJavaScriptBlock(value, startIndex, "[", "]");
}

function readBalancedJavaScriptBlock(value: string, startIndex: number, openChar: string, closeChar: string): string | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function toJsonCompatibleJavaScript(value: string) {
  return stripJavaScriptFunctionProperties(value)
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
}

function stripJavaScriptFunctionProperties(value: string) {
  return value.replace(/,\s*[A-Za-z_$][\w$]*\s*:\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}(?=\s*[,}])/g, "");
}

type TradeMiningExportRequest = {
  method: "GET" | "POST";
  path: string;
  form: URLSearchParams;
};

async function extractTradeMiningExportRequest(
  session: TradeMiningHttpSession,
  resultsPage: string,
  searchId: string
): Promise<TradeMiningExportRequest> {
  const exportForm = findFormByAction(resultsPage, /ExportToExcel/i);
  if (exportForm) {
    const action = readHtmlAttribute(exportForm.openTag, "action");
    if (!action) {
      throw new Error("TradeMining results page export form did not include an action.");
    }

    const method = readHtmlAttribute(exportForm.openTag, "method")?.toUpperCase() === "GET" ? "GET" : "POST";
    const form = extractFormFields(exportForm.html);
    ensureVerificationToken(form, resultsPage);
    return {
      method,
      path: action,
      form
    };
  }

  const exportLink = findExportLink(resultsPage);
  if (exportLink) {
    return {
      method: "GET",
      path: exportLink,
      form: new URLSearchParams()
    };
  }

  const functionRequest = extractExportToExcelFunctionRequest(resultsPage, searchId);
  if (functionRequest) {
    return functionRequest;
  }

  const scriptInspection = await inspectExternalExportScripts(session, resultsPage, searchId);
  if (scriptInspection.request) {
    return scriptInspection.request;
  }

  const exportFunction = extractJavaScriptFunction(resultsPage, "ExportToExcel") ?? scriptInspection.functionBody;

  throw new Error(
    `TradeMining results page did not expose a real ExportToExcel HTTP request for search ID ${searchId}. ` +
      `ExportToExcel function: ${exportFunction ? summarizeJavaScript(exportFunction) : "not found"}. ` +
      `Scripts checked: ${scriptInspection.scriptsChecked.join(", ") || "none"}. ` +
      `Export candidates: ${summarizeExportCandidates(resultsPage)}`
  );
}

function findFormByAction(html: string, actionPattern: RegExp): { openTag: string; html: string } | null {
  for (const match of html.matchAll(/(<form\b[^>]*>)([\s\S]*?<\/form>)/gi)) {
    const openTag = match[1];
    const formHtml = `${match[1]}${match[2]}`;
    const action = readHtmlAttribute(openTag, "action") ?? "";
    if (actionPattern.test(action)) {
      return {
        openTag,
        html: formHtml
      };
    }
  }

  return null;
}

async function inspectExternalExportScripts(
  session: TradeMiningHttpSession,
  html: string,
  searchId: string
): Promise<{ request: TradeMiningExportRequest | null; functionBody: string | null; scriptsChecked: string[] }> {
  const scriptsChecked: string[] = [];
  for (const src of extractScriptSources(html)) {
    scriptsChecked.push(src);
    const response = await session.get(src);
    if (response.status < 200 || response.status >= 400) {
      continue;
    }

    const script = await response.text();
    if (!/ExportToExcel/i.test(script)) {
      continue;
    }

    const request = extractExportToExcelFunctionRequest(`${html}\n${script}`, searchId);
    const functionBody = extractJavaScriptFunction(script, "ExportToExcel") ?? summarizeMatchingScriptSnippet(script, "ExportToExcel");
    return {
      request,
      functionBody,
      scriptsChecked
    };
  }

  return {
    request: null,
    functionBody: null,
    scriptsChecked
  };
}

function extractScriptSources(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => decodeHtmlEntity(match[1]))
    .filter((src) => !/^https?:\/\/(?:www\.)?googletagmanager\.com\b/i.test(src));
}

function findExportLink(html: string): string | null {
  for (const match of html.matchAll(/<(?:a|button)\b[^>]*>/gi)) {
    const tag = match[0];
    const href = readHtmlAttribute(tag, "href") ?? readHtmlAttribute(tag, "formaction");
    if (href?.trim().toLowerCase().startsWith("javascript:")) {
      continue;
    }

    if (href && /ExportToExcel/i.test(href)) {
      return href;
    }
  }

  return null;
}

function extractExportToExcelFunctionRequest(html: string, searchId: string): TradeMiningExportRequest | null {
  const functionBody = extractJavaScriptFunction(html, "ExportToExcel");
  const generateExcelBody = extractJavaScriptFunction(html, "generateExcel");
  if (!functionBody && !generateExcelBody) {
    return null;
  }

  if (generateExcelBody?.includes('$("#form").attr("action", "/ImportSearch/ExportToExcel/" + searchLogId)')) {
    const form = extractNamedFormFields(html, "form");
    const gridColumnState = extractGridColumnState(html);
    if (gridColumnState) {
      form.set("jsonString", gridColumnState);
    } else {
      throw new Error("TradeMining export requires jsonString, but grid.columns could not be extracted from the results page.");
    }

    form.set("sort", "");
    form.set("filter", "");
    form.set("ExcelPageNumber", "0");

    return {
      method: "POST",
      path: `/ImportSearch/ExportToExcel/${encodeURIComponent(searchId)}`,
      form
    };
  }

  if (!functionBody) {
    return null;
  }

  const locationMatch =
    functionBody.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i) ??
    functionBody.match(/(?:window\.)?open\(\s*["']([^"']+)["']/i);
  if (locationMatch?.[1] && !locationMatch[1].trim().toLowerCase().startsWith("javascript:")) {
    return {
      method: "GET",
      path: decodeHtmlEntity(locationMatch[1]),
      form: new URLSearchParams()
    };
  }

  const ajaxUrl = functionBody.match(/\burl\s*:\s*["']([^"']+)["']/i)?.[1];
  if (ajaxUrl) {
    const ajaxType = functionBody.match(/\b(?:type|method)\s*:\s*["'](GET|POST)["']/i)?.[1]?.toUpperCase();
    return {
      method: ajaxType === "GET" ? "GET" : "POST",
      path: decodeHtmlEntity(ajaxUrl),
      form: new URLSearchParams()
    };
  }

  const formAction = functionBody.match(/\.attr\(\s*["']action["']\s*,\s*["']([^"']+)["']\s*\)/i)?.[1];
  if (formAction) {
    return {
      method: /submit\(\)/i.test(functionBody) ? "POST" : "GET",
      path: decodeHtmlEntity(formAction),
      form: new URLSearchParams()
    };
  }

  return null;
}

function extractJavaScriptFunction(html: string, functionName: string): string | null {
  const pattern = new RegExp(`function\\s+${escapeRegExp(functionName)}\\s*\\([^)]*\\)\\s*\\{`, "i");
  const match = pattern.exec(html);
  if (!match) {
    return null;
  }

  let depth = 0;
  for (let index = match.index + match[0].length - 1; index < html.length; index += 1) {
    const char = html[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(match.index, index + 1);
      }
    }
  }

  return null;
}

function summarizeMatchingScriptSnippet(script: string, pattern: string): string | null {
  const index = script.toLowerCase().indexOf(pattern.toLowerCase());
  if (index < 0) {
    return null;
  }

  const start = Math.max(0, index - 500);
  const end = Math.min(script.length, index + 1500);
  return script.slice(start, end);
}

function ensureVerificationToken(form: URLSearchParams, html: string) {
  if (form.has("__RequestVerificationToken")) {
    return;
  }

  const tokenMatch = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i);
  if (tokenMatch?.[1]) {
    form.set("__RequestVerificationToken", decodeHtmlEntity(tokenMatch[1]));
  }
}

function applyTradeMiningDateDefaults(
  form: URLSearchParams,
  params: TradeMiningSearchParams,
  importSearchPage: string
) {
  if (params.TradeStartDate) {
    form.set("TradeStartDate", String(params.TradeStartDate));
  }

  if (params.TradeEndDate) {
    form.set("TradeEndDate", String(params.TradeEndDate));
  }

  if (form.get("TradeStartDate")?.trim() && form.get("TradeEndDate")?.trim()) {
    return;
  }

  const startConfig = extractInputConfig(importSearchPage, "TradeStartDate");
  const endConfig = extractInputConfig(importSearchPage, "TradeEndDate");
  const format = detectTradeMiningDateFormat([startConfig, endConfig]);

  if (!form.get("TradeStartDate")?.trim()) {
    const value = startConfig?.value?.trim() || formatDateForTradeMining(addDays(new Date(), -365), format);
    form.set("TradeStartDate", value);
  }

  if (!form.get("TradeEndDate")?.trim()) {
    const value = endConfig?.value?.trim() || formatDateForTradeMining(new Date(), format);
    form.set("TradeEndDate", value);
  }
}

function extractInputConfig(html: string, fieldName: string) {
  const input = [...html.matchAll(/<input\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => readHtmlAttribute(tag, "name") === fieldName || readHtmlAttribute(tag, "id") === fieldName);

  if (!input) {
    return null;
  }

  return {
    name: readHtmlAttribute(input, "name"),
    id: readHtmlAttribute(input, "id"),
    type: readHtmlAttribute(input, "type"),
    value: readHtmlAttribute(input, "value"),
    placeholder: readHtmlAttribute(input, "placeholder") ?? readHtmlAttribute(input, "PlaceHolder"),
    format:
      readHtmlAttribute(input, "data-format") ??
      readHtmlAttribute(input, "data-val-date") ??
      readHtmlAttribute(input, "data-role")
  };
}

function detectTradeMiningDateFormat(configs: Array<ReturnType<typeof extractInputConfig>>) {
  for (const config of configs) {
    const candidates = [config?.value, config?.placeholder, config?.format].filter(Boolean) as string[];
    for (const candidate of candidates) {
      if (/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(candidate) || /m{1,2}\/d{1,2}\/y{4}/i.test(candidate)) {
        return "MM/dd/yyyy";
      }

      if (/\b\d{4}-\d{1,2}-\d{1,2}\b/.test(candidate) || /y{4}-m{1,2}-d{1,2}/i.test(candidate)) {
        return "yyyy-MM-dd";
      }
    }
  }

  throw new Error(
    "TradeMining ImportSearch date format could not be determined from the real search form. " +
      `Date fields: ${summarizeDateInputConfigs(configs)}`
  );
}

function formatDateForTradeMining(date: Date, format: "MM/dd/yyyy" | "yyyy-MM-dd") {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (format === "yyyy-MM-dd") {
    return `${year}-${month}-${day}`;
  }

  return `${month}/${day}/${year}`;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function summarizeDateInputConfigs(configs: Array<ReturnType<typeof extractInputConfig>>) {
  return configs
    .map((config) =>
      config
        ? `{name:${config.name ?? ""}, id:${config.id ?? ""}, type:${config.type ?? ""}, value:${config.value ?? ""}, placeholder:${config.placeholder ?? ""}, format:${config.format ?? ""}}`
        : "missing"
    )
    .join("; ");
}

function extractFormAction(html: string): string | null {
  const formTag = html.match(/<form\b[^>]*>/i)?.[0];
  return formTag ? readHtmlAttribute(formTag, "action") : null;
}

function readHtmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeHtmlEntity(match[1]) : null;
}

function isLoginRedirect(location: string): boolean {
  return /\/Account\/LogIn\b|\/Account\/Login\b/i.test(location);
}

function extractVisibleLoginError(html: string): string | null {
  const candidates = [
    ...html.matchAll(/<div\b[^>]*class=["'][^"']*(?:validation-summary-errors|text-danger|alert-danger|messages)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi),
    ...html.matchAll(/<span\b[^>]*class=["'][^"']*(?:field-validation-error|text-danger)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)
  ];

  for (const candidate of candidates) {
    const text = stripHtml(candidate[1]).trim();
    if (text) {
      return text;
    }
  }

  return null;
}

function stripHtml(value: string) {
  return decodeHtmlEntity(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function debugTradeMiningSession(message: string, session: TradeMiningHttpSession) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`${message}. Cookies: ${summarizeCookieNames(session.getCookieNames())}`);
}

function debugTradeMiningLoginForm(
  action: string,
  form: URLSearchParams,
  loginFields: { username: string; password: string }
) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`TradeMining login form action: ${action}`);
  console.log(`TradeMining login form fields: ${summarizeFormFieldNames(form)}`);
  console.log(`TradeMining username field configured: ${loginFields.username}`);
  console.log(`TradeMining password field configured: ${loginFields.password}`);
}

function debugTradeMiningLoginResponse(status: number, location: string | null, session: TradeMiningHttpSession) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`TradeMining login response status: ${status}`);
  console.log(`TradeMining login redirect location: ${location ?? "none"}`);
  console.log(`TradeMining cookies after login response: ${summarizeCookieNames(session.getCookieNames())}`);
}

function summarizeFormFieldNames(form: URLSearchParams) {
  return [...new Set([...form.keys()])].join(", ");
}

function debugTradeMiningSearchForm(form: URLSearchParams, importSearchPage: string) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`TradeMining search form fields: ${summarizeFormFieldNames(form)}`);
  console.log(
    `TradeMining date fields: ${summarizeDateInputConfigs([
      extractInputConfig(importSearchPage, "TradeStartDate"),
      extractInputConfig(importSearchPage, "TradeEndDate")
    ])}`
  );
  console.log(`TradeMining submitted TradeStartDate: ${form.get("TradeStartDate") ?? ""}`);
  console.log(`TradeMining submitted TradeEndDate: ${form.get("TradeEndDate") ?? ""}`);
  console.log(`TradeMining submitted ContainerLoad: ${form.get("ContainerLoad") ?? ""}`);
  console.log(`TradeMining submitted ContainerFlag: ${form.get("ContainerFlag") ?? ""}`);
  console.log(`TradeMining ContainerLoad radio options: ${summarizeRadioOptions(importSearchPage, "ContainerLoad")}`);
  console.log(`TradeMining ContainerFlag radio options: ${summarizeRadioOptions(importSearchPage, "ContainerFlag")}`);
  console.log(`TradeMining submitted customer fields: ${summarizeCustomerSearchFields(form)}`);
  console.log(`TradeMining submitted field dump: ${summarizeSubmittedSearchFields(form)}`);
}

function debugTradeMiningExportRequest(exportRequest: TradeMiningExportRequest) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`TradeMining export method: ${exportRequest.method}`);
  console.log(`TradeMining export path: ${exportRequest.path}`);
  console.log(`TradeMining export form fields: ${summarizeFormFieldNames(exportRequest.form) || "none"}`);
  console.log(`TradeMining export jsonString: ${summarizeExportJsonString(exportRequest.form)}`);
}

function debugTradeMiningDirectExport(searchId: string, exportPath: string, form: URLSearchParams) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`TradeMining export using search ID: ${searchId}`);
  console.log(`TradeMining export method: POST`);
  console.log(`TradeMining export path: ${exportPath}`);
  console.log(`TradeMining export form fields: ${summarizeFormFieldNames(form)}`);
  console.log(`TradeMining export column count: ${TRADEMINING_BROWSER_EXPORT_COLUMNS.length}`);
}

function debugTradeMiningSearchResult(status: number, location: string | null, searchId: string) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`TradeMining search response status: ${status}`);
  console.log(`TradeMining search redirect location: ${location ?? "none"}`);
  console.log(`TradeMining captured search ID: ${searchId}`);
}

function debugTradeMiningExportSearchId(searchId: string, resultsPath: string) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  console.log(`TradeMining export using search ID: ${searchId}`);
  console.log(`TradeMining export results path: ${resultsPath}`);
}

function summarizeExportJsonString(form: URLSearchParams) {
  const value = form.get("jsonString");
  if (!value) {
    return "not submitted";
  }

  return `[set:${value.length} chars]`;
}

function summarizeRadioOptions(html: string, name: string) {
  const options = [...html.matchAll(/<input\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((input) => (readHtmlAttribute(input, "type") ?? "").toLowerCase() === "radio")
    .filter((input) => readHtmlAttribute(input, "name") === name)
    .map((input) => {
      const value = readHtmlAttribute(input, "value") ?? "";
      return `${value || "[blank]"}${hasHtmlAttribute(input, "checked") ? " (checked)" : ""}`;
    });

  return options.length > 0 ? options.join(", ") : "none found";
}

function summarizeCustomerSearchFields(form: URLSearchParams) {
  const fields = ["UnifiedSearch", "ConsigneeName", "ShipperName", "NotifyName", "MasterConsigneeName", "MasterShipperName"];
  return fields
    .map((field) => `${field}=${redactSearchFieldValue(field, form.get(field) ?? "")}`)
    .join("; ");
}

function summarizeSubmittedSearchFields(form: URLSearchParams) {
  return [...form.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${redactSearchFieldValue(name, value)}`)
    .join("; ");
}

function redactSearchFieldValue(name: string, value: string) {
  if (!value) {
    return "";
  }

  if (/__RequestVerificationToken|password|token|credential|secret/i.test(name)) {
    return "[redacted]";
  }

  if (/ConsigneeName|ShipperName|NotifyName|MasterConsigneeName|MasterShipperName|UnifiedSearch|Address|Zip|BolNumber|ContainerNumber/i.test(name)) {
    return `[set:${value.length} chars]`;
  }

  return value;
}

function extractSearchIdFromLocation(value: string): string | null {
  const match = decodeHtmlEntity(value).match(/\/ImportSearch\/Results\/([^/?#"']+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function extractSearchId(value: string): string | null {
  const decodedValue = decodeHtmlEntity(value);
  const patterns = [
    /\/ImportSearch\/Results\/([^/?#"']+)/i
  ];

  for (const pattern of patterns) {
    const match = decodedValue.match(pattern);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

function readTradeMiningCredentialsFromEnv(): TradeMiningCredentials {
  const username = process.env.TRADEMINING_USER?.trim();
  const password = process.env.TRADEMINING_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error("TRADEMINING_USER and TRADEMINING_PASSWORD are required.");
  }

  return {
    username,
    password
  };
}

function assertSuccessfulResponse(response: Pick<Response, "status">, message: string) {
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`${message} with status ${response.status}.`);
  }
}

function readSetCookieHeaders(headers: Headers): string[] {
  const headerWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headerWithGetSetCookie.getSetCookie === "function") {
    return headerWithGetSetCookie.getSetCookie();
  }

  const value = headers.get("set-cookie");
  return value ? splitSetCookieHeader(value) : [];
}

function splitSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((cookie) => cookie.trim());
}

function readDownloadFileName(headers: Headers): string | null {
  const disposition = headers.get("content-disposition");
  if (!disposition) {
    return null;
  }

  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}

async function saveTradeMiningWorkbook(searchId: string, exportFileName: string | null, workbook: Buffer) {
  await mkdir(TRADEMINING_DOWNLOAD_DIR, { recursive: true });
  const safeName = sanitizeFileName(exportFileName || `trademining-search-${searchId}.xlsx`);
  const fileName = safeName.toLowerCase().endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
  const filePath = path.join(TRADEMINING_DOWNLOAD_DIR, `${searchId}-${fileName}`);
  await writeFile(filePath, workbook);
  return filePath;
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, " ").trim();
}

function parseFirstWorksheet(workbook: Buffer): TradeMiningExcelRow[] {
  const entries = readZipEntries(workbook);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  let bestParse: { worksheetPath: string; headerRowIndex: number; headers: string[]; rows: TradeMiningExcelRow[] } | null = null;

  for (const worksheetPath of findWorksheetPaths(entries)) {
    const worksheetXml = entries.get(worksheetPath)?.toString("utf8");
    if (!worksheetXml) {
      continue;
    }

    const parsedRows = parseWorksheetRows(worksheetXml, sharedStrings);
    const parsedWorksheet = parseShipmentWorksheet(parsedRows);
    if (!parsedWorksheet) {
      continue;
    }

    if (!bestParse || parsedWorksheet.rows.length > bestParse.rows.length) {
      bestParse = {
        worksheetPath,
        ...parsedWorksheet
      };
    }
  }

  if (process.env.TRADEMINING_DEBUG === "true" && bestParse) {
    console.log(`TradeMining workbook worksheet: ${bestParse.worksheetPath}`);
    console.log(`TradeMining workbook header row: ${bestParse.headerRowIndex + 1}`);
    console.log(`TradeMining workbook columns: ${bestParse.headers.join(", ")}`);
    console.log(`TradeMining workbook shipment rows: ${bestParse.rows.length}`);
  }

  return bestParse?.rows ?? [];
}

function debugDownloadedReportCriteria(workbook: Buffer) {
  if (process.env.TRADEMINING_DEBUG !== "true") {
    return;
  }

  const criteria = readWorkbookCriteria(workbook);
  console.log(`TradeMining report Container Load criterion: ${criteria.containerLoad ?? "not found"}`);
  console.log(`TradeMining report Containerized criterion: ${criteria.containerized ?? "not found"}`);
  console.log(`TradeMining report Container Load is All: ${criteria.containerLoad ? String(/\ball\b/i.test(criteria.containerLoad)) : "unknown"}`);
  console.log(`TradeMining report Containerized is All: ${criteria.containerized ? String(/\ball\b/i.test(criteria.containerized)) : "unknown"}`);
}

function readWorkbookCriteria(workbook: Buffer): { containerLoad: string | null; containerized: string | null } {
  const entries = readZipEntries(workbook);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  const result = {
    containerLoad: null as string | null,
    containerized: null as string | null
  };

  for (const worksheetPath of findWorksheetPaths(entries)) {
    const worksheetXml = entries.get(worksheetPath)?.toString("utf8");
    if (!worksheetXml) {
      continue;
    }

    const rows = parseWorksheetRows(worksheetXml, sharedStrings);
    for (const row of rows) {
      const text = row.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (!result.containerLoad && /container\s*load/i.test(text)) {
        result.containerLoad = text;
      }

      if (!result.containerized && /containerized|container\s*flag/i.test(text)) {
        result.containerized = text;
      }
    }
  }

  return result;
}

function findWorksheetPaths(entries: Map<string, Buffer>): string[] {
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationshipTargets = new Map<string, string>();

  for (const relationship of relsXml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const id = readHtmlAttribute(relationship[0], "Id");
    const target = readHtmlAttribute(relationship[0], "Target");
    if (id && target) {
      relationshipTargets.set(id, `xl/${target.replace(/^\/?xl\//, "")}`);
    }
  }

  const paths = [...workbookXml.matchAll(/<sheet\b[^>]*r:id=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => relationshipTargets.get(match[1]))
    .filter((path): path is string => Boolean(path && entries.has(path)));

  if (paths.length > 0) {
    return paths;
  }

  return [...entries.keys()].filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path)).sort();
}

function parseShipmentWorksheet(rows: string[][]): { headerRowIndex: number; headers: string[]; rows: TradeMiningExcelRow[] } | null {
  const headerRowIndex = 3;
  if (rows.length <= headerRowIndex) {
    return null;
  }

  const headers = normalizeHeaderRow(rows[headerRowIndex]);
  if (headers.filter(Boolean).length === 0) {
    return null;
  }

  const dataRows = rows.slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => value.trim().length > 0))
    .map((row) => mapWorksheetRow(headers, row))
    .filter((row) => Object.values(row).some((value) => value.trim().length > 0));

  return {
    headerRowIndex,
    headers,
    rows: dataRows
  };
}

function normalizeHeaderRow(row: string[]): string[] {
  const seen = new Map<string, number>();
  return row.map((value, index) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }

    const count = seen.get(normalized.toLowerCase()) ?? 0;
    seen.set(normalized.toLowerCase(), count + 1);
    return count === 0 ? normalized : `${normalized} ${count + 1}`;
  });
}

function mapWorksheetRow(headers: string[], row: string[]): TradeMiningExcelRow {
  const entries = headers
    .map((header, index) => [header, row[index]?.trim() ?? ""] as const)
    .filter(([header]) => header);

  return Object.fromEntries(entries);
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) {
    return [];
  }

  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => extractTextFromXml(match[1]));
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br=["']([A-Z]+)\d+["']/i)?.[1];
      const index = ref ? columnNameToIndex(ref) : cells.length;
      cells[index] = parseCellValue(attrs, body, sharedStrings);
    }

    return cells.map((value) => value ?? "");
  });
}

function parseCellValue(attrs: string, body: string, sharedStrings: string[]): string {
  const type = attrs.match(/\bt=["']([^"']+)["']/i)?.[1];
  if (type === "inlineStr") {
    return extractTextFromXml(body);
  }

  const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  return decodeHtmlEntity(rawValue);
}

function extractTextFromXml(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeHtmlEntity(match[1])).join("");
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const endOfCentralDirectory = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(endOfCentralDirectory + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  while (offset < endOffset) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }

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

function readZipEntry(buffer: Buffer, localHeaderOffset: number, compressionMethod: number, compressedSize: number): Buffer {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid XLSX local file header.");
  }

  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return Buffer.from(compressed);
  }

  if (compressionMethod === 8) {
    return inflateRawSync(compressed);
  }

  throw new Error(`Unsupported XLSX compression method ${compressionMethod}.`);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Invalid XLSX file: missing central directory.");
}

function columnNameToIndex(name: string): number {
  return [...name.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeResponseBody(body: string) {
  return body.replace(/\s+/g, " ").slice(0, 500);
}

function summarizeCookieNames(names: string[]) {
  return names.length > 0 ? names.join(", ") : "none";
}

function summarizeExportCandidates(html: string) {
  const candidates = [
    ...[...html.matchAll(/<form\b[^>]*>/gi)].map((match) => match[0]),
    ...[...html.matchAll(/<(?:a|button)\b[^>]*(?:Export|Excel|formaction|href)[^>]*>/gi)].map((match) => match[0])
  ];

  return candidates.map((candidate) => stripHtml(candidate).trim() || candidate.replace(/\s+/g, " ")).slice(0, 10).join(" | ") || "none";
}

function summarizeJavaScript(value: string) {
  return value.replace(/__RequestVerificationToken["']?\s*[:=]\s*["'][^"']+/gi, "__RequestVerificationToken:[redacted]").replace(/\s+/g, " ").slice(0, 1000);
}
