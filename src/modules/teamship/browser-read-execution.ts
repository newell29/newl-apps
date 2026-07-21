import { chromium, type Browser, type Locator, type Page } from "playwright-core";

import {
  assertTeamshipReadControlAllowed,
  type TeamshipBrowserInventoryAllRow,
  type TeamshipBrowserLpnRow,
  type TeamshipBrowserProductHistory,
  type TeamshipBrowserReadAdapter,
  type TeamshipBrowserReceivingOrder
} from "@/modules/teamship/browser-read-contracts";
import type { TeamshipStoredCredentials } from "@/server/integrations/teamship-settings";

type RawCell = {
  text: string;
  links: string[];
};

type RawTable = {
  headers: string[];
  rows: RawCell[][];
};

export type TeamshipBrowserReadOptions = {
  appBaseUrl?: string;
  allowedHosts?: string[];
  browserExecutablePath?: string | null;
  headed?: boolean;
  navigationTimeoutMs?: number;
};

export type TeamshipBrowserReadRuntimeStatus = {
  enabled: boolean;
  configured: boolean;
  reason: string | null;
};

type TeamshipBrowserReadEnvironment = Record<string, string | undefined>;

const DEFAULT_APP_BASE_URL = "https://app.teamshipos.com";
const DEFAULT_ALLOWED_HOSTS = ["app.teamshipos.com", "members.fulfillit.io"];
let browserReadTail: Promise<void> = Promise.resolve();

export function getTeamshipBrowserReadRuntimeStatus(
  env: TeamshipBrowserReadEnvironment = process.env
): TeamshipBrowserReadRuntimeStatus {
  if (env.TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED !== "true") {
    return {
      enabled: false,
      configured: false,
      reason: "TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED is not true."
    };
  }

  if (!env.TEAMSHIP_BROWSER_EXECUTABLE_PATH?.trim()) {
    return {
      enabled: true,
      configured: false,
      reason: "TEAMSHIP_BROWSER_EXECUTABLE_PATH is not configured."
    };
  }

  return { enabled: true, configured: true, reason: null };
}

export function getConfiguredTeamshipBrowserReadAdapter(
  env: TeamshipBrowserReadEnvironment = process.env
): TeamshipBrowserReadAdapter | undefined {
  const status = getTeamshipBrowserReadRuntimeStatus(env);
  if (!status.configured) {
    return undefined;
  }

  return createTeamshipPlaywrightReadAdapter({
    appBaseUrl: env.TEAMSHIP_APP_BASE_URL?.trim() || DEFAULT_APP_BASE_URL,
    allowedHosts: parseAllowedHosts(env.TEAMSHIP_BROWSER_ALLOWED_HOSTS),
    browserExecutablePath: env.TEAMSHIP_BROWSER_EXECUTABLE_PATH?.trim() || null,
    headed: env.TEAMSHIP_BROWSER_READ_HEADED === "true",
    navigationTimeoutMs: readPositiveInteger(env.TEAMSHIP_BROWSER_READ_TIMEOUT_MS, 30_000)
  });
}

export function createTeamshipPlaywrightReadAdapter(
  options: TeamshipBrowserReadOptions = {}
): TeamshipBrowserReadAdapter {
  return {
    searchInventoryAll: (input) => runBrowserRead(input.credentials, options, async (page, baseUrl) => {
      await openReadPage(page, baseUrl, "/inventory", input.credentials, options);
      await assertPageContext(page, "/inventory", ["Inventory"]);
      await activateInventoryView(page, "All");
      await applyInventorySearch(page, input.sku);
      return parseInventoryAllTables(await readVisibleTables(page));
    }),
    searchLpn: (input) => runBrowserRead(input.credentials, options, async (page, baseUrl) => {
      await openReadPage(page, baseUrl, "/inventory", input.credentials, options);
      await assertPageContext(page, "/inventory", ["Inventory"]);
      await activateInventoryView(page, "Ship by LPN");
      await applyInventorySearch(page, input.query);
      return parseLpnTables(await readVisibleTables(page));
    }),
    getReceivingOrder: (input) => runBrowserRead(input.credentials, options, async (page, baseUrl) => {
      const route = `/inventory-orders/inventoryOrder/${encodeURIComponent(input.orderId)}`;
      await openReadPage(page, baseUrl, route, input.credentials, options);
      await assertPageContext(page, "/inventory-orders/inventoryOrder/", ["Receiving Order", "Inventory Order"]);
      return [parseReceivingOrderPage({
        requestedOrderId: input.orderId,
        fields: await readKnownLabelValues(page, [
          "Order ID",
          "Status",
          "Customer",
          "Company",
          "Company Name",
          "Warehouse",
          "Created",
          "Created At",
          "Order Creation Date",
          "ETA",
          "Est. Arrival Date",
          "Carrier",
          "BOL Number",
          "Pallet Count",
          "Pallet Counts",
          "Pallets"
        ]),
        items: await readReceivingItems(page),
        tables: await readVisibleTables(page),
        url: page.url()
      })];
    }),
    getProductHistory: (input) => runBrowserRead(input.credentials, options, async (page, baseUrl) => {
      const route = `/view-product/${encodeURIComponent(input.productId)}`;
      await openReadPage(page, baseUrl, route, input.credentials, options);
      await assertPageContext(page, "/view-product/", ["Product Details"]);
      return [parseProductHistoryPage({
        productId: input.productId,
        fields: await readProductDetailFields(page),
        tables: await readVisibleTables(page)
      })];
    })
  };
}

