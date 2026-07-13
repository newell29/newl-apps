import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

import type { TeamshipPhase2DryRunPlan, TeamshipPhase2OrderPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";
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
  screenshotRootDir?: string | null;
  allowedHosts?: string[];
};

type PalletControlSnapshot = {
  rowCount: number;
  controls: Array<{
    index: number;
    tagName: string;
    type: string;
    value: string;
    text: string;
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

        await fillOrderFieldUpdates(page, order);

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

        orders.push({
          ...mappedOrder,
          status: "UPDATED",
          updatePayload: {
            ...buildTeamshipUpdatePayload(order),
            browser: {
              teamshipUrl,
              screenshotDir: orderScreenshotDir,
              palletSnapshot
            }
          },
          responseStatus: 200
        });
      } catch (error) {
        await saveScreenshot(page, orderScreenshotDir, "error").catch(() => undefined);
        orders.push({
          ...mappedOrder,
          status: "FAILED",
          updatePayload: buildTeamshipUpdatePayload(order),
          error: error instanceof Error ? error.message : "Unknown Teamship browser update failure."
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

async function launchBrowser(options: Pick<TeamshipBrowserExecutionOptions, "browserExecutablePath" | "headed">): Promise<Browser> {
  const executablePath = options.browserExecutablePath?.trim() || process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH?.trim() || findDefaultBrowserExecutablePath();

  if (!executablePath) {
    throw new Error(
      "Unable to find Chrome. Set TEAMSHIP_BROWSER_EXECUTABLE_PATH or pass --browser-executable-path to an installed Chrome/Chromium binary."
    );
  }

  return chromium.launch({
    executablePath,
    headless: !options.headed
  });
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
    quantity: row.quantity,
    lengthIn: row.lengthIn ?? 1,
    widthIn: row.widthIn ?? 1,
    heightIn: row.heightIn ?? 1,
    weightLb: row.weightLb ?? 1,
    weightUnit: row.weightUnit || "lbs",
    commodity: row.commodity
  }));
  const serializedRows = JSON.stringify(rows);

  await page.evaluate(String.raw`
    (() => {
      const rows = ${serializedRows};
      ${PALLET_DOM_HELPERS}
      const controls = collectPalletControls();
      const controlsPerRow = 7;

      if (controls.length < rows.length * controlsPerRow) {
        throw new Error("Not enough visible pallet controls. Found " + controls.length + ", expected " + rows.length * controlsPerRow + ".");
      }

      for (const [index, row] of rows.entries()) {
        const offset = index * controlsPerRow;
        setElementValue(controls[offset], String(row.quantity));
        setElementValue(controls[offset + 1], String(row.lengthIn));
        setElementValue(controls[offset + 2], String(row.widthIn));
        setElementValue(controls[offset + 3], String(row.heightIn));
        setElementValue(controls[offset + 4], String(row.weightLb));
        setElementValue(controls[offset + 5], row.weightUnit || "lbs");
        setElementValue(controls[offset + 6], row.commodity);
      }
    })()
  `);
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

async function readPalletSnapshot(page: Page): Promise<PalletControlSnapshot> {
  return page.evaluate(String.raw`
    (() => {
      ${PALLET_DOM_HELPERS}
      const controls = collectPalletControls();
      const controlsPerRow = 7;

      return {
        rowCount: Math.floor(controls.length / controlsPerRow),
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
