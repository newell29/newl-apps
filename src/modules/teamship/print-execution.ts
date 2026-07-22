import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";

import type {
  ClaimedTeamshipPrintJob,
  TeamshipPrintExecutionDocument,
  TeamshipPrintExecutionResult
} from "@/modules/teamship/print-jobs";
import {
  calculateTeamshipPalletCount,
  readTeamshipCustomerName,
  readTeamshipWarehouseName,
  resolveTeamshipInternalOrderId,
  teamshipOrderMatchesShippingOrderNumber
} from "@/modules/teamship/print-jobs";
import { findTeamshipShippingOrders } from "@/server/integrations/teamship";

export type TeamshipPrintExecutionOptions = {
  appBaseUrl?: string;
  allowedHosts?: string[];
  browserExecutablePath?: string | null;
  headed?: boolean;
  navigationTimeoutMs?: number;
};

export type TeamshipPrintPartialResult = {
  status: "FAILED";
  observedPalletCount: number | null;
  documents: TeamshipPrintExecutionDocument[];
};

export class TeamshipPrintExecutionError extends Error {
  partialResult: TeamshipPrintPartialResult;

  constructor(message: string, partialResult: TeamshipPrintPartialResult) {
    super(message);
    this.name = "TeamshipPrintExecutionError";
    this.partialResult = partialResult;
  }
}

const execFile = promisify(execFileCallback);
export const DEFAULT_TEAMSHIP_PRINT_APP_BASE_URL = "https://members.fulfillit.io";
const DEFAULT_ALLOWED_HOSTS = ["app.teamshipos.com", "members.fulfillit.io"];

export async function executeTeamshipPrintJob(
  job: ClaimedTeamshipPrintJob,
  options: TeamshipPrintExecutionOptions = {}
): Promise<TeamshipPrintExecutionResult> {
  const completedDocuments: TeamshipPrintExecutionDocument[] = [];
  let observedPalletCount: number | null = null;
  const browser = await launchBrowser(options);
  try {
    const baseUrl = resolveTeamshipPrintAppBaseUrl(options.appBaseUrl);
    const allowedHosts = resolveAllowedHosts(options);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    page.setDefaultTimeout(options.navigationTimeoutMs ?? 20_000);
    page.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 30_000);

    const orderUrl = new URL(`/ship-inventories/${encodeURIComponent(job.teamshipOrderId)}`, baseUrl);
    const bolUrl = new URL(`/ship-inventories/${encodeURIComponent(job.teamshipOrderId)}/bol-editor`, baseUrl);

    // Resolve the display number to the approved internal ID before any browser action or print is sent.
    observedPalletCount = await readTeamshipApiPalletCount(job);
    assertApprovedPalletCount(observedPalletCount, job.approvedPalletCount);
    // Preflight every browser and printer destination before any print is sent.
    await openTeamshipPage(page, orderUrl, job, allowedHosts, options);
    await findExactPrinterOption(page, job.printerPlan.outboundLabels.exactName);
    await openTeamshipPage(page, bolUrl, job, allowedHosts, options);
    await findExactPrinterOption(page, job.printerPlan.bol.exactName);
    await assertCupsQueueAvailable(job.printerPlan.pickingList.queue);

    await openTeamshipPage(page, orderUrl, job, allowedHosts, options);
    completedDocuments.push(await printPickingList(page, job));

    await openTeamshipPage(page, bolUrl, job, allowedHosts, options);
    completedDocuments.push(await printBol(page, job));

    // Printer selection is intentionally redone after returning to the order.
    await openTeamshipPage(page, orderUrl, job, allowedHosts, options);
    observedPalletCount = await readTeamshipApiPalletCount(job);
    assertApprovedPalletCount(observedPalletCount, job.approvedPalletCount);
    completedDocuments.push(await printOutboundLabels(page, job));

    return {
      status: "COMPLETED",
      observedPalletCount,
      documents: completedDocuments,
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    throw new TeamshipPrintExecutionError(
      error instanceof Error ? error.message : "Teamship print execution failed.",
      { status: "FAILED", observedPalletCount, documents: completedDocuments }
    );
  } finally {
    await browser.close();
  }
}

