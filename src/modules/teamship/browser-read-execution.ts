import { chromium, type Browser, type Locator, type Page } from "playwright-core";

import {
  assertTeamshipReadControlAllowed,
  type TeamshipBrowserInventoryAllRow,
  type TeamshipBrowserLpnRow,
  type TeamshipBrowserProductHistory,
  type TeamshipBrowserReadAdapter,
  type TeamshipBrowserReceivingOrder,
  type TeamshipBrowserShippingOrderPallets
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
      const tablePages = await applyInventorySearch(page, input.sku);
      return tablePages.flatMap((tables) => parseInventoryAllTables(tables, input.sku));
    }),
    searchLpn: (input) => runBrowserRead(input.credentials, options, async (page, baseUrl) => {
      await openReadPage(page, baseUrl, "/inventory", input.credentials, options);
      await assertPageContext(page, "/inventory", ["Inventory"]);
      await activateInventoryView(page, "Ship by LPN");
      const tablePages = await applyInventorySearch(page, input.query);
      return tablePages.flatMap((tables) => parseLpnTables(tables, input.query));
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
    }),
    getShippingOrderPallets: (input) => runBrowserRead(input.credentials, options, async (page, baseUrl) => {
      const route = `/ship-inventories/${encodeURIComponent(input.teamshipOrderId)}`;
      await openReadPage(page, baseUrl, route, input.credentials, options);
      await assertPageContext(page, route, [`Ship Inventory #${input.teamshipOrderId}`]);
      if (new URL(page.url()).pathname !== route) {
        throw new Error("The Teamship shipping-order page did not match the requested internal order ID.");
      }

      const customerMatches = await page.getByText(input.scope.customerName, { exact: true }).count();
      const warehouseMatches = await page.getByText(input.scope.warehouseName, { exact: true }).count();
      if (customerMatches < 1 || warehouseMatches < 1) {
        throw new Error("The Teamship shipping-order page did not match the approved customer and warehouse scope.");
      }

      const palletCount = await readTeamshipShippingOrderPalletCount(
        page,
        options.navigationTimeoutMs ?? 15_000
      );

      return [parseTeamshipShippingOrderPalletPreflight({
        teamshipOrderId: input.teamshipOrderId,
        palletCount,
        customerName: input.scope.customerName,
        warehouseName: input.scope.warehouseName
      })];
    })
  };
}

export function parseTeamshipShippingOrderPalletPreflight(input: {
  teamshipOrderId: string;
  palletCount: string;
  customerName: string;
  warehouseName: string;
}): TeamshipBrowserShippingOrderPallets {
  const teamshipOrderId = input.teamshipOrderId.trim();
  const customerName = input.customerName.replace(/\s+/g, " ").trim();
  const warehouseName = input.warehouseName.replace(/\s+/g, " ").trim();
  const rawPalletCount = input.palletCount.trim();
  if (!teamshipOrderId || !customerName || !warehouseName) {
    throw new Error("The Teamship shipping-order pallet preflight was missing required identity fields.");
  }
  if (!/^\d+$/.test(rawPalletCount)) {
    throw new Error("The Teamship shipping-order pallet count was not a whole number.");
  }
  const palletCount = Number(rawPalletCount);
  if (!Number.isInteger(palletCount) || palletCount < 1 || palletCount > 100) {
    throw new Error("The Teamship shipping-order pallet count was outside the allowed range.");
  }
  return { teamshipOrderId, palletCount, customerName, warehouseName };
}

