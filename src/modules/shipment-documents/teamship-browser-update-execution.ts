import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

import {
  compactGarlandSpecialInstructions,
  type TeamshipPhase2DryRunPlan,
  type TeamshipPhase2OrderPlan
} from "@/modules/shipment-documents/teamship-phase2-dry-run";
import {
  buildDryRunEvidence,
  buildTeamshipUpdatePayload,
  type TeamshipPhase2AgentCredentials,
  type TeamshipPhase2ExecutionOrderResult,
  type TeamshipPhase2ExecutionResult,
  type TeamshipPhase2WorkerJob
} from "@/modules/shipment-documents/teamship-phase2-agent-execution";

export type TeamshipBrowserExecutionOptions = {
  agentId: string;
  allowLiveUpdates: boolean;
  liveAllowlistSrNumbers?: string[];
  browserExecutablePath?: string | null;
  headed?: boolean;
  slowMoMs?: number;
  errorPauseMs?: number;
  fieldUpdatesEnabled?: boolean;
  bolCleanupEnabled?: boolean;
  screenshotRootDir?: string | null;
  allowedHosts?: string[];
};

type PalletControlSnapshot = {
  rowCount: number;
  controlsPerRow: number;
  controls: Array<{
    index: number;
    tagName: string;
    type: string;
    value: string;
    text: string;
  }>;
};

type TaggedPalletControls = {
  rowCount: number;
  controlsPerRow: number;
  controlCount: number;
};

type EditableBolFieldSnapshot = {
  field: string;
  before: string;
  after: string;
  updated: boolean;
};

type BolEditorCleanupSnapshot = {
  bolEditorUrl: string;
  generatedBol: boolean;
  instructions: EditableBolFieldSnapshot | null;
  weightFieldCount: number;
  clearedWeightFieldCount: number;
  fields: Array<{
    field: string;
    before: string;
    after: string;
    cleared: boolean;
  }>;
};

const DEFAULT_TEAMSHIP_APP_BASE_URL = "https://app.teamshipos.com";
const DEFAULT_ALLOWED_HOSTS = ["app.teamshipos.com", "members.fulfillit.io", "staging.teamshipos.com"];

const PALLET_DOM_HELPERS = String.raw`
  function collectPalletControls() {
    const heading = findTextElement("Pallets");
    const end = findTextElement("Additional Charges");

    if (!heading) {
      throw new Error('Could not find "Pallets" heading.');
    }

    return Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
      .filter((element) => isVisible(element))
      .filter((element) => isAfter(element, heading) && (!end || isBefore(element, end)));
  }

  function findTextElement(text) {
    const normalizedText = text.trim().toLowerCase();

    return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,label,span,div,p,a"))
      .filter((element) => isVisible(element))
      .find((element) => (element.textContent || "").trim().toLowerCase() === normalizedText) || null;
  }

  function setElementValue(element, value) {
    if (element instanceof HTMLSelectElement) {
      const option = Array.from(element.options).find((candidate) => /lbs/i.test(candidate.value) || /lbs/i.test(candidate.textContent || ""));
      element.value = option ? option.value : value;
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function isAfter(element, reference) {
    return Boolean(reference.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function isBefore(element, reference) {
    return Boolean(reference.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING);
  }
`;

