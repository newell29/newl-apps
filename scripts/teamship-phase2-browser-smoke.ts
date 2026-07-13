import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

type BrowserSmokeOptions = {
  teamshipUrl: string;
  srNumber: string;
  email: string;
  password: string;
  confirmLiveWrite: boolean;
  headed: boolean;
  screenshotDir: string;
  browserExecutablePath: string | null;
  items: BrowserSmokeItem[];
};

type BrowserSmokeItem = {
  sku: string;
  serialNumber: string | null;
  quantity: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
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

async function main() {
  const options = readOptions(process.argv.slice(2));
  assertSafeOptions(options);
  fs.mkdirSync(options.screenshotDir, { recursive: true });

  const browser = await launchBrowser(options);

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(options.teamshipUrl, { waitUntil: "domcontentloaded" });
    await maybeLogin(page, options);
    await page.goto(options.teamshipUrl, { waitUntil: "domcontentloaded" });
    await waitForTeamshipIdle(page);
    await saveScreenshot(page, options, "01-before");

    await page.getByText(/^Pallets$/i).first().scrollIntoViewIfNeeded();
    await ensurePalletRowCount(page, options.items.length);
    await fillPalletRows(page, options.items);
    await saveScreenshot(page, options, "02-filled-before-save");
    await clickSave(page);
    await waitForTeamshipIdle(page);
    await saveScreenshot(page, options, "03-after-save");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForTeamshipIdle(page);
    await page.getByText(/^Pallets$/i).first().scrollIntoViewIfNeeded();
    await saveScreenshot(page, options, "04-after-reload");

    const snapshot = await readPalletSnapshot(page);
    console.log(
      JSON.stringify(
        {
          mode: "BROWSER_STAGING_SMOKE",
          wouldUpdateTeamship: true,
          updatedUrl: options.teamshipUrl,
          srNumber: options.srNumber,
          screenshotDir: options.screenshotDir,
          expectedRows: options.items.map((item) => ({
            quantity: item.quantity,
            dimensions: `${item.lengthIn} x ${item.widthIn} x ${item.heightIn}`,
            weight: `${item.weightLb} lbs`,
            commodity: buildCommodity(item)
          })),
          palletSnapshot: snapshot
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

async function launchBrowser(options: BrowserSmokeOptions): Promise<Browser> {
  const executablePath = options.browserExecutablePath ?? findDefaultBrowserExecutablePath();

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

async function maybeLogin(page: Page, options: BrowserSmokeOptions) {
  const emailInput = page.locator('input[type="email"], input[name="email"], input#email').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"], input#password').first();

  if ((await emailInput.count()) === 0 || (await passwordInput.count()) === 0) {
    return;
  }

  await emailInput.fill(options.email);
  await passwordInput.fill(options.password);

  const loginButton = page
    .getByRole("button", { name: /log in|login|sign in|submit/i })
    .or(page.locator('button[type="submit"], input[type="submit"]').first())
    .first();

  await loginButton.click();
  await waitForTeamshipIdle(page);
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

async function fillPalletRows(page: Page, items: BrowserSmokeItem[]) {
  const serializedItems = JSON.stringify(items);

  await page.evaluate(String.raw`
    (() => {
      const rows = ${serializedItems};
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
        setElementValue(controls[offset + 5], "lbs");
        setElementValue(controls[offset + 6], row.serialNumber ? "SKU: " + row.sku + " SN: " + row.serialNumber : "SKU: " + row.sku + " QTY: " + row.quantity);
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

async function saveScreenshot(page: Page, options: BrowserSmokeOptions, label: string) {
  const filePath = path.join(options.screenshotDir, `${label}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
}

function readOptions(args: string[]): BrowserSmokeOptions {
  const teamshipUrl = readStringOption(args, "--teamship-url") ?? process.env.TEAMSHIP_TEST_ORDER_URL;
  const email = readStringOption(args, "--email") ?? process.env.TEAMSHIP_EMAIL;
  const password = readStringOption(args, "--password") ?? process.env.TEAMSHIP_PASSWORD;
  const srNumber = readStringOption(args, "--sr") ?? process.env.TEAMSHIP_TEST_SR_NUMBER;

  if (!teamshipUrl) {
    throw new Error("Provide --teamship-url or TEAMSHIP_TEST_ORDER_URL.");
  }

  if (!email || !password) {
    throw new Error("Provide TEAMSHIP_EMAIL and TEAMSHIP_PASSWORD, or pass --email and --password.");
  }

  if (!srNumber) {
    throw new Error("Provide --sr or TEAMSHIP_TEST_SR_NUMBER.");
  }

  return {
    teamshipUrl,
    srNumber,
    email,
    password,
    confirmLiveWrite: args.includes("--confirm-live-write"),
    headed: args.includes("--headed") || process.env.TEAMSHIP_BROWSER_HEADED === "true",
    screenshotDir:
      readStringOption(args, "--screenshot-dir") ??
      process.env.TEAMSHIP_BROWSER_SCREENSHOT_DIR ??
      path.join("tmp", "teamship-browser-smoke", new Date().toISOString().replace(/[:.]/g, "-")),
    browserExecutablePath: readStringOption(args, "--browser-executable-path") ?? process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH ?? null,
    items: readItems(args)
  };
}

function assertSafeOptions(options: BrowserSmokeOptions) {
  if (!options.teamshipUrl.startsWith("https://staging.teamshipos.com/")) {
    throw new Error("Browser smoke tests are restricted to https://staging.teamshipos.com/.");
  }

  if (!options.confirmLiveWrite) {
    throw new Error("Browser smoke test will update staging Teamship. Pass --confirm-live-write to continue.");
  }
}

function readItems(args: string[]) {
  const itemArgs = args.flatMap((arg, index) => (arg === "--item" ? [args[index + 1] ?? ""] : [])).filter(Boolean);

  if (itemArgs.length === 0) {
    throw new Error("Provide at least one --item sku,serial,quantity,length,width,height,weight.");
  }

  return itemArgs.map(parseItem);
}

function parseItem(value: string): BrowserSmokeItem {
  const [sku, serialNumber, quantity, lengthIn, widthIn, heightIn, weightLb] = value.split(",").map((part) => part.trim());

  if (!sku) {
    throw new Error("--item format requires sku,serial,quantity,length,width,height,weight.");
  }

  return {
    sku,
    serialNumber: readNullableString(serialNumber),
    quantity: readPositiveNumber(quantity, 1),
    lengthIn: readPositiveNumber(lengthIn, 1),
    widthIn: readPositiveNumber(widthIn, 1),
    heightIn: readPositiveNumber(heightIn, 1),
    weightLb: readPositiveNumber(weightLb, 1)
  };
}

function buildCommodity(item: BrowserSmokeItem) {
  return item.serialNumber ? `SKU: ${item.sku} SN: ${item.serialNumber}` : `SKU: ${item.sku} QTY: ${item.quantity}`;
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

function readStringOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function readNullableString(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue || normalizedValue.toUpperCase() === "N/A" || normalizedValue.toUpperCase() === "NA") {
    return null;
  }

  return normalizedValue;
}

function readPositiveNumber(value: string | null | undefined, fallback: number) {
  const parsed = value ? Number(value) : fallback;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