export async function readTeamshipShippingOrderPalletCount(
  page: Pick<Page, "locator">,
  timeoutMs: number
) {
  await page.locator('input#pallets_count,input[id^="pallet_"],table:has-text("No. of Pallets")').first().waitFor({
    state: "attached",
    timeout: timeoutMs
  });

  const countInput = page.locator("input#pallets_count");
  const countMatches = await countInput.count();
  if (countMatches > 1) {
    throw new Error("The Teamship shipping-order page did not expose one unambiguous pallet-row count.");
  }
  let expectedEditableRowCount: number | null = null;
  if (countMatches === 1) {
    const rawRowCount = (await countInput.first().inputValue()).trim();
    if (!/^\d+$/.test(rawRowCount)) {
      throw new Error("The Teamship shipping-order pallet-row count was not a whole number.");
    }
    expectedEditableRowCount = Number(rawRowCount);
    if (expectedEditableRowCount < 1 || expectedEditableRowCount > 10) {
      throw new Error("The Teamship shipping-order pallet-row count was outside the allowed range.");
    }
  }

  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push({
      quantity: await readOptionalUniqueInputValue(page, `input#pallet_${index}`),
      length: await readOptionalUniqueInputValue(page, `input#pallet_${index}_length`),
      width: await readOptionalUniqueInputValue(page, `input#pallet_${index}_width`),
      height: await readOptionalUniqueInputValue(page, `input#pallet_${index}_height`),
      weight: await readOptionalUniqueInputValue(page, `input#pallet_${index}_weight`),
      weightUnit: await readOptionalUniqueInputValue(page, `#pallet_${index}_weight_unit`),
      commodity: await readOptionalUniqueInputValue(page, `#pallet_${index}_commodity`)
    });
  }

  const observedRows = rows.filter(teamshipShippingOrderPalletRowIsObserved);
  if (observedRows.length === 0) {
    return String(parseTeamshipShippingOrderPalletTableRows(
      await readTeamshipShippingOrderPalletTableRows(page)
    ));
  }
  if (expectedEditableRowCount !== null && observedRows.length !== expectedEditableRowCount) {
    throw new Error("The Teamship shipping-order pallet rows did not match the rendered row count.");
  }

  return String(parseTeamshipShippingOrderPalletRows(observedRows));
}

export function parseTeamshipShippingOrderPalletTableRows(rows: string[][]) {
  if (rows.length < 1 || rows.length > 10) {
    throw new Error("The Teamship shipping-order pallet table did not expose a bounded set of rows.");
  }

  let total = 0;
  for (const row of rows) {
    if (row.length !== 3) {
      throw new Error("The Teamship shipping-order pallet table row was invalid.");
    }
    const rawQuantity = row[0]?.trim() ?? "";
    if (!/^\d+$/.test(rawQuantity)) {
      throw new Error("The Teamship shipping-order pallet table had an invalid quantity.");
    }
    const quantity = Number(rawQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error("The Teamship shipping-order pallet table quantity was outside the allowed range.");
    }
    total += quantity;
    if (total > 100) {
      throw new Error("The Teamship shipping-order pallet count was outside the allowed range.");
    }
  }
  return total;
}

export function parseTeamshipShippingOrderPalletRows(rows: Array<{
  quantity: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  weight: string | null;
  weightUnit: string | null;
  commodity: string | null;
}>) {
  let total = 0;
  for (const row of rows) {
    if (!teamshipShippingOrderPalletRowIsObserved(row)) continue;

    const rawQuantity = row.quantity?.trim() ?? "";
    if (!/^\d+$/.test(rawQuantity)) {
      throw new Error("The Teamship shipping-order pallet row had an invalid quantity.");
    }
    const quantity = Number(rawQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error("The Teamship shipping-order pallet row quantity was outside the allowed range.");
    }
    total += quantity;
    if (total > 100) {
      throw new Error("The Teamship shipping-order pallet count was outside the allowed range.");
    }
  }
  if (total < 1) {
    throw new Error("The Teamship shipping-order page did not expose any valid pallet rows.");
  }
  return total;
}

function teamshipShippingOrderPalletRowIsObserved(row: {
  quantity: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  weight: string | null;
  weightUnit: string | null;
  commodity: string | null;
}) {
  const normalizedWeightUnit = row.weightUnit?.trim().toLowerCase() ?? "";
  const meaningfulWeightUnit = normalizedWeightUnit
    && !["lb", "lbs", "pound", "pounds"].includes(normalizedWeightUnit)
    ? row.weightUnit
    : null;
  return [row.quantity, row.length, row.width, row.height, row.weight, meaningfulWeightUnit, row.commodity]
    .some((value) => Boolean(value?.trim()));
}

async function readTeamshipShippingOrderPalletTableRows(page: Pick<Page, "locator">) {
  const tables = page.locator('table:visible')
    .filter({ hasText: "No. of Pallets" })
    .filter({ hasText: "Dimensions (in inches)" })
    .filter({ hasText: "Weight (in pounds)" });
  if (await tables.count() !== 1) {
    throw new Error("The Teamship shipping-order page did not expose one unambiguous pallet table.");
  }

  const tableRows = tables.first().locator("tr:visible");
  const rows: string[][] = [];
  for (let index = 0; index < await tableRows.count(); index += 1) {
    const cells = tableRows.nth(index).locator("td:visible");
    if (await cells.count() === 0) continue;
    rows.push(await cells.allInnerTexts());
  }
  return rows;
}