export async function executeTeamshipPhase2BrowserJob({
  job,
  plan,
  credentials,
  options
}: {
  job: TeamshipPhase2WorkerJob;
  plan: TeamshipPhase2DryRunPlan;
  credentials: TeamshipPhase2AgentCredentials;
  options: TeamshipBrowserExecutionOptions;
}): Promise<TeamshipPhase2ExecutionResult> {
  if (!options.allowLiveUpdates) {
    throw new Error("Live Teamship browser updates require TEAMSHIP_ALLOW_LIVE_UPDATES=true or --allow-live-updates on the VM worker.");
  }

  assertLiveAllowlist(plan, options.liveAllowlistSrNumbers);

  const appBaseUrl = resolveTeamshipAppBaseUrl(credentials);
  const evidence = buildDryRunEvidence({ job, plan, agentId: options.agentId, teamshipAppBaseUrl: appBaseUrl });
  const screenshotRootDir = options.screenshotRootDir?.trim() || path.join("tmp", "teamship-browser-agent", job.id);
  const browser = await launchBrowser(options);
  const orders: TeamshipPhase2ExecutionOrderResult[] = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

    for (const [index, order] of plan.orders.entries()) {
      const mappedOrder = evidence.orders[index]!;
      const orderScreenshotDir = path.join(screenshotRootDir, sanitizePathSegment(order.srNumber || order.teamshipOrderId || `order-${index + 1}`));

      try {
        if (order.status !== "READY" || !order.teamshipOrderId) {
          orders.push({
            ...mappedOrder,
            status: "FAILED",
            error: "Only READY orders with a Teamship order ID can be updated by the live browser worker."
          });
          continue;
        }

        fs.mkdirSync(orderScreenshotDir, { recursive: true });
        const teamshipUrl = resolveOrderUrl({ order, appBaseUrl, allowedHosts: options.allowedHosts });
        await page.goto(teamshipUrl, { waitUntil: "domcontentloaded" });
        await maybeLogin(page, credentials);
        await page.goto(teamshipUrl, { waitUntil: "domcontentloaded" });
        await waitForTeamshipIdle(page);
        await saveScreenshot(page, orderScreenshotDir, "01-before");

        const fieldUpdateErrors: string[] = [];
        const fieldUpdatesSkipped = !options.fieldUpdatesEnabled && order.plannedFieldUpdates.length > 0;

        if (options.fieldUpdatesEnabled) {
          try {
            await fillOrderFieldUpdates(page, order);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown Teamship field update failure.";
            fieldUpdateErrors.push(message);
            await saveScreenshot(page, orderScreenshotDir, "field-update-error").catch(() => undefined);
          }
        }

        if (order.plannedPalletRows.length > 0) {
          await page.getByText(/^Pallets$/i).first().scrollIntoViewIfNeeded();
          await ensurePalletRowCount(page, order.plannedPalletRows.length);
          await fillPalletRows(page, order);
          await saveScreenshot(page, orderScreenshotDir, "02-filled-before-save");
        }

        await clickSave(page);
        await waitForTeamshipIdle(page);
        await saveScreenshot(page, orderScreenshotDir, "03-after-save");
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForTeamshipIdle(page);

        if (order.plannedPalletRows.length > 0) {
          await page.getByText(/^Pallets$/i).first().scrollIntoViewIfNeeded();
        }

        await saveScreenshot(page, orderScreenshotDir, "04-after-reload");
        const palletSnapshot = order.plannedPalletRows.length > 0 ? await readPalletSnapshot(page) : null;
        const bolEditorCleanup = options.bolCleanupEnabled
          ? await openBolEditorAndApplyCleanup({
              page,
              order,
              orderUrl: teamshipUrl,
              appBaseUrl,
              screenshotDir: orderScreenshotDir,
              allowedHosts: options.allowedHosts
            })
          : null;

        const fieldUpdateError = fieldUpdateErrors.length > 0 ? `Field update failed, but remaining browser actions were attempted: ${fieldUpdateErrors.join(" ")}` : undefined;

        orders.push({
          ...mappedOrder,
          status: fieldUpdateError ? "FAILED" : "UPDATED",
          updatePayload: {
            ...buildTeamshipUpdatePayload(order),
            browser: {
              teamshipUrl,
              screenshotDir: orderScreenshotDir,
              palletSnapshot,
              bolEditorCleanup,
              bolEditorCleanupSkipped: !options.bolCleanupEnabled,
              fieldUpdatesSkipped,
              skippedFieldUpdateCount: fieldUpdatesSkipped ? order.plannedFieldUpdates.length : 0,
              fieldUpdateErrors
            }
          },
          responseStatus: fieldUpdateError ? 207 : 200,
          error: fieldUpdateError
        });
      } catch (error) {
        await saveScreenshot(page, orderScreenshotDir, "error").catch(() => undefined);
        const errorMessage = error instanceof Error ? error.message : "Unknown Teamship browser update failure.";
        await pauseForBrowserDebug({
          page,
          options,
          errorMessage,
          orderLabel: order.srNumber || order.teamshipOrderId || `order ${index + 1}`
        });
        orders.push({
          ...mappedOrder,
          status: "FAILED",
          updatePayload: buildTeamshipUpdatePayload(order),
          error: errorMessage
        });
      }
    }
  } finally {
    await browser.close();
  }

  const failedOrders = orders.filter((order) => order.status === "FAILED");

  return {
    mode: "LIVE_BROWSER",
    dryRun: false,
    wouldUpdateTeamship: true,
    executedAt: new Date().toISOString(),
    agentId: options.agentId,
    jobId: job.id,
    summary: plan.summary,
    orders,
    hasFailures: failedOrders.length > 0,
    notes: [
      failedOrders.length > 0
        ? `Live browser worker completed with ${failedOrders.length} failed order(s): ${failedOrders.map((order) => order.srNumber).join(", ")}.`
        : "Live browser worker updated approved Teamship order fields and pallet rows.",
      `Browser evidence screenshots were written under ${screenshotRootDir}.`,
      "Newl Apps will rescan Teamship after this completion response is accepted."
    ]
  };
}