export async function readTeamshipApiPalletCount(
  job: ClaimedTeamshipPrintJob,
  findOrders: typeof findTeamshipShippingOrders = findTeamshipShippingOrders
) {
  const orders = await findOrders({
    orderIdentifier: job.shippingOrderNumber,
    credentials: job.credentials
  });
  const exact = orders.filter((order) => (
    teamshipOrderMatchesShippingOrderNumber(order, job.shippingOrderNumber)
    && resolveTeamshipInternalOrderId(order) === job.teamshipOrderId
  ));
  if (exact.length !== 1) {
    throw new Error("Teamship API did not return exactly one approved shipping order for pallet preflight.");
  }
  const order = exact[0]!;
  if (normalizeTeamshipIdentity(readTeamshipCustomerName(order)) !== normalizeTeamshipIdentity(job.customerName)) {
    throw new Error("Teamship API customer does not match the approved print plan.");
  }
  if (normalizeTeamshipIdentity(readTeamshipWarehouseName(order)) !== normalizeTeamshipIdentity(job.warehouseName)) {
    throw new Error("Teamship API warehouse does not match the approved print plan.");
  }
  return calculateTeamshipPalletCount(order);
}

function normalizeTeamshipIdentity(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function selectTeamshipPrinterExact(scope: Page | Locator, exactName: string) {
  const match = await findExactPrinterOption(scope, exactName);
  await match.select.selectOption({ value: match.value });
  return assertTeamshipPrinterSelected(match.select, exactName, match.value);
}

export async function assertTeamshipPrinterSelected(select: Locator, exactName: string, expectedValue: string) {
  const selected = await select.evaluate((element) => {
    const input = element as HTMLSelectElement;
    return { value: input.value, label: input.selectedOptions[0]?.textContent?.trim() ?? "" };
  });
  if (selected.value !== expectedValue || selected.label !== exactName) {
    throw new Error(`Teamship did not retain the required printer ${exactName}.`);
  }
  return selected;
}

async function printPickingList(page: Page, job: ClaimedTeamshipPrintJob): Promise<TeamshipPrintExecutionDocument> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), `newl-pick-${job.id}-`));
  try {
    const trigger = await requireUniqueVisible([
      page.getByText("Picking List", { exact: true }),
      page.getByRole("button", { name: "Picking List", exact: true }),
      page.getByRole("link", { name: "Picking List", exact: true })
    ], "Picking List control");
    const download = await waitForPickingListDownload(page, trigger);
    const suggestedName = download.suggestedFilename();
    if (!suggestedName.includes(job.shippingOrderNumber)) {
      throw new Error("The downloaded picking-list filename does not match the approved shipping order.");
    }
    const pdfPath = path.join(temporaryDirectory, "picking-list.pdf");
    await download.saveAs(pdfPath);
    const bytes = await readFile(pdfPath);
    if (bytes.byteLength < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Teamship did not download a valid picking-list PDF.");
    }
    await execFile("lp", ["-d", job.printerPlan.pickingList.queue, "-n", "1", pdfPath]);
    await waitForCupsQueue(job.printerPlan.pickingList.queue, 30_000);
    return {
      kind: "PICKING_LIST",
      status: "COMPLETED",
      printer: job.printerPlan.pickingList.queue,
      copies: 1
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function printBol(page: Page, job: ClaimedTeamshipPrintJob): Promise<TeamshipPrintExecutionDocument> {
  const expectedName = job.printerPlan.bol.exactName;
  await selectTeamshipPrinterExact(page, expectedName);
  const openPrint = await requireUniqueVisible([
    page.getByRole("button", { name: "Print", exact: true }),
    page.getByText("Print", { exact: true })
  ], "BOL Print control");
  await openPrint.click();
  const modal = page.locator(".bol-print-modal:visible");
  await modal.waitFor({ state: "visible" });
  const selected = await selectTeamshipPrinterExact(modal, expectedName);
  const copies = modal.locator('input[type="number"]:visible').first();
  if (await copies.count()) await copies.fill("1");
  const duplex = modal.locator("select:visible").filter({ has: modal.locator('option:text-is("Single Sided")') }).first();
  if (await duplex.count()) await duplex.selectOption({ label: "Single Sided" });
  const modalPrinter = await findExactPrinterOption(modal, expectedName);
  await assertTeamshipPrinterSelected(modalPrinter.select, expectedName, selected.value);
  const submit = await requireUniqueVisible([
    modal.getByRole("button", { name: "Print", exact: true }),
    modal.locator('button:has-text("Print")')
  ], "final BOL Print control");
  await submit.click();
  await modal.waitFor({ state: "hidden" });
  await assertNoVisiblePrintError(page);
  return { kind: "BOL", status: "SUBMITTED", printer: expectedName, copies: 1 };
}

async function printOutboundLabels(page: Page, job: ClaimedTeamshipPrintJob): Promise<TeamshipPrintExecutionDocument> {
  const expectedName = job.printerPlan.outboundLabels.exactName;
  const selected = await selectTeamshipPrinterExact(page, expectedName);
  const menu = await requireUniqueVisible([
    page.locator(".step2-menu"),
    page.getByText("Step 2", { exact: false })
  ], "Teamship Step 2 menu");
  await menu.click();
  const outbound = await requireUniqueVisible([
    page.locator(".step2-dropdown-item").filter({ hasText: "Print Outbound Labels" }),
    page.getByText("Print Outbound Labels", { exact: true })
  ], "Print Outbound Labels control");
  await outbound.click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Print Outbound Labels" }).first();
  await dialog.waitFor({ state: "visible" });
  const quantity = dialog.locator('input[type="number"]:visible').first();
  if (await quantity.count() !== 1) throw new Error("Outbound-label quantity control was not uniquely identified.");
  await quantity.fill(String(job.approvedPalletCount));

  // Re-read the page-level printer immediately before the irreversible click.
  const headerPrinter = await findExactPrinterOption(page, expectedName);
  await assertTeamshipPrinterSelected(headerPrinter.select, expectedName, selected.value);
  if (await quantity.inputValue() !== String(job.approvedPalletCount)) {
    throw new Error("Outbound-label quantity changed before printing.");
  }
  const submit = await requireUniqueVisible([
    dialog.getByRole("button", { name: "Print", exact: true }),
    dialog.locator('button:has-text("Print")')
  ], "final outbound-label Print control");
  await submit.click();
  await Promise.race([
    page.getByText("Sending print job...", { exact: false }).waitFor({ state: "visible", timeout: 8_000 }),
    dialog.waitFor({ state: "hidden", timeout: 8_000 })
  ]).catch(() => undefined);
  await dialog.waitFor({ state: "hidden" });
  await assertNoVisiblePrintError(page);
  return {
    kind: "OUTBOUND_LABELS",
    status: "SUBMITTED",
    printer: expectedName,
    copies: job.approvedPalletCount
  };
}

async function openTeamshipPage(
  page: Page,
  target: URL,
  job: ClaimedTeamshipPrintJob,
  allowedHosts: ReadonlySet<string>,
  options: TeamshipPrintExecutionOptions
) {
  assertAllowedTeamshipUrl(target, allowedHosts);
  await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  assertAllowedTeamshipUrl(page.url(), allowedHosts);
  if (/\/(?:login|sign-in)\b/i.test(new URL(page.url()).pathname)) {
    await login(page, job, allowedHosts);
    await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  }
  await page.waitForLoadState("networkidle", { timeout: options.navigationTimeoutMs ?? 15_000 }).catch(() => undefined);
  assertTeamshipPrintPageUrl(page.url(), target, job.teamshipOrderId);
}

export function assertTeamshipPrintPageUrl(actualUrl: string, target: URL, teamshipOrderId: string) {
  const actual = new URL(actualUrl);
  const expectedPath = `/ship-inventories/${teamshipOrderId}`;
  const matchesOrderPath = actual.pathname === expectedPath || actual.pathname.startsWith(`${expectedPath}/`);
  if (actual.origin !== target.origin || !matchesOrderPath) {
    throw new Error("Teamship did not open the approved shipping order.");
  }
}

async function waitForPickingListDownload(page: Page, trigger: Locator) {
  const direct = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  const popup = page.context().waitForEvent("page", { timeout: 20_000 })
    .then((newPage) => newPage.waitForEvent("download", { timeout: 20_000 }))
    .catch(() => null);
  await trigger.click();
  const download = await Promise.race([direct, popup]);
  if (download) return download;
  const fallback = await Promise.all([direct, popup]);
  const found = fallback.find((candidate) => candidate !== null);
  if (!found) throw new Error("Teamship did not download the picking-list PDF.");
  return found;
}

async function login(page: Page, job: ClaimedTeamshipPrintJob, allowedHosts: ReadonlySet<string>) {
  assertAllowedTeamshipUrl(page.url(), allowedHosts);
  const email = await requireUniqueVisible([
    page.locator('#email'),
    page.locator('input[name="email"]'),
    page.locator('input[type="email"]')
  ], "Teamship email field");
  const password = await requireUniqueVisible([
    page.locator('input[type="password"]'),
    page.locator('input[name="password"]')
  ], "Teamship password field");
  const submit = await requireUniqueVisible([
    page.getByRole("button", { name: /login/i }),
    page.locator('button[type="submit"]')
  ], "Teamship login button");
  await email.fill(job.credentials.email);
  await password.fill(job.credentials.password);
  await submit.click();
  await page.waitForLoadState("domcontentloaded");
  assertAllowedTeamshipUrl(page.url(), allowedHosts);
}

async function findExactPrinterOption(scope: Page | Locator, exactName: string) {
  const selects = scope.locator("select:visible");
  const optionGroups: Array<Array<{ label: string; value: string }>> = [];
  for (let index = 0; index < await selects.count(); index += 1) {
    const select = selects.nth(index);
    optionGroups.push(await select.locator("option").evaluateAll((options) => options.map((option) => ({
      label: option.textContent?.trim() ?? "",
      value: (option as HTMLOptionElement).value
    }))));
  }
  const candidate = resolveExactPrinterOption(optionGroups, exactName);
  return { select: selects.nth(candidate.selectIndex), value: candidate.value };
}

export function resolveExactPrinterOption(
  optionGroups: Array<Array<{ label: string; value: string }>>,
  exactName: string
) {
  const candidates: Array<{ selectIndex: number; value: string }> = [];
  optionGroups.forEach((options, selectIndex) => {
    const matches = options.filter((option) => option.label === exactName && option.value);
    if (matches.length > 1) throw new Error(`Teamship lists the printer ${exactName} more than once in one control.`);
    if (matches.length === 1) candidates.push({ selectIndex, value: matches[0]!.value });
  });
  if (candidates.length !== 1) {
    throw new Error(candidates.length === 0
      ? `The required Teamship printer ${exactName} is not available on this page.`
      : `The required Teamship printer ${exactName} appears in more than one visible control.`);
  }
  return candidates[0]!;
}

async function requireUniqueVisible(candidates: Locator[], label: string) {
  const unique = new Map<string, Locator>();
  for (const candidate of candidates) {
    for (let index = 0; index < await candidate.count(); index += 1) {
      const locator = candidate.nth(index);
      if (await locator.isVisible()) {
        const handle = await locator.elementHandle();
        if (handle) unique.set(String(await handle.evaluate((element) => `${element.tagName}:${element.outerHTML}`)), locator);
      }
    }
  }
  if (unique.size !== 1) throw new Error(`${label} was not uniquely identified.`);
  return [...unique.values()][0]!;
}

async function assertNoVisiblePrintError(page: Page) {
  const alerts = page.locator('[role="alert"]:visible, .alert:visible, .toast:visible');
  const messages = (await alerts.allInnerTexts()).filter((message) => /error|failed|unable/i.test(message));
  if (messages.length) throw new Error(`Teamship reported a print error: ${messages.join(" ").slice(0, 300)}`);
}

async function assertCupsQueueAvailable(queue: string) {
  if (!/^[A-Za-z0-9._-]{1,127}$/.test(queue)) throw new Error("The configured CUPS queue name is invalid.");
  const { stdout } = await execFile("lpstat", ["-p", queue]);
  if (!stdout.includes(`printer ${queue}`)) throw new Error(`The local printer queue ${queue} is unavailable.`);
}

async function waitForCupsQueue(queue: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { stdout } = await execFile("lpstat", ["-W", "not-completed", "-o", queue]);
    if (!stdout.trim()) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`The picking-list job is still pending on ${queue}.`);
}

function assertApprovedPalletCount(observed: number, approved: number) {
  if (observed !== approved) {
    throw new Error(`Teamship now shows ${observed} pallet(s), but ${approved} were approved. Nothing was printed.`);
  }
}

export function resolveTeamshipPrintAppBaseUrl(configured?: string) {
  return new URL(configured?.trim() || DEFAULT_TEAMSHIP_PRINT_APP_BASE_URL);
}

function resolveAllowedHosts(options: TeamshipPrintExecutionOptions) {
  return new Set((options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS).map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function assertAllowedTeamshipUrl(value: string | URL, allowedHosts: ReadonlySet<string>) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Teamship printing requires an allowlisted HTTPS Teamship host.");
  }
}

async function launchBrowser(options: TeamshipPrintExecutionOptions): Promise<Browser> {
  return chromium.launch({
    executablePath: options.browserExecutablePath?.trim() || undefined,
    headless: !options.headed
  });
}