async function runBrowserRead<T>(
  credentials: TeamshipStoredCredentials,
  options: TeamshipBrowserReadOptions,
  read: (page: Page, baseUrl: URL) => Promise<T>
) {
  return withBrowserReadSlot(async () => {
    const allowedHosts = resolveAllowedHosts(options);
    const baseUrl = resolveBaseUrl(options, allowedHosts);
    const browser = await launchBrowser(options);
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(options.navigationTimeoutMs ?? 15_000);
      page.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 30_000);
      return await read(page, baseUrl);
    } finally {
      await browser.close();
    }
  });
}

async function withBrowserReadSlot<T>(read: () => Promise<T>) {
  const previous = browserReadTail;
  let release: () => void = () => {};
  browserReadTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await read();
  } finally {
    release();
  }
}

async function launchBrowser(options: TeamshipBrowserReadOptions): Promise<Browser> {
  return chromium.launch({
    executablePath: options.browserExecutablePath?.trim() || undefined,
    headless: !options.headed
  });
}

function resolveAllowedHosts(options: TeamshipBrowserReadOptions) {
  return new Set((options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS).map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function resolveBaseUrl(options: TeamshipBrowserReadOptions, allowedHosts: Set<string>) {
  const baseUrl = new URL(options.appBaseUrl?.trim() || DEFAULT_APP_BASE_URL);
  assertTeamshipBrowserPageUrlAllowed(baseUrl, allowedHosts);
  return baseUrl;
}

export function assertTeamshipBrowserPageUrlAllowed(
  value: string | URL,
  allowedHosts: ReadonlySet<string> = new Set(DEFAULT_ALLOWED_HOSTS)
) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Teamship browser reads require an allowlisted HTTPS page host.");
  }
}

async function openReadPage(
  page: Page,
  baseUrl: URL,
  route: string,
  credentials: TeamshipStoredCredentials,
  options: TeamshipBrowserReadOptions
) {
  const target = new URL(route, baseUrl);
  const allowedHosts = resolveAllowedHosts(options);
  await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs ?? 30_000 });
  assertTeamshipBrowserPageUrlAllowed(page.url(), allowedHosts);
  if (isLoginPage(page)) {
    await login(page, credentials, allowedHosts);
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs ?? 30_000 });
    assertTeamshipBrowserPageUrlAllowed(page.url(), allowedHosts);
  }
  await page.waitForLoadState("networkidle", { timeout: options.navigationTimeoutMs ?? 15_000 }).catch(() => undefined);
  const finalUrl = new URL(page.url());
  if (finalUrl.origin !== baseUrl.origin) {
    throw new Error("Teamship browser read did not return to the configured application host.");
  }
}

function isLoginPage(page: Page) {
  return /\/(?:login|sign-in)\b/i.test(new URL(page.url()).pathname);
}