async function launchBrowser(
  options: Pick<TeamshipBrowserExecutionOptions, "browserExecutablePath" | "headed" | "slowMoMs">
): Promise<Browser> {
  const executablePath = options.browserExecutablePath?.trim() || process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH?.trim() || findDefaultBrowserExecutablePath();

  if (!executablePath) {
    throw new Error(
      "Unable to find Chrome. Set TEAMSHIP_BROWSER_EXECUTABLE_PATH or pass --browser-executable-path to an installed Chrome/Chromium binary."
    );
  }

  return chromium.launch({
    executablePath,
    headless: !options.headed,
    slowMo: options.slowMoMs && options.slowMoMs > 0 ? options.slowMoMs : undefined
  });
}

async function pauseForBrowserDebug({
  page,
  options,
  errorMessage,
  orderLabel
}: {
  page: Page;
  options: TeamshipBrowserExecutionOptions;
  errorMessage: string;
  orderLabel: string;
}) {
  const pauseMs = options.errorPauseMs ?? 0;

  if (!options.headed || pauseMs <= 0) {
    return;
  }

  console.error(`Pausing Teamship browser for ${orderLabel} after failure: ${errorMessage}`);
  console.error(`Browser will stay open for ${Math.round(pauseMs / 1000)} second(s) so the failed page can be inspected.`);
  await page.waitForTimeout(pauseMs).catch(() => undefined);
}

async function maybeLogin(page: Page, credentials: TeamshipPhase2AgentCredentials) {
  const emailInput = page.locator('input[type="email"], input[name="email"], input#email').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"], input#password').first();

  if ((await emailInput.count()) === 0 || (await passwordInput.count()) === 0) {
    return;
  }

  await emailInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);

  const loginButton = page
    .getByRole("button", { name: /log in|login|sign in|submit/i })
    .or(page.locator('button[type="submit"], input[type="submit"]').first())
    .first();

  await loginButton.click();
  await waitForTeamshipIdle(page);
}