async function readOptionalUniqueInputValue(page: Pick<Page, "locator">, selector: string) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count === 0) return null;
  if (count !== 1) {
    throw new Error(`The Teamship shipping-order field ${selector} was ambiguous.`);
  }
  return locator.first().inputValue();
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
  await waitForInventoryGridReady(page);
  const input = await requireUniqueLocator([
    page.getByRole("searchbox", { name: "Search", exact: true }),
    page.getByPlaceholder("Search", { exact: true }),
    page.getByRole("textbox", { name: "Search", exact: true })
  ], "Teamship inventory Search field");
  const submit = await requireUniqueLocator([
    page.locator("#Grid_searchbutton:visible"),
    page.getByRole("search", { name: "Search", exact: true }),
    input.locator("xpath=..").locator('[title="Search"]:visible')
  ], "Teamship inventory Search control");
  assertTeamshipReadControlAllowed("Search");
  await submitTeamshipInventorySearch(input, submit, query);
  const firstPageTables = await waitForTeamshipInventorySearchResult(page, query, 45_000);
  const tablePages = await collectTeamshipInventorySearchPages(page, query, firstPageTables);
  await assertNoUnexpectedDialog(page);
  return tablePages;
}

const MAX_TEAMSHIP_INVENTORY_SEARCH_PAGES = 25;

export async function collectTeamshipInventorySearchPages(
  page: Page,
  query: string,
  firstPageTables: RawTable[]
) {
  let tablePages = [firstPageTables];
  const currentPage = page.locator('a.e-currentitem[aria-label^="Page "]:visible');
  if (await currentPage.count() === 0) return tablePages;
  if (await currentPage.count() !== 1) {
    throw new Error("Teamship inventory pager was ambiguous.");
  }

  const pager = parseTeamshipInventoryPagerLabel(await currentPage.getAttribute("aria-label"));
  if (!pager) throw new Error("Teamship inventory pager label was invalid.");
  if (pager.totalPages > MAX_TEAMSHIP_INVENTORY_SEARCH_PAGES) {
    throw new Error(`Teamship inventory search exceeded the ${MAX_TEAMSHIP_INVENTORY_SEARCH_PAGES}-page read limit.`);
  }

  const expandedTables = await expandTeamshipInventoryPageSize(page, query, pager.totalPages);
  if (expandedTables) {
    tablePages = [expandedTables];
    const expandedCurrentPage = page.locator('a.e-currentitem[aria-label^="Page "]:visible');
    if (await expandedCurrentPage.count() === 0) return tablePages;
    if (await expandedCurrentPage.count() !== 1) throw new Error("Teamship inventory pager was ambiguous after expanding the page size.");
    const expandedPager = parseTeamshipInventoryPagerLabel(await expandedCurrentPage.getAttribute("aria-label"));
    if (!expandedPager) throw new Error("Teamship inventory pager label was invalid after expanding the page size.");
    if (expandedPager.totalPages > MAX_TEAMSHIP_INVENTORY_SEARCH_PAGES) {
      throw new Error(`Teamship inventory search exceeded the ${MAX_TEAMSHIP_INVENTORY_SEARCH_PAGES}-page read limit.`);
    }
    pager.currentPage = expandedPager.currentPage;
    pager.totalPages = expandedPager.totalPages;
  }

  for (let pageNumber = pager.currentPage + 1; pageNumber <= pager.totalPages; pageNumber += 1) {
    const label = `Page ${pageNumber} of ${pager.totalPages} Pages`;
    const link = page.locator(`a[aria-label="${label}"]:visible`);
    if (await link.count() !== 1) throw new Error(`Teamship inventory page ${pageNumber} link was missing or ambiguous.`);
    await link.click();
    await page.locator(`a.e-currentitem[aria-label="${label}"]:visible`).waitFor({ state: "visible", timeout: 15_000 });
    tablePages.push(await waitForTeamshipInventorySearchResult(page, query, 15_000));
  }

  return tablePages;
}