async function login(
  page: Page,
  credentials: TeamshipStoredCredentials,
  allowedHosts: ReadonlySet<string>
) {
  assertTeamshipBrowserPageUrlAllowed(page.url(), allowedHosts);
  const email = await requireUniqueLocator([
    page.locator('#email:visible'),
    page.locator('input[name="email"]:visible'),
    page.locator('input[type="email"]:visible'),
    page.getByLabel("Email", { exact: true }),
    page.getByPlaceholder("E-Mail Address", { exact: true }),
    page.getByPlaceholder("Email", { exact: true })
  ], "Teamship email field");
  const password = await requireUniqueLocator([
    page.locator('input[type="password"]:visible'),
    page.getByLabel("Password", { exact: true }),
    page.getByPlaceholder("Password", { exact: true })
  ], "Teamship password field");
  const submit = await requireUniqueLocator([
    page.getByRole("button", { name: "LOGIN", exact: true }),
    page.getByRole("button", { name: "Login", exact: true }),
    page.getByRole("button", { name: "Sign in", exact: true })
  ], "Teamship login button");

  await email.fill(credentials.email);
  await password.fill(credentials.password);
  await submit.click();
  await page.waitForLoadState("domcontentloaded");
  assertTeamshipBrowserPageUrlAllowed(page.url(), allowedHosts);
}

async function assertPageContext(page: Page, expectedPath: string, headingCandidates: string[]) {
  const url = new URL(page.url());
  if (!url.pathname.startsWith(expectedPath)) {
    throw new Error(`Unexpected Teamship route for read-only extraction: ${url.pathname}`);
  }

  const headings = (await page.locator("h1:visible,h2:visible,h3:visible").allTextContents())
    .map(normalizeText)
    .filter(Boolean);
  const headingMatched = headingCandidates.some((candidate) =>
    headings.some((heading) => heading.includes(normalizeText(candidate)))
  );
  const exactTextMatched = headingMatched
    ? true
    : (await Promise.all(headingCandidates.map((candidate) => page.getByText(candidate, { exact: true }).count())))
        .some((count) => count > 0);
  if (!exactTextMatched) {
    throw new Error("The expected Teamship page heading was not visible.");
  }
}

async function activateInventoryView(page: Page, name: "All" | "Ship by LPN") {
  assertTeamshipReadControlAllowed(name);
  const control = await requireUniqueLocator([
    page.getByRole("tab", { name, exact: true }),
    page.getByRole("link", { name, exact: true }),
    page.getByRole("button", { name, exact: true })
  ], `Teamship ${name} inventory view`);
  await control.click();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  await assertNoUnexpectedDialog(page);
}

async function applyInventorySearch(page: Page, query: string) {
  const input = await requireUniqueLocator([
    page.getByRole("searchbox", { name: "Search", exact: true }),
    page.getByPlaceholder("Search", { exact: true }),
    page.getByRole("textbox", { name: "Search", exact: true })
  ], "Teamship inventory Search field");
  assertTeamshipReadControlAllowed("Search");
  const submit = await requireUniqueLocator([
    page.getByRole("search", { name: "Search", exact: true }),
    page.getByRole("button", { name: "Search", exact: true }),
    page.locator('button[type="submit"]:visible').filter({ hasText: "Search" })
  ], "Teamship inventory Search button");

  await input.fill(query);
  await page.waitForTimeout(400);
  await submit.click();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  await assertNoUnexpectedDialog(page);
}

async function requireUniqueLocator(candidates: Locator[], description: string) {
  for (const candidate of candidates) {
    const count = await candidate.count();
    if (count === 1) {
      return candidate;
    }
  }
  throw new Error(`${description} was missing or ambiguous.`);
}

async function assertNoUnexpectedDialog(page: Page) {
  if (await page.locator('[role="dialog"]:visible').count()) {
    throw new Error("Teamship opened an unexpected dialog during a read-only operation.");
  }
}