async function fillOrderFieldUpdates(page: Page, order: TeamshipPhase2OrderPlan) {
  if (order.plannedFieldUpdates.length === 0) {
    return;
  }

  await page.evaluate(
    ({ updates }) => {
      for (const update of updates) {
        const control = findControlForField(update.teamshipField, update.label);

        if (!control) {
          throw new Error(`Could not find a visible Teamship field for ${update.label}.`);
        }

        setControlValue(control, update.proposedValue);
      }

      function findControlForField(teamshipField: string, label: string) {
        const aliases: Record<string, string[]> = {
          poNumber: ["PO Number", "PO"],
          edi_field_3: ["Freight Terms Code", "Freight Terms"],
          edi_field_4: ["Special Instructions"],
          carrier_value: ["Carrier"]
        };
        const labels = aliases[teamshipField] ?? [label, teamshipField];

        for (const candidateLabel of labels) {
          const labelElement = findTextElement(candidateLabel);
          const control = labelElement ? findNextControl(labelElement) : null;

          if (control) {
            return control;
          }
        }

        return null;
      }

      function findTextElement(text: string) {
        const normalizedText = text.trim().toLowerCase();

        return (
          Array.from(document.querySelectorAll("label,span,div,p,h1,h2,h3,h4,h5,h6"))
            .filter((element) => isVisible(element as HTMLElement))
            .find((element) => element.textContent?.trim().toLowerCase() === normalizedText) ?? null
        );
      }

      function findNextControl(reference: Element) {
        return (
          Array.from(document.querySelectorAll("input, textarea, select"))
            .filter((element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
              element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
            )
            .filter((element) => isVisible(element))
            .find((element) => Boolean(reference.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null
        );
      }

      function setControlValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
        if (element instanceof HTMLSelectElement) {
          const option = Array.from(element.options).find((candidate) => candidate.value === value || candidate.textContent?.trim() === value);
          element.value = option?.value ?? value;
        } else {
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
        }

        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }

      function isVisible(element: Element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }
    },
    { updates: order.plannedFieldUpdates }
  );
}

async function ensurePalletRowCount(page: Page, expectedRows: number) {
  for (let attempt = 0; attempt < expectedRows + 3; attempt += 1) {
    const snapshot = await readPalletSnapshot(page);

    if (snapshot.rowCount >= expectedRows) {
      return;
    }

    await clickAddAnotherPalletSize(page);
    await waitForTeamshipIdle(page);
  }

  const snapshot = await readPalletSnapshot(page);
  throw new Error(`Expected ${expectedRows} pallet row(s), but only found ${snapshot.rowCount}.`);
}

async function clickAddAnotherPalletSize(page: Page) {
  const addLink = page.getByText(/add another pallet size/i).last();

  if ((await addLink.count()) === 0) {
    throw new Error('Could not find "Add Another Pallet Size" on the Teamship order page.');
  }

  await addLink.scrollIntoViewIfNeeded();
  await addLink.click();
}

async function fillPalletRows(page: Page, order: TeamshipPhase2OrderPlan) {
  const rows = order.plannedPalletRows.map((row) => ({
    quantity: normalizePositiveNumber(row.quantity, 1),
    lengthIn: normalizePositiveNumber(row.lengthIn, 1),
    widthIn: normalizePositiveNumber(row.widthIn, 1),
    heightIn: normalizePositiveNumber(row.heightIn, 1),
    weightLb: normalizePositiveNumber(row.weightLb, 1),
    weightUnit: row.weightUnit || "lbs",
    commodity: row.commodity.trim() || `SKU: ${row.sku.trim().toUpperCase()}`
  }));
  const controls = await tagPalletControls(page, rows.length);

  for (const [index, row] of rows.entries()) {
    const offset = index * controls.controlsPerRow;
    await fillPalletControl(page, offset, String(row.quantity));
    await fillPalletControl(page, offset + 1, String(row.lengthIn));
    await fillPalletControl(page, offset + 2, String(row.widthIn));
    await fillPalletControl(page, offset + 3, String(row.heightIn));
    await fillPalletControl(page, offset + 4, String(row.weightLb));

    if (controls.controlsPerRow === 7) {
      await fillPalletControl(page, offset + 5, row.weightUnit || "lbs");
      await fillPalletControl(page, offset + 6, row.commodity);
    } else {
      await fillPalletControl(page, offset + 5, row.commodity);
    }
  }

  await assertPalletRowsFilled(page, rows, controls.controlsPerRow);
}

function normalizePositiveNumber(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function tagPalletControls(page: Page, expectedRows: number): Promise<TaggedPalletControls> {
  return page.evaluate(
    String.raw`
      ((expectedRows) => {
        ${PALLET_DOM_HELPERS}
        const controls = collectPalletControls();
        const controlsPerRow = controls.length >= expectedRows * 7 ? 7 : controls.length >= expectedRows * 6 ? 6 : 0;

        if (!controlsPerRow) {
          throw new Error("Not enough visible pallet controls. Found " + controls.length + ", expected at least " + expectedRows * 6 + ".");
        }

        controls.forEach((element, index) => {
          element.setAttribute("data-newl-pallet-control-index", String(index));
        });

        return {
          rowCount: Math.floor(controls.length / controlsPerRow),
          controlsPerRow,
          controlCount: controls.length
        };
      })
    `,
    expectedRows
  );
}

async function fillPalletControl(page: Page, index: number, value: string) {
  const locator = page.locator(`[data-newl-pallet-control-index="${index}"]`).first();

  if ((await locator.count()) === 0) {
    throw new Error(`Could not find Teamship pallet control ${index + 1}.`);
  }

  await locator.scrollIntoViewIfNeeded();
  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());

  if (tagName === "select") {
    await locator.selectOption({ label: value }).catch(async () => {
      await locator.selectOption(value);
    });
  } else {
    await locator.click({ clickCount: 3 });
    await locator.fill(value);
  }

  await locator.evaluate((element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  });
  await page.keyboard.press("Tab").catch(() => undefined);
  await page.waitForTimeout(150);
}

async function assertPalletRowsFilled(
  page: Page,
  rows: Array<{
    quantity: number;
    lengthIn: number;
    widthIn: number;
    heightIn: number;
    weightLb: number;
    commodity: string;
  }>,
  controlsPerRow: number
) {
  const snapshot = await readPalletSnapshot(page);

  for (const [index, row] of rows.entries()) {
    const offset = index * controlsPerRow;
    const expected = [
      String(row.quantity),
      String(row.lengthIn),
      String(row.widthIn),
      String(row.heightIn),
      String(row.weightLb),
      row.commodity
    ];
    const actual = [
      snapshot.controls[offset]?.value,
      snapshot.controls[offset + 1]?.value,
      snapshot.controls[offset + 2]?.value,
      snapshot.controls[offset + 3]?.value,
      snapshot.controls[offset + 4]?.value,
      snapshot.controls[offset + (controlsPerRow === 7 ? 6 : 5)]?.value
    ];

    for (const [fieldIndex, expectedValue] of expected.entries()) {
      if ((actual[fieldIndex] ?? "").trim() !== expectedValue.trim()) {
        throw new Error(
          `Teamship pallet row ${index + 1} did not accept field ${fieldIndex + 1}. Expected ${JSON.stringify(expectedValue)}, saw ${JSON.stringify(actual[fieldIndex] ?? "")}.`
        );
      }
    }
  }
}

async function clickSave(page: Page) {
  const saveButtons = page.getByRole("button", { name: /^(save|update|save changes)$/i });
  const count = await saveButtons.count();

  for (let index = count - 1; index >= 0; index -= 1) {
    const button = saveButtons.nth(index);

    if (await button.isVisible().catch(() => false)) {
      await button.scrollIntoViewIfNeeded();
      await button.click();
      return;
    }
  }

  throw new Error('Could not find a visible "Save", "Update", or "Save Changes" button.');
}

async function clickSaveIfPresent(page: Page) {
  const saveButtons = page.getByRole("button", { name: /^(save|update|save changes|done|✓)$/i });
  const count = await saveButtons.count();

  for (let index = count - 1; index >= 0; index -= 1) {
    const button = saveButtons.nth(index);

    if (await button.isVisible().catch(() => false)) {
      await button.scrollIntoViewIfNeeded();
      await button.click();
      return true;
    }
  }

  return false;
}

async function openBolEditorAndApplyCleanup({
  page,
  order,
  orderUrl,
  appBaseUrl,
  screenshotDir,
  allowedHosts
}: {
  page: Page;
  order: TeamshipPhase2OrderPlan;
  orderUrl: string;
  appBaseUrl: string;
  screenshotDir: string;
  allowedHosts: string[] | undefined;
}): Promise<BolEditorCleanupSnapshot> {
  const bolEditorUrl = resolveBolEditorUrl({ order, appBaseUrl, allowedHosts });
  const generatedBol = await ensureBolEditorReady({ page, orderUrl, bolEditorUrl });

  await saveScreenshot(page, screenshotDir, "05-bol-editor-before-cleanup");
  const instructions = await compactBolEditorInstructions(page, order);
  const weightCleanup = await clearCustomerOrderWeightFields(page);

  if (instructions?.updated || weightCleanup.clearedWeightFieldCount > 0) {
    await clickSaveIfPresent(page);
    await waitForTeamshipIdle(page);
  }

  await saveScreenshot(page, screenshotDir, "06-bol-editor-after-cleanup");

  return {
    bolEditorUrl,
    generatedBol,
    instructions,
    ...weightCleanup
  };
}

async function ensureBolEditorReady({
  page,
  orderUrl,
  bolEditorUrl
}: {
  page: Page;
  orderUrl: string;
  bolEditorUrl: string;
}) {
  await page.goto(bolEditorUrl, { waitUntil: "domcontentloaded" });
  await waitForTeamshipIdle(page);

  if (await hasCustomerOrderInformation(page)) {
    return false;
  }

  await page.goto(orderUrl, { waitUntil: "domcontentloaded" });
  await waitForTeamshipIdle(page);
  await clickGenerateBol(page);
  await waitForTeamshipIdle(page);
  await page.goto(bolEditorUrl, { waitUntil: "domcontentloaded" });
  await waitForTeamshipIdle(page);

  if (!(await hasCustomerOrderInformation(page))) {
    throw new Error("Generated/opened the Teamship BOL editor, but Customer Order Information was not found.");
  }

  return true;
}

async function hasCustomerOrderInformation(page: Page) {
  return (await page.getByText(/customer order information/i).count()) > 0;
}

async function clickGenerateBol(page: Page) {
  const existingGenerateButton = page.getByText(/generate bol/i).last();

  if (await existingGenerateButton.isVisible().catch(() => false)) {
    await existingGenerateButton.click();
    return;
  }

  const bolButtons = page.getByRole("button", { name: /bol/i });
  const count = await bolButtons.count();

  for (let index = count - 1; index >= 0; index -= 1) {
    const button = bolButtons.nth(index);

    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await waitForTeamshipIdle(page);
      break;
    }
  }

  const generateButton = page.getByText(/generate bol/i).last();

  if (!(await generateButton.isVisible().catch(() => false))) {
    throw new Error('Could not find "Generate BOL" on the Teamship order page before opening the BOL editor.');
  }

  await generateButton.click();
}

async function clearCustomerOrderWeightFields(page: Page) {
  const fieldNames = await findCustomerOrderWeightFieldNames(page);
  const fields: BolEditorCleanupSnapshot["fields"] = [];

  if (fieldNames.length === 0) {
    throw new Error("Could not find Customer Order Information weight fields in the Teamship BOL editor.");
  }

  for (const fieldName of fieldNames) {
    const result = await setEditableBolField(page, fieldName, "");
    fields.push({
      field: result.field,
      before: result.before,
      after: result.after,
      cleared: result.updated
    });
  }

  return {
    weightFieldCount: fields.length,
    clearedWeightFieldCount: fields.filter((field) => field.cleared).length,
    fields
  };
}

async function findCustomerOrderWeightFieldNames(page: Page) {
  return page.evaluate(() => {
    const directFields = Array.from(document.querySelectorAll<HTMLElement>("[data-field-content]"))
      .map((element) => element.getAttribute("data-field-content") ?? "")
      .filter((fieldName) => /^customer_order_\d+_weight$/i.test(fieldName));

    if (directFields.length > 0) {
      return Array.from(new Set(directFields));
    }

    const heading = findTextElement("CUSTOMER ORDER INFORMATION");
    const weightHeader = findTextElement("WEIGHT");

    if (!heading || !weightHeader) {
      return [];
    }

    const headingRect = heading.getBoundingClientRect();
    const weightRect = weightHeader.getBoundingClientRect();
    const fields = Array.from(document.querySelectorAll<HTMLElement>("[data-field-content]"))
      .filter((element) => {
        const fieldName = element.getAttribute("data-field-content") ?? "";
        const rect = element.getBoundingClientRect();

        return (
          /^customer_order_\d+_/i.test(fieldName) &&
          rect.top > weightRect.bottom &&
          rect.top > headingRect.bottom &&
          rect.left >= weightRect.left - 8 &&
          rect.right <= weightRect.right + 8
        );
      })
      .map((element) => element.getAttribute("data-field-content") ?? "");

    return Array.from(new Set(fields));

    function findTextElement(text: string) {
      const normalizedText = text.trim().toLowerCase();

      return (
        Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,label,span,div,p,th,td"))
          .filter((element) => isVisible(element))
          .find((element) => (element.textContent ?? "").trim().toLowerCase() === normalizedText) ?? null
      );
    }

    function isVisible(element: HTMLElement) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }
  });
}