async function expandTeamshipInventoryPageSize(page: Page, query: string, previousTotalPages: number) {
  if (previousTotalPages <= 1) return null;
  const input = page.locator('input[placeholder="Items per page"]:visible');
  if (await input.count() !== 1 || await input.getAttribute("value") === "100") return null;

  assertTeamshipReadControlAllowed("Items per page");
  await input.locator("xpath=..").click();
  const option = page.getByRole("option", { name: "100", exact: true });
  if (await option.count() !== 1) throw new Error("Teamship 100-items page-size option was missing or ambiguous.");
  await option.click();
  await page.waitForFunction(({ previousPages }) => {
    const size = document.querySelector<HTMLInputElement>('input[placeholder="Items per page"]');
    const current = Array.from(document.querySelectorAll<HTMLAnchorElement>('a.e-currentitem[aria-label^="Page "]'))
      .find((link) => {
        const bounds = link.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      });
    if (size?.value !== "100") return false;
    if (!current) return true;
    const match = current.getAttribute("aria-label")?.match(/^Page\s+\d+\s+of\s+(\d+)\s+Pages$/i);
    return Number(match?.[1]) < previousPages;
  }, { previousPages: previousTotalPages }, { timeout: 30_000 });
  return waitForTeamshipInventorySearchResult(page, query, 45_000);
}

export function parseTeamshipInventoryPagerLabel(label: string | null) {
  const match = label?.match(/^Page\s+(\d+)\s+of\s+(\d+)\s+Pages$/i);
  const currentPage = Number(match?.[1]);
  const totalPages = Number(match?.[2]);
  if (!Number.isInteger(currentPage) || !Number.isInteger(totalPages) || currentPage < 1 || totalPages < currentPage) {
    return null;
  }
  return { currentPage, totalPages };
}

async function waitForInventoryGridReady(page: Page) {
  await page.locator('[role="grid"] [role="gridcell"]:visible').first().waitFor({
    state: "visible",
    timeout: 30_000
  });
}

export async function submitTeamshipInventorySearch(
  input: Pick<Locator, "fill" | "type">,
  submit: Pick<Locator, "click">,
  query: string
) {
  await input.fill("");
  await input.type(query, { delay: 25 });
  await submit.click();
}

