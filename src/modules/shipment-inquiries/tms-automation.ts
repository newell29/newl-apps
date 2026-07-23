import { chromium, type Page } from "playwright";

import { isLtlParsedInquiry, type ParsedShipmentInquiry } from "@/modules/shipment-inquiries/parser";
import {
  buildSkippedTradeMiningForLtl,
  enrichShipmentInquiryCustomerWithTradeMining,
  type TradeMiningCustomerIntelligenceResult
} from "@/modules/shipment-inquiries/trademining-customer-intelligence";

export type TmsAutomationResult = {
  quoteNumber: string | null;
  quoteUrl: string;
  tradeMiningCustomerIntelligence: TradeMiningCustomerIntelligenceResult;
  warning?: string;
};

export async function runShipmentInquiryTmsAutomation(inquiry: ParsedShipmentInquiry): Promise<TmsAutomationResult> {
  if (!inquiry.customer.trim()) {
    throw new Error("Parsed customer is empty. Stopping before TMS customer lookup.");
  }

  const tmsUser = requireEnv("TMS_USER");
  const tmsPass = requireEnv("TMS_PASS");
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const customerType = inquiry.customertype === "agent" ? "agent" : "customer";

  try {
    await page.goto("https://teamship.newl.ca/login");
    await page.getByRole("textbox", { name: "Email Address" }).fill(tmsUser);
    await page.getByRole("textbox", { name: "Password" }).fill(tmsPass);
    await page.getByRole("button", { name: "Login" }).click();
    await page.getByRole("link", { name: "Quotes" }).click();
    await page.getByRole("link", { name: "Add a Quote" }).click();

    const tradeMining = isLtlParsedInquiry(inquiry)
      ? buildSkippedTradeMiningForLtl(inquiry.customer, customerType)
      : await enrichShipmentInquiryCustomerWithTradeMining(inquiry.customer, customerType);

    await selectCustomer(page, inquiry.customer);
    await selectOpsRep(page, isLtlParsedInquiry(inquiry) ? "Dispatch D" : "Pricing D");
    await page.locator(`[data-test-id="quotes_create_type_${getTmsModeSelectorKey(inquiry.mode)}Id"]`).click();
    await selectQuoteDirection(page, inquiry);
    await fillBasicQuoteFields(page, inquiry);
    await clickSave(page);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    const quoteNumber = await readCreatedQuoteNumber(page);
    const quoteUrl = await readCreatedQuoteUrl(page);
    await browser.close();
    return {
      quoteNumber,
      quoteUrl,
      tradeMiningCustomerIntelligence: tradeMining,
      warning: quoteNumber ? undefined : "Quote Number label was found, but the value could not be read."
    };
  } catch (error) {
    throw error;
  }
}

async function selectCustomer(page: Page, customer: string) {
  const root = page.locator('[data-test-id="quotes_create_customerLookup_id"]').first();
  await root.waitFor({ state: "visible", timeout: 30000 });
  await root.getByRole("textbox").fill(customer);
  await page.waitForTimeout(1000);
  const exactMatch = page.getByText(new RegExp(`^${escapeRegExp(customer)}$`, "i")).first();
  if (await exactMatch.isVisible().catch(() => false)) {
    await exactMatch.click();
    return;
  }
  const addLead = page.locator('[data-test-id="quotes_create_addLead_id"]').first();
  if (await addLead.isVisible().catch(() => false)) {
    await addLead.click();
    await page.waitForTimeout(1000);
    return;
  }
  throw new Error(`TMS customer lookup did not find a customer match or visible Add a Lead option for "${customer}".`);
}

async function selectOpsRep(page: Page, name: string) {
  const dropdown = page.locator('[data-test-id="quotes_create_opsRep_id"]').first();
  await dropdown.waitFor({ state: "visible", timeout: 30000 });
  await dropdown.click();
  await page.getByText(name, { exact: true }).click();
}

async function selectQuoteDirection(page: Page, inquiry: ParsedShipmentInquiry) {
  const mode = getTmsModeSelectorKey(inquiry.mode);
  const direction = inquiry.direction.trim().toLowerCase() === "import" ? "import" : "export";
  const selector = `[data-test-id="quotes_create_${mode}_shipment_type_${direction}_id"]`;
  const option = page.locator(selector).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
  }
}

async function fillBasicQuoteFields(page: Page, inquiry: ParsedShipmentInquiry) {
  await fillIfVisible(page, "origin", inquiry.origin || inquiry.originPostalCode);
  await fillIfVisible(page, "destination", inquiry.destination || inquiry.destinationPostalCode);
  await fillIfVisible(page, "commodity", inquiry.commodity);
}

async function fillIfVisible(page: Page, label: string, value: string) {
  if (!value.trim()) return;
  const textbox = page.getByRole("textbox", { name: new RegExp(label, "i") }).first();
  if (await textbox.isVisible().catch(() => false)) {
    await textbox.fill(value);
  }
}

async function clickSave(page: Page) {
  const button = page.locator('[data-test-id="quotes_createSave_id"]').first();
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
}

async function readCreatedQuoteUrl(page: Page) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (/\/admin\/quotes\/[^/]+$/i.test(new URL(page.url()).pathname)) return page.url();
    await page.waitForTimeout(500);
  }
  return page.url();
}

async function readCreatedQuoteNumber(page: Page) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText().catch(() => "");
    const match = text.match(/\bQ(?=[A-Za-z0-9/-]*\d)[A-Za-z0-9][A-Za-z0-9/-]*\b/);
    if (match?.[0]) return match[0];
    await page.waitForTimeout(500);
  }
  return null;
}

function getTmsModeSelectorKey(mode: string) {
  const normalized = mode.trim().toLowerCase();
  if (normalized === "ground") return "trucking";
  if (normalized === "drayage") return "dryage";
  if (normalized === "warehousing") return "warehouse";
  return normalized || "ocean";
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