async function compactBolEditorInstructions(page: Page, order: TeamshipPhase2OrderPlan): Promise<EditableBolFieldSnapshot | null> {
  const locator = page.locator('[data-field-content="instructions"]').first();

  if ((await locator.count()) === 0) {
    return null;
  }

  const before = normalizeFieldText((await locator.textContent().catch(() => "")) ?? "");
  const nextValue = buildBolEditorInstructionsValue({ order, currentValue: before });

  if (!nextValue || before === nextValue) {
    return null;
  }

  return setEditableBolField(page, "instructions", nextValue);
}

function buildBolEditorInstructionsValue({ order, currentValue }: { order: TeamshipPhase2OrderPlan; currentValue: string }) {
  const specialInstructionsUpdate = order.plannedFieldUpdates.find(
    (field) => field.reviewFieldKey === "shipping_instructions" || field.teamshipField === "edi_field_4"
  );
  const compactedSpecialInstructions = compactGarlandSpecialInstructions(specialInstructionsUpdate?.proposedValue);

  if (compactedSpecialInstructions) {
    const paymentTerms =
      order.plannedFieldUpdates.find((field) => field.teamshipField === "edi_field_3")?.proposedValue ?? extractPaymentTerms(currentValue);

    return paymentTerms ? `Payment Terms:${paymentTerms} ${compactedSpecialInstructions}` : compactedSpecialInstructions;
  }

  if (hasGarlandInstructionNoise(currentValue)) {
    return compactGarlandSpecialInstructions(currentValue);
  }

  return null;
}