async function readVisibleTables(page: Page): Promise<RawTable[]> {
  return page.evaluate(() => {
    const surfaces = [
      ...Array.from(document.querySelectorAll("table")).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
      ...Array.from(document.querySelectorAll('[role="grid"]')).filter((element) => {
        const rect = element.getBoundingClientRect();
        return element.tagName !== "TABLE" && rect.width > 0 && rect.height > 0;
      })
    ];

    return surfaces.map((surface) => {
      const isTable = surface.tagName === "TABLE";
      const headerCells = isTable
        ? Array.from(surface.querySelectorAll("thead th, tr:first-child th"))
        : Array.from(surface.querySelectorAll('[role="columnheader"]')).filter((cell) => {
            const rect = cell.getBoundingClientRect();
            const style = getComputedStyle(cell);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
      const headers = headerCells.map((cell) => {
        const label = isTable ? cell : cell.querySelector(".e-headertext") ?? cell;
        return (label.textContent ?? "").replace(/\s+/g, " ").trim();
      });
      const candidateRows = isTable
        ? Array.from(surface.querySelectorAll("tbody tr"))
        : Array.from(surface.querySelectorAll('[role="row"]')).filter((row) => !row.querySelector('[role="columnheader"]'));
      const rows = candidateRows.map((row) => {
        const cells = isTable
          ? Array.from(row.querySelectorAll(":scope > th,:scope > td"))
          : Array.from(row.children).filter((cell) => {
              const role = cell.getAttribute("role");
              const rect = cell.getBoundingClientRect();
              const style = getComputedStyle(cell);
              const isVisible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
              return isVisible && (role === "gridcell" || role === "rowheader" || cell.classList.contains("e-groupcaption"));
            });
        return cells.map((cell) => ({
          text: (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
          links: Array.from(cell.querySelectorAll("a[href]")).map((link) => link.getAttribute("href") ?? "").filter(Boolean)
        }));
      }).filter((row) => row.length > 0);
      return { headers, rows };
    });
  });
}

async function readKnownLabelValues(page: Page, labels: string[]) {
  return page.evaluate((requestedLabels) => {
    const result: Record<string, string> = {};
    const normalizedLabels = requestedLabels.map((label) => label.trim().toLowerCase());
    const candidates = Array.from(document.querySelectorAll("dt,th,label,strong,b,h1,h2,h3,h4,h5,h6"));

    for (const element of candidates) {
      const rawLabel = (element.textContent ?? "").replace(/\s+/g, " ").replace(/:$/, "").trim();
      const index = normalizedLabels.indexOf(rawLabel.toLowerCase());
      if (index < 0 || result[requestedLabels[index]!]) continue;
      const sibling = element.nextElementSibling;
      const rowCells = element.closest("tr") ? Array.from(element.closest("tr")!.querySelectorAll("th,td")) : [];
      const rowValue = rowCells.length > 1 ? rowCells[rowCells.indexOf(element as Element) + 1]?.textContent : null;
      const value = (sibling?.textContent ?? rowValue ?? "").replace(/\s+/g, " ").trim();
      if (value) result[requestedLabels[index]!] = value;
    }

    const receivingHeading = candidates
      .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
      .find((value) => /^Receiving Order\s*#/i.test(value));
    const receivingMatch = receivingHeading?.match(/^Receiving Order\s*#\s*([^\s-]+)\s*-\s*(.+)$/i);
    const orderIdIndex = normalizedLabels.indexOf("order id");
    const statusIndex = normalizedLabels.indexOf("status");
    if (receivingMatch && orderIdIndex >= 0 && !result[requestedLabels[orderIdIndex]!]) {
      result[requestedLabels[orderIdIndex]!] = receivingMatch[1]!.trim();
    }
    if (receivingMatch && statusIndex >= 0 && !result[requestedLabels[statusIndex]!]) {
      result[requestedLabels[statusIndex]!] = receivingMatch[2]!.trim();
    }
    return result;
  }, labels);
}

async function readProductDetailFields(page: Page) {
  return page.evaluate(() => {
    const customerValue = (document.querySelector("#customerName") as HTMLInputElement | null)?.value?.replace(/\s+/g, " ").trim() ?? "";
    const productName = (document.querySelector("#productNameInput") as HTMLInputElement | null)?.value?.replace(/\s+/g, " ").trim() ?? "";
    const sku = (document.querySelector("#sku") as HTMLInputElement | null)?.value?.replace(/\s+/g, " ").trim() ?? "";
    const customerParts = customerValue.split("-").map((part) => part.trim()).filter(Boolean);
    const customer = customerParts.length === 2 && customerParts[0] === customerParts[1]
      ? customerParts[0]!
      : customerValue;
    return {
      Customer: customer,
      "Product Name": productName,
      SKU: sku
    };
  });
}

async function readReceivingItems(page: Page): Promise<TeamshipBrowserReceivingOrder["items"]> {
  return page.evaluate(() => Array.from(document.querySelectorAll(".main-product-item")).map((item) => {
    const text = (item.textContent ?? "").replace(/\s+/g, " ").trim();
    const productHref = item.querySelector('a[href*="/view-product/"]')?.getAttribute("href") ?? "";
    const values = Array.from(item.querySelectorAll(".breakdown-value"))
      .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim());
    const incomingValue = text.match(/\bIncoming\s+(-?\d+(?:\.\d+)?)/i)?.[1];
    const receivedValue = text.match(/\bReceived\s+(-?\d+(?:\.\d+)?)/i)?.[1];
    const incoming = Number(incomingValue?.replace(/,/g, ""));
    const received = Number(receivedValue?.replace(/,/g, ""));
    return {
      productId: productHref.match(/\/view-product\/([^/?#]+)/i)?.[1] ?? null,
      sku: text.match(/\bSKU\s+(.+?)\s+·\s+UOM\b/i)?.[1]?.trim() ?? null,
      incoming: Number.isFinite(incoming) ? incoming : null,
      received: Number.isFinite(received) ? received : null,
      location: values[0] || null,
      lpn: values[1] || null,
      weight: null
    };
  }));
}

export function parseInventoryAllTables(tables: RawTable[]): TeamshipBrowserInventoryAllRow[] {
  const table = findTable(tables, ["sku", "available", "reserved", "on hand"]);
  if (!table) return [];
  return table.rows.map((row) => ({
    inventoryId: readCell(table, row, ["inventory id", "stock id", "id"]),
    productId: readLinkId(table, row, ["product", "sku"], /\/view-product\/([^/?#]+)/i),
    productName: readCell(table, row, ["product", "product name"]),
    sku: readCell(table, row, ["sku"]),
    available: readNumber(readCell(table, row, ["available"])),
    reserved: readNumber(readCell(table, row, ["reserved"])),
    onHand: readNumber(readCell(table, row, ["on hand"])),
    backordered: readNumber(readCell(table, row, ["backordered", "back ordered"])),
    status: readCell(table, row, ["status"]),
    customerName: readCell(table, row, ["company name", "customer", "company"]),
    warehouseName: readCell(table, row, ["warehouse"]),
    quarantined: readBoolean(readCell(table, row, ["quarantine", "quarantined"]))
  }));
}

export function parseLpnTables(tables: RawTable[]): TeamshipBrowserLpnRow[] {
  const table = findTable(tables, ["sku", "available", "warehouse", "company name"]);
  if (!table) return [];
  let group: { lpn: string | null; location: string | null } = { lpn: null, location: null };
  const records: TeamshipBrowserLpnRow[] = [];
  for (const row of table.rows) {
    const groupText = row.length === 1 ? row[0]?.text ?? "" : "";
    const groupMatch = groupText.match(/([^\s(]+)\s*\([^,]+,\s*LOC:\s*([^\)]+)\)/i);
    if (groupMatch) {
      group = { lpn: groupMatch[1]?.trim() ?? null, location: groupMatch[2]?.trim() ?? null };
      continue;
    }
    const sku = readCell(table, row, ["sku"]);
    if (!sku) continue;
    records.push({
      inventoryId: null,
      productId: readLinkId(table, row, ["product", "sku"], /\/view-product\/([^/?#]+)/i),
      sku,
      lpn: group.lpn,
      quantity: readNumber(readCell(table, row, ["available", "quantity", "qty"])),
      location: group.location,
      status: readCell(table, row, ["status"]),
      serialNumber: readCell(table, row, ["serial", "serial number"]),
      customerName: readCell(table, row, ["company name", "customer", "company"]),
      warehouseName: readCell(table, row, ["warehouse"]),
      quarantined: readBoolean(readCell(table, row, ["quarantine", "quarantined"]))
    });
  }
  return records;
}

export function parseReceivingOrderPage({
  requestedOrderId,
  fields,
  items,
  tables,
  url
}: {
  requestedOrderId: string;
  fields: Record<string, string>;
  items?: TeamshipBrowserReceivingOrder["items"];
  tables: RawTable[];
  url: string;
}): TeamshipBrowserReceivingOrder {
  const itemTable = findTable(tables, ["sku", "incoming", "received"]);
  const locationTable = findTable(tables, ["lpn", "location"]);
  const itemRows = itemTable?.rows ?? [];
  const locationRows = locationTable?.rows ?? [];
  return {
    orderId: readField(fields, ["Order ID"]) ?? requestedOrderId,
    teamshipId: new URL(url).pathname.match(/\/inventoryOrder\/([^/?#]+)/i)?.[1] ?? null,
    status: readField(fields, ["Status"]),
    customerName: readField(fields, ["Customer", "Company Name", "Company"]),
    warehouseName: readField(fields, ["Warehouse"]),
    createdAt: readField(fields, ["Order Creation Date", "Created At", "Created"]),
    eta: readField(fields, ["Est. Arrival Date", "ETA"]),
    carrier: readField(fields, ["Carrier"]),
    bolNumber: readField(fields, ["BOL Number"]),
    palletCount: readNumber(readField(fields, ["Pallet Counts", "Pallet Count", "Pallets"])),
    items: items ?? itemRows.map((row, index) => ({
      productId: itemTable ? readLinkId(itemTable, row, ["product", "sku"], /\/view-product\/([^/?#]+)/i) : null,
      sku: itemTable ? readCell(itemTable, row, ["sku"]) : null,
      incoming: itemTable ? readNumber(readCell(itemTable, row, ["incoming", "expected", "quantity"])) : null,
      received: itemTable ? readNumber(readCell(itemTable, row, ["received", "received quantity"])) : null,
      lpn: locationTable && locationRows[index] ? readCell(locationTable, locationRows[index]!, ["lpn"]) : null,
      location: locationTable && locationRows[index] ? readCell(locationTable, locationRows[index]!, ["location"]) : null,
      weight: locationTable && locationRows[index] ? readNumber(readCell(locationTable, locationRows[index]!, ["weight"])) : null
    }))
  };
}

export function parseProductHistoryPage({
  productId,
  fields,
  tables
}: {
  productId: string;
  fields: Record<string, string>;
  tables: RawTable[];
}): TeamshipBrowserProductHistory {
  const table = findTable(tables, ["event", "adjustment", "available", "warehouse"]);
  return {
    productId,
    sku: readField(fields, ["SKU"]),
    productName: readField(fields, ["Product Name", "Product"]),
    customerName: readField(fields, ["Customer", "Company"]),
    rows: (table?.rows ?? []).map((row) => ({
      historyId: table ? readCell(table, row, ["id", "history id"]) : null,
      date: table ? readCell(table, row, ["date", "created", "created at"]) : null,
      event: table ? readCell(table, row, ["event", "type"]) : null,
      adjustment: table ? readNumber(readCell(table, row, ["adjustment", "quantity adjustment"])) : null,
      availableAfter: table ? readNumber(readCell(table, row, ["available", "resulting available"])) : null,
      warehouseName: table ? readCell(table, row, ["warehouse"]) : null,
      batch: table ? readCell(table, row, ["batch", "lot"]) : null,
      serialNumber: table ? readCell(table, row, ["serial", "serial number"]) : null,
      status: table ? readCell(table, row, ["status"]) : null
    }))
  };
}

function findTable(tables: RawTable[], requiredHeaders: string[]) {
  return tables.find((table) => {
    const headers = table.headers.map(normalizeHeader);
    return requiredHeaders.every((required) => headers.includes(normalizeHeader(required)));
  }) ?? null;
}

function readCell(table: RawTable, row: RawCell[], aliases: string[]) {
  const headers = table.headers.map(normalizeHeader);
  const index = aliases.map(normalizeHeader).map((alias) => headers.indexOf(alias)).find((candidate) => candidate >= 0);
  return index === undefined ? null : normalizeNullableText(row[index]?.text);
}

function readLinkId(table: RawTable, row: RawCell[], aliases: string[], pattern: RegExp) {
  const headers = table.headers.map(normalizeHeader);
  const index = aliases.map(normalizeHeader).map((alias) => headers.indexOf(alias)).find((candidate) => candidate >= 0);
  if (index === undefined) return null;
  return row[index]?.links.map((link) => link.match(pattern)?.[1] ?? null).find(Boolean) ?? null;
}

function readField(fields: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const match = Object.entries(fields).find(([key]) => normalizeHeader(key) === normalizeHeader(alias));
    if (match) return normalizeNullableText(match[1]);
  }
  return null;
}

function normalizeHeader(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeNullableText(value: string | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function readNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: string | null) {
  if (!value) return null;
  if (/^(?:yes|true|quarantined|1)$/i.test(value.trim())) return true;
  if (/^(?:no|false|not quarantined|0)$/i.test(value.trim())) return false;
  return null;
}

function parseAllowedHosts(value: string | undefined) {
  const hosts = value
    ?.split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return hosts && hosts.length > 0 ? hosts : DEFAULT_ALLOWED_HOSTS;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