export async function waitForTeamshipInventorySearchResult(
  page: Pick<Page, "evaluate">,
  query: string,
  timeoutMs: number
) {
  const captureVisibleGrid = `({ requestedQuery, timeoutMs }) => new Promise((resolve, reject) => {
    const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const normalizedQuery = normalize(requestedQuery);
    let timer;
    let observer;
    const finish = (payload) => {
      if (timer) clearTimeout(timer);
      if (observer) observer.disconnect();
      resolve(JSON.stringify(payload));
    };
    const capture = () => {
      const surfaces = [
        ...Array.from(document.querySelectorAll('table')).filter(isVisible),
        ...Array.from(document.querySelectorAll('[role="grid"]')).filter((element) => element.tagName !== 'TABLE' && isVisible(element))
      ];
      const hasFilteredSurface = surfaces.some((surface) => {
        const isTable = surface.tagName === 'TABLE';
        const candidateRows = (isTable
          ? Array.from(surface.querySelectorAll('tbody tr'))
          : Array.from(surface.querySelectorAll('[role="row"]')).filter((row) => !row.querySelector('[role="columnheader"]'))
        ).filter(isVisible);
        const hasGroupedRows = candidateRows.some((row) => row.querySelector('.e-groupcaption,.lpn-heading-style,input.lpn-checkbox'));
        const groups = [];
        for (const row of candidateRows) {
          const text = normalize(row.textContent);
          if (!text) continue;
          const isGroupCaption = Boolean(row.querySelector('.e-groupcaption,.lpn-heading-style,input.lpn-checkbox'));
          if (!hasGroupedRows || isGroupCaption || groups.length === 0) groups.push(text);
          else groups[groups.length - 1] = groups[groups.length - 1] + ' ' + text;
        }
        return groups.length > 0 && groups.every((group) => group.includes(normalizedQuery));
      });
      if (!hasFilteredSurface) return false;
      const tables = surfaces.map((surface) => {
        const isTable = surface.tagName === 'TABLE';
        const headerCells = isTable
          ? Array.from(surface.querySelectorAll('thead th, tr:first-child th'))
          : Array.from(surface.querySelectorAll('[role="columnheader"]')).filter(isVisible);
        const headers = headerCells.map((cell) => {
          const label = isTable ? cell : cell.querySelector('.e-headertext') || cell;
          return (label.textContent || "").replace(/\\s+/g, " ").trim();
        });
        const candidateRows = isTable
          ? Array.from(surface.querySelectorAll('tbody tr'))
          : Array.from(surface.querySelectorAll('[role="row"]')).filter((row) => !row.querySelector('[role="columnheader"]'));
        const rows = candidateRows.map((row) => {
          const cells = isTable
            ? Array.from(row.querySelectorAll(':scope > th,:scope > td'))
            : Array.from(row.children).filter((cell) => {
                const role = cell.getAttribute('role');
                return isVisible(cell) && (role === 'gridcell' || role === 'rowheader' || cell.classList.contains('e-groupcaption'));
              });
          return cells.map((cell) => ({
            text: (cell.textContent || "").replace(/\\s+/g, " ").trim(),
            links: Array.from(cell.querySelectorAll('a[href]')).map((link) => link.getAttribute('href') || "").filter(Boolean)
          }));
        }).filter((row) => row.length > 0);
        return { headers, rows };
      });
      finish({ kind: "rows", tables });
      return true;
    };
    observer = new MutationObserver(capture);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    timer = setTimeout(() => {
      observer.disconnect();
      const rows = Array.from(document.querySelectorAll('tbody tr,[role="row"]')).filter(isVisible);
      const emptyVisible = rows.some((row) => {
        const text = normalize(row.textContent);
        return text === "no records to display" || text === "no records found" || text === "no data";
      });
      if (emptyVisible) resolve(JSON.stringify({ kind: "empty" }));
      else reject(new Error("Teamship inventory search did not settle."));
    }, timeoutMs);
    capture();
  })`;

  const captureExpression = `(${captureVisibleGrid})(${JSON.stringify({ requestedQuery: query, timeoutMs })})`;
  const serialized = await page.evaluate(captureExpression);
  if (typeof serialized !== "string") {
    throw new Error("Teamship inventory grid snapshot was not serialized.");
  }
  const payload = JSON.parse(serialized) as { kind: "rows"; tables: RawTable[] } | { kind: "empty" };
  return payload.kind === "rows" ? payload.tables : [];
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

export function parseInventoryAllTables(tables: RawTable[], requestedSku?: string): TeamshipBrowserInventoryAllRow[] {
  const table = findTable(tables, ["sku", "available", "reserved", "on hand"], requestedSku);
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

export function parseLpnTables(tables: RawTable[], requestedQuery?: string): TeamshipBrowserLpnRow[] {
  const table = findTable(tables, ["sku", "available", "warehouse", "company name"], requestedQuery);
  if (!table) return [];
  let group: { lpn: string | null; location: string | null } = { lpn: null, location: null };
  const records: TeamshipBrowserLpnRow[] = [];
  for (const row of table.rows) {
    const groupMatch = row
      .map((cell) => cell.text.match(/([^\s(]+)\s*\([^,]+,\s*LOC:\s*([^\)]+)\)/i))
      .find((match) => Boolean(match));
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

function findTable(tables: RawTable[], requiredHeaders: string[], requestedIdentifier?: string) {
  const candidates = pairSplitGridSurfaces(tables);
  const matches = candidates.filter((table) => {
    const headers = table.headers.map(normalizeHeader);
    return requiredHeaders.every((required) => headers.includes(normalizeHeader(required)));
  });
  if (!requestedIdentifier) return matches[0] ?? null;
  const normalizedIdentifier = normalizeText(requestedIdentifier);
  return matches.find((table) => table.rows.some((row) =>
    row.some((cell) => {
      const value = normalizeText(cell.text);
      return value === normalizedIdentifier || value.startsWith(`${normalizedIdentifier} (`);
    })
  )) ?? matches[0] ?? null;
}

function pairSplitGridSurfaces(tables: RawTable[]) {
  const headerSurfaces = tables.filter((table) => table.headers.length > 0);
  const paired = tables.flatMap((dataSurface) => {
    if (dataSurface.headers.length > 0 || dataSurface.rows.length === 0) return [];
    return headerSurfaces
      .filter((headerSurface) => dataSurface.rows.some((row) => row.length === headerSurface.headers.length))
      .map((headerSurface) => ({ headers: headerSurface.headers, rows: dataSurface.rows }));
  });
  return [...tables, ...paired];
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
  return normalizeText(value)
    .replace(/press (?:alt down|enter|ctrl space).*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