async function setEditableBolField(page: Page, fieldName: string, value: string): Promise<EditableBolFieldSnapshot> {
  const locator = page.locator(`[data-field-content="${fieldName}"]`).first();
  const before = normalizeFieldText((await locator.textContent().catch(() => "")) ?? "");

  if (before === value || (!value && (!before || /^click to edit$/i.test(before)))) {
    return {
      field: fieldName,
      before,
      after: before,
      updated: false
    };
  }

  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: true });
  await page.waitForTimeout(250);

  const updated = await page.evaluate((nextValue) => {
    const active = document.activeElement;

    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const prototype = active instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

      if (descriptor?.set) {
        descriptor.set.call(active, nextValue);
      } else {
        active.value = nextValue;
      }

      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.dispatchEvent(new Event("change", { bubbles: true }));
      active.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    }

    if (active instanceof HTMLElement && active.isContentEditable) {
      active.textContent = nextValue;
      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.dispatchEvent(new Event("change", { bubbles: true }));
      active.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    }

    return false;
  }, value);

  if (updated) {
    await page.keyboard.press("Enter").catch(() => undefined);
    await waitForTeamshipIdle(page);
  }

  const after = normalizeFieldText((await locator.textContent().catch(() => "")) ?? "");

  return {
    field: fieldName,
    before,
    after,
    updated
  };
}

async function readPalletSnapshot(page: Page): Promise<PalletControlSnapshot> {
  return page.evaluate(String.raw`
    (() => {
      ${PALLET_DOM_HELPERS}
      const controls = collectPalletControls();
      const selectCount = controls.filter((element) => element instanceof HTMLSelectElement).length;
      const controlsPerRow = selectCount > 0 && controls.length % 7 === 0 ? 7 : 6;

      return {
        rowCount: Math.floor(controls.length / controlsPerRow),
        controlsPerRow,
        controls: controls.map((element, index) => ({
          index,
          tagName: element.tagName.toLowerCase(),
          type: element instanceof HTMLInputElement ? element.type : "",
          value: element instanceof HTMLSelectElement ? element.value : "value" in element ? String(element.value) : "",
          text: element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent?.trim() ?? "" : ""
        }))
      };
    })()
  `);
}

async function waitForTeamshipIdle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function saveScreenshot(page: Page, screenshotDir: string, label: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${label}.png`), fullPage: true });
}

function resolveOrderUrl({
  order,
  appBaseUrl,
  allowedHosts
}: {
  order: TeamshipPhase2OrderPlan;
  appBaseUrl: string;
  allowedHosts: string[] | undefined;
}) {
  const url = new URL(order.teamshipUrl || `/ship-inventories/${encodeURIComponent(order.teamshipOrderId ?? "")}`, appBaseUrl);
  const allowed = new Set([...(allowedHosts ?? DEFAULT_ALLOWED_HOSTS), ...readAllowedHostsFromEnv()]);

  if (!allowed.has(url.hostname)) {
    throw new Error(`Teamship browser update blocked for unapproved host: ${url.hostname}.`);
  }

  return url.toString();
}

function resolveBolEditorUrl({
  order,
  appBaseUrl,
  allowedHosts
}: {
  order: TeamshipPhase2OrderPlan;
  appBaseUrl: string;
  allowedHosts: string[] | undefined;
}) {
  const baseOrderUrl = resolveOrderUrl({ order, appBaseUrl, allowedHosts });
  const url = new URL(baseOrderUrl);
  url.pathname = `/ship-inventories/${encodeURIComponent(order.teamshipOrderId ?? "")}/bol-editor`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function resolveTeamshipAppBaseUrl(credentials: TeamshipPhase2AgentCredentials) {
  return (
    normalizeBaseUrl(credentials.appBaseUrl) ||
    normalizeBaseUrl(process.env.TEAMSHIP_APP_BASE_URL) ||
    deriveTeamshipAppBaseUrl(credentials.apiBaseUrl ?? process.env.TEAMSHIP_API_BASE_URL) ||
    DEFAULT_TEAMSHIP_APP_BASE_URL
  );
}

function deriveTeamshipAppBaseUrl(apiBaseUrl: string | null | undefined) {
  const normalizedApiBaseUrl = normalizeBaseUrl(apiBaseUrl);

  return normalizedApiBaseUrl ? normalizedApiBaseUrl.replace(/\/api$/, "") : null;
}

function normalizeBaseUrl(value: string | null | undefined) {
  const normalizedValue = value?.trim().replace(/\/+$/, "");

  return normalizedValue || null;
}

function readAllowedHostsFromEnv() {
  return (process.env.TEAMSHIP_BROWSER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}

function assertLiveAllowlist(plan: TeamshipPhase2DryRunPlan, allowlistSrNumbers: string[] | undefined) {
  const allowlist = new Set((allowlistSrNumbers ?? []).map(normalizeIdentifier).filter(Boolean));

  if (allowlist.size === 0) {
    throw new Error("Live Teamship browser updates require TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS or --allow-sr for rollout safety.");
  }

  const blockedSrNumbers = plan.orders
    .filter((order) => order.status === "READY")
    .map((order) => order.srNumber)
    .filter((srNumber) => !allowlist.has(normalizeIdentifier(srNumber)));

  if (blockedSrNumbers.length > 0) {
    throw new Error(`Live Teamship browser update blocked because these SRs are not allowlisted: ${blockedSrNumbers.join(", ")}.`);
  }
}

function findDefaultBrowserExecutablePath() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-z0-9._-]/gi, "_");
}

function normalizeIdentifier(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeFieldText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractPaymentTerms(value: string) {
  return value.match(/Payment\s+Terms\s*:?\s*([A-Z0-9-]+)/i)?.[1]?.trim() ?? null;
}

function hasGarlandInstructionNoise(value: string | null | undefined) {
  return Boolean(value && (/\*{3,}/.test(value) || /\r?\n/.test(value)));
}
