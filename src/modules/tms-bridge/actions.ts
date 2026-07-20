"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ImapFlow } from "imapflow";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { connect as connectTls } from "node:tls";
import { chromium, type Locator, type Page } from "playwright";
import { fileURLToPath } from "url";

import { LTL_ACCESSORIAL_LEGEND } from "@/modules/ltl-rate-portal/constants";
import { isLtlInquiry, rateLtlInquiryIfApplicable, type LtlInquiryRatingResult } from "./ltl-inquiry-rating";
import { enrichTmsInquiryCustomerWithTradeMining, type TradeMiningCustomerIntelligenceResult } from "./trademining-customer-intelligence";

const GMAIL_IMAP_HOST = "imap.gmail.com";
const GMAIL_IMAP_PORT = 993;
const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 465;
const GMAIL_IDLE_REFRESH_MS = 15_000;
const GEMINI_MODEL = "gemini-2.5-flash";
const COMPLETED_INQUIRY_EMAIL_TO = "pricing@newlgroup.com";
const COMPLETED_LTL_INQUIRY_EMAIL_TO = "dispatch@newlgroup.com";
const TMS_DIAGNOSTIC_DIR = path.join(process.cwd(), ".tmp", "tms-diagnostics");
const TEAMSHIP_CUSTOMER_LIST_PATH = path.join(process.cwd(), "data", "tms-customers", "teamship-customers.csv");
const TEAMSHIP_CUSTOMER_NAME_COLUMN = "company_name";
const TEAMSHIP_CUSTOMER_MATCH_THRESHOLD = 0.88;

type GmailMessagePayload = {
  uid: number;
  subject: string;
  emailText: string;
  forwardingSenderDomain: string | null;
};

type OriginalSenderInfo = {
  name: string | null;
  email: string | null;
  domain: string | null;
  source: string;
};

export type LogisticsInquiry = {
  customer: string;
  customertype: "customer" | "agent";
  mode: string;
  origin: string;
  destination: string;
  incoterms: string;
  service: string;
  direction: string;
  shipmentType: string;
  urgency: string;
  requestedTiming: string;
  originPostalCode: string;
  originCountry: string;
  destinationPostalCode: string;
  destinationCountry: string;
  pickupDate: string;
  freightClass: string;
  nmfc: string;
  unNumber: string;
  accessorials: string[];
  containerQuantity: string;
  containerSize: string;
  equipmentType: string;
  containerWeight: string;
  weightUnit: "LBS" | "KG" | "";
  dimensionsUnit: "CM" | "INCH" | "";
  floorLoaded: boolean;
  commodity: string;
  items: Array<{
    quantity: string;
    packagingType: string;
    length: string;
    width: string;
    height: string;
    weight: string;
    weightType: "each" | "total" | "";
    freightClass: string;
    nmfc: string;
    unNumber: string;
  }>;
  insurance: boolean;
  customs: boolean;
  dangerousGoods: boolean;
  readyDate: string;
};

export type ParsedEmailLogisticsData = {
  customer: string;
  customertype: "customer" | "agent" | "";
  mode: string;
  origin: string;
  destination: string;
  incoterms: string;
  service: string;
  direction: string;
  shipmentType: string;
  urgency: string;
  requestedTiming: string;
  originPostalCode: string;
  originCountry: string;
  destinationPostalCode: string;
  destinationCountry: string;
  pickupDate: string;
  freightClass: string;
  nmfc: string;
  unNumber: string;
  accessorials: string[];
  containerQuantity: string;
  containerSize: string;
  equipmentType: string;
  containerWeight: string;
  weightUnit: "LBS" | "KG" | "";
  dimensionsUnit: "CM" | "INCH" | "";
  floorLoaded: boolean;
  commodity: string;
  items: Array<{
    quantity: string;
    packagingType: string;
    length: string;
    width: string;
    height: string;
    weight: string;
    weightType: "each" | "total" | "";
    freightClass: string;
    nmfc: string;
    unNumber: string;
  }>;
  insurance: boolean;
  customs: boolean;
  dangerousGoods: boolean;
  readyDate: string;
};

export type TmsAutomationResult =
  | {
      ok: true;
      tmsFileNumber: string;
      message?: string;
    }
  | {
      ok: false;
      error: string;
    };

export type TmsCreatedQuoteResult = {
  quoteNumber: string | null;
  quoteUrl: string;
  warning?: string;
  tradeMiningCustomerIntelligence: TradeMiningCustomerIntelligenceResult;
};

export async function fetchLatestTmsEmail(): Promise<string> {
  const client = createGmailClient();
  const targetFolder = getTargetFolder();

  try {
    await client.connect();
    await client.mailboxOpen(targetFolder);
    const unreadUids = await searchUnreadUids(client);
    const latestUnreadUid = unreadUids.at(-1);

    const message = latestUnreadUid ? await fetchMessagePayloadByUid(client, latestUnreadUid) : null;
    return message?.emailText ?? "";
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function startTmsEmailListener(): Promise<void> {
  const client = createGmailClient();
  const targetFolder = getTargetFolder();
  const processedUids = new Set<number>();
  const pendingSequences: number[] = [];
  let processing = Promise.resolve();

  async function processUnreadMessages(reason: string) {
    try {
      console.log(`[gmail-listener] Checking unread mail. reason=${reason}`);
      while (pendingSequences.length > 0) {
        const sequence = pendingSequences.shift();
        if (!sequence) {
          continue;
        }

        const sequenceMessage = await fetchMessagePayloadBySequence(client, sequence);
        if (!sequenceMessage) {
          console.log(`[gmail-listener] New sequence ${sequence} could not be fetched yet. It will be retried by unread UID polling.`);
          continue;
        }

        await processEmailBody(sequenceMessage, `sequence-${sequence}`);
      }

      const unreadUids = await searchUnreadUids(client);
      console.log(`[gmail-listener] Unread UID count=${unreadUids.length}`, unreadUids);

      for (const uid of unreadUids) {
        if (processedUids.has(uid)) {
          console.log(`[gmail-listener] UID ${uid} already processed in this listener session. Skipping.`);
          continue;
        }

        const message = await fetchMessagePayloadByUid(client, uid);
        if (!message?.emailText) {
          console.log(`[gmail-listener] UID ${uid} had no body text yet. Leaving unprocessed so it can retry.`);
          continue;
        }

        await processEmailBody(message, "unread-uid");
      }
    } catch (error) {
      console.error(`[gmail-listener] Pipeline failed while handling unread mail. reason=${reason}`, error);
    }
  }

  async function processEmailBody(message: GmailMessagePayload, source: string) {
    const { uid, subject, emailText, forwardingSenderDomain } = message;
    if (processedUids.has(uid)) {
      console.log(`[gmail-listener] UID ${uid} already processed after body extraction. source=${source}. Skipping.`);
      return;
    }

    processedUids.add(uid);
    console.log(`[gmail-listener] Unread email found. source=${source} uid=${uid}. bodyLength=${emailText.length}`);
    console.log(`[gmail-listener] Raw incoming email subject for UID ${uid}: ${subject || "(no subject)"}`);
    const originalSender = extractOriginalSenderInfo(emailText, forwardingSenderDomain);
    console.log(`[gmail-listener] Original sender domain for customer resolution: ${originalSender.domain ?? "(none)"} source=${originalSender.source}`);
    await markFetchedEmailSeen(client, uid);
    console.log(`[gmail-listener] Calling Gemini parser for UID ${uid}...`);
    const parsedJson = await parseEmailWithGemini(emailText);
    const parsedData = JSON.parse(parsedJson) as ParsedEmailLogisticsData;
    await resolveParsedCustomerNameFromWebsite(parsedData, originalSender.domain);
    await applyTeamshipCustomerMatch(parsedData, originalSender.domain);
    console.log(`[gmail-listener] Parsed customer ready for workflow: customer="${parsedData.customer || "(unresolved)"}" customertype=${normalizeCustomerType(parsedData.customertype)}`);
    console.log(`[gmail-listener] Parsed data being passed to runTmsAutomation for UID ${uid}:`, parsedData);
    console.log(`[gmail-listener] About to launch TMS browser automation for UID ${uid}...`);
    const tmsAutomationResult = await runTmsAutomation(parsedData);
    console.log(`[gmail-listener] TMS browser automation completed for UID ${uid}.`);
    const normalizedParsedData = normalizeLogisticsInquiry(parsedData);
    const ltlRating = await rateLtlInquiryIfApplicable(normalizedParsedData);
    logTmsLtlRatingResult(ltlRating);
    await sendCompletedInquiryEmailSafely({
      originalSubject: subject,
      parsedData: normalizedParsedData,
      quote: tmsAutomationResult,
      tradeMining: tmsAutomationResult.tradeMiningCustomerIntelligence,
      ltlRating
    });
  }

  function queueUnreadProcessing(reason: string) {
    console.log(`[gmail-listener] Queueing unread processing. reason=${reason}`);
    processing = processing.then(() => processUnreadMessages(reason)).catch((error) => {
      console.error(`[gmail-listener] Queued unread processing crashed. reason=${reason}`, error);
    });
  }

  client.on("mailboxOpen", (mailbox) => {
    console.log(`[gmail-listener] mailboxOpen path=${mailbox.path} exists=${mailbox.exists}`);
  });

  client.on("exists", (event) => {
    console.log("[gmail-listener] exists event received", event);
    for (let sequence = event.prevCount + 1; sequence <= event.count; sequence += 1) {
      console.log(`[gmail-listener] Queuing new message sequence from exists event: ${sequence}`);
      pendingSequences.push(sequence);
    }
    queueUnreadProcessing("exists-event");
  });

  client.on("flags", (event) => {
    console.log("[gmail-listener] flags event received", event);
    queueUnreadProcessing("flags-event");
  });

  client.on("close", () => {
    console.log("[gmail-listener] IMAP connection closed.");
  });

  client.on("error", (error) => {
    console.error("[gmail-listener] IMAP client error", error);
  });

  console.log(`[gmail-listener] Connecting to Gmail IMAP host=${GMAIL_IMAP_HOST} port=${GMAIL_IMAP_PORT}`);
  await client.connect();
  console.log("[gmail-listener] Connected.");
  await client.mailboxOpen(targetFolder);
  console.log(`[gmail-listener] Opened target folder=${targetFolder}`);
  await processUnreadMessages("startup");

  try {
    for (;;) {
      console.log(`[gmail-listener] Entering Gmail IDLE for up to ${GMAIL_IDLE_REFRESH_MS}ms...`);
      const idleResult = await client.idle();
      console.log(`[gmail-listener] IDLE returned. result=${String(idleResult)}. Running fallback unread poll.`);
      await processUnreadMessages("post-idle");
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function runTmsAutomation(data: ParsedEmailLogisticsData | LogisticsInquiry): Promise<TmsCreatedQuoteResult> {
  const tmsData = normalizeLogisticsInquiry(data);
  console.log("[tms-automation] runTmsAutomation received normalized data:", tmsData);
  if (!tmsData.customer) {
    throw new Error("Parsed customer is empty. Stopping before TMS customer lookup.");
  }

  const tmsUser = requireEnvValue("TMS_USER");
  const tmsPass = requireEnvValue("TMS_PASS");
  console.log("[tms-automation] Launching visible Playwright browser...");
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log("[tms-automation] Browser opened. Navigating to Teamship login...");
    await page.goto("https://teamship.newl.ca/login");
    await page.getByRole("textbox", { name: "Email Address" }).fill(tmsUser);
    await page.getByRole("textbox", { name: "Password" }).fill(tmsPass);
    await page.getByRole("button", { name: "Login" }).click();
    await page.getByRole("link", { name: "Quotes" }).click();
    await page.getByRole("link", { name: "Add a Quote" }).click();

    const tradeMiningCustomerIntelligence = isLtlInquiry(tmsData)
      ? buildSkippedTradeMiningForLtl(tmsData)
      : await enrichTmsInquiryCustomerWithTradeMining(tmsData.customer, tmsData.customertype);
    logTmsTradeMiningCustomerIntelligence(tradeMiningCustomerIntelligence);

    console.log(`[tms-automation] About to type into customer lookup. Exact customer string="${tmsData.customer}"`);
    await selectDynamicDropdownOption(page, {
      rootSelector: '[data-test-id="quotes_create_customerLookup_id"]',
      inputRole: "textbox",
      value: tmsData.customer,
      label: "customer lookup",
      addLeadWhenNoMatch: true
    });

    const opsRepDropdown = page.locator('[data-test-id="quotes_create_opsRep_id"]');
    await opsRepDropdown.waitFor({ state: "visible" });
    await opsRepDropdown.click();
    const opsRepName = getOpsRepNameForInquiry(tmsData);
    const opsRepOption = opsRepDropdown.getByText(opsRepName);
    await opsRepOption.waitFor({ state: "visible" });
    await opsRepOption.click();
    await page.locator(`[data-test-id="quotes_create_type_${getTmsModeSelectorKey(tmsData.mode)}Id"]`).click();
    await selectQuoteTypeOptions(page, tmsData);
    await completeQuoteFormForMode(page, tmsData);

    await clickTmsQuoteSaveButton(page);
    console.log("[tms-automation] Quote save button clicked.");
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    const createdQuote = await captureCreatedQuoteDetails(page, tradeMiningCustomerIntelligence);
    console.log(`[tms-automation] Created quote number: ${createdQuote.quoteNumber ?? "(not captured)"}`);
    console.log(`[tms-automation] Created quote URL: ${createdQuote.quoteUrl}`);
    if (createdQuote.warning) {
      console.log(`[tms-automation] Quote capture warning: ${createdQuote.warning}`);
    }
    await browser.close();
    console.log("[tms-automation] Browser closed after successful automation.");
    return createdQuote;
  } catch (error) {
    console.error("[tms-automation] Automation failed. Leaving browser open for inspection.", error);
    throw error;
  }
}

async function captureCreatedQuoteDetails(
  page: Page,
  tradeMiningCustomerIntelligence: TradeMiningCustomerIntelligenceResult
): Promise<TmsCreatedQuoteResult> {
  try {
    const quoteNumber = await readCreatedQuoteNumber(page);
    const quoteUrl = await readCreatedQuoteUrl(page);

    if (!quoteNumber) {
      return {
        quoteNumber: null,
        quoteUrl,
        tradeMiningCustomerIntelligence,
        warning: "Quote Number label was found, but the value could not be read."
      };
    }

    return {
      quoteNumber,
      quoteUrl,
      tradeMiningCustomerIntelligence
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown quote capture error.";
    return {
      quoteNumber: null,
      quoteUrl: page.url(),
      tradeMiningCustomerIntelligence,
      warning: `Quote number capture failed: ${errorMessage}`
    };
  }
}

async function clickTmsQuoteSaveButton(page: Page): Promise<void> {
  const saveByTestId = page.locator('[data-test-id="quotes_createSave_id"]').first();
  const saveByRole = page.getByRole("button", { name: /^Save$/i }).first();

  for (const saveButton of [saveByTestId, saveByRole]) {
    try {
      await saveButton.waitFor({ state: "visible", timeout: 5000 });
      await saveButton.click();
      return;
    } catch {
      // Try the next proven Save locator before collecting diagnostics.
    }
  }

  const saveCount = await page.locator('[data-test-id="quotes_createSave_id"]').count();
  const visibleSaveButtons = await page.getByRole("button", { name: /^Save$/i }).count().catch(() => 0);
  const validationMessage = await readVisibleTmsValidationMessage(page);
  const pageState = await readTmsVisiblePageState(page);
  const screenshotPath = await saveTmsDiagnosticScreenshot(page, "quote-save-button-not-visible");
  throw new Error(
    `TMS quote save button was not visible/clickable. dataTestIdCount=${saveCount}. visibleSaveButtonCount=${visibleSaveButtons}. validation=${validationMessage || "(none)"}. requiredEmptyFields=${pageState.requiredEmptyFields || "(none)"}. visiblePageState="${pageState.visibleText}". screenshot=${screenshotPath}`
  );
}

async function readCreatedQuoteUrl(page: Page): Promise<string> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const currentUrl = page.url();
    if (isSavedQuoteUrl(currentUrl)) {
      return currentUrl;
    }

    await page.waitForTimeout(500);
  }

  return page.url();
}

function isSavedQuoteUrl(value: string) {
  try {
    const url = new URL(value);
    return /^\/admin\/quotes\/[^/]+$/i.test(url.pathname) && !/\/create$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function readCreatedQuoteNumber(page: Page): Promise<string | null> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const quoteNumber = await readVisibleQuoteNumberOnce(page);
    if (quoteNumber) {
      return quoteNumber;
    }

    await page.waitForTimeout(500);
  }

  return readVisibleQuoteNumberOnce(page);
}

async function readVisibleQuoteNumberOnce(page: Page): Promise<string | null> {
  const headerText = await readFirstVisibleText(page, [
    'span:has-text("Quote No:")',
    'header:has-text("Quote No:")',
    'main:has-text("Quote No:")',
    'body:has-text("Quote No:")'
  ]);
  const quoteNoMatch = extractQuoteNumberFromText(headerText);
  if (quoteNoMatch) {
    return quoteNoMatch;
  }

  const quoteNumberSectionText = await readFirstVisibleText(page, [
    'div:has-text("Quote Number")',
    'section:has-text("Quote Number")',
    'main:has-text("Quote Number")',
    'body:has-text("Quote Number")'
  ]);
  return extractQuoteNumberFromText(quoteNumberSectionText);
}

async function readFirstVisibleText(page: Page, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 1000 });
      const text = normalizeUiText(await locator.innerText());
      if (text) {
        return text;
      }
    } catch {
      // Try the next visible area.
    }
  }

  return "";
}

export function extractQuoteNumberFromText(text: string): string | null {
  const quoteNoMatch = text.match(/Quote\s*No:\s*(Q(?=[A-Za-z0-9\-\/]*\d)[A-Za-z0-9][A-Za-z0-9\-\/]*)/i);
  if (quoteNoMatch?.[1]) {
    return quoteNoMatch[1];
  }

  const quoteNumberMatch = text.match(/Quote\s*Number\s*[:#]?\s*(Q(?=[A-Za-z0-9\-\/]*\d)[A-Za-z0-9][A-Za-z0-9\-\/]*)/i);
  if (quoteNumberMatch?.[1]) {
    return quoteNumberMatch[1];
  }

  const standaloneQuoteMatch = text.match(/\b(Q(?=[A-Za-z0-9\-\/]*\d)[A-Za-z0-9]{4,}[A-Za-z0-9\-\/]*)\b/i);
  return standaloneQuoteMatch?.[1] ?? null;
}

function normalizeUiText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function logTmsTradeMiningCustomerIntelligence(result: TradeMiningCustomerIntelligenceResult) {
  console.log(
    [
      "[tms-automation] TradeMining customer intelligence:",
      `customerName=${result.customerNameSearched ?? "(none)"}`,
      `customerType=${result.customerType}`,
      `searchField=${result.searchField}`,
      `searchStarted=${result.searchStarted}`,
      `searchSucceeded=${result.searchSucceeded}`,
      `searchId=${result.searchId ?? "(none)"}`,
      `shipmentRecords=${result.totalShipmentRecordsFound}`,
      `warning=${result.warning ?? "(none)"}`
    ].join(" ")
  );
}

function buildSkippedTradeMiningForLtl(data: LogisticsInquiry): TradeMiningCustomerIntelligenceResult {
  return {
    searchStarted: false,
    searchSucceeded: false,
    customerNameSearched: data.customer || null,
    customerType: data.customertype,
    searchField: data.customertype === "agent" ? "MasterShipperName" : "ConsigneeName",
    dateRange: {
      start: "",
      end: ""
    },
    totalShipmentRecordsFound: 0,
    searchId: null,
    warning: "TradeMining skipped for LTL inquiry. 7L rating is used for LTL after the TMS quote is created.",
    fieldsUsed: [],
    summary: {},
    recentRecords: [],
    workbookAttachment: null
  };
}

function logTmsLtlRatingResult(result: LtlInquiryRatingResult) {
  if (!result.isLtl) {
    return;
  }

  console.log(
    [
      "[tms-automation] LTL 7L rating:",
      `status=${result.status}`,
      `account=${result.accountName ?? "(none)"}`,
      `enabledCarriers=${result.enabledCarrierCount}`,
      `quotes=${result.quotes.length}`,
      `carrierErrors=${result.errors.length}`,
      `missingRequiredFields=${result.adapter?.missingRequiredFields.join(",") || "(none)"}`,
      `warning=${result.warning ?? "(none)"}`
    ].join(" ")
  );
}

async function sendCompletedInquiryEmailSafely({
  originalSubject,
  parsedData,
  quote,
  tradeMining,
  ltlRating
}: {
  originalSubject: string;
  parsedData: LogisticsInquiry;
  quote: TmsCreatedQuoteResult;
  tradeMining: TradeMiningCustomerIntelligenceResult;
  ltlRating?: LtlInquiryRatingResult;
}) {
  try {
    await sendCompletedInquiryEmail({
      originalSubject,
      parsedData,
      quote,
      tradeMining,
      ltlRating
    });
  } catch (error) {
    console.error(
      `[gmail-listener] Completed inquiry email failed after TMS quote creation. Quote remains created. error=${error instanceof Error ? error.message : "Unknown email error."}`
    );
  }
}

async function sendCompletedInquiryEmail({
  originalSubject,
  parsedData,
  quote,
  tradeMining,
  ltlRating
}: {
  originalSubject: string;
  parsedData: LogisticsInquiry;
  quote: TmsCreatedQuoteResult;
  tradeMining: TradeMiningCustomerIntelligenceResult;
  ltlRating?: LtlInquiryRatingResult;
}) {
  const subject = quote.quoteNumber ? `${originalSubject || "(no subject)"} ${quote.quoteNumber}` : originalSubject || "(no subject)";
  const isLtlEmail = Boolean(ltlRating?.isLtl);
  const warnings = isLtlEmail
    ? [quote.warning, ltlRating?.warning].filter(Boolean)
    : [quote.warning, tradeMining.warning, ltlRating?.warning].filter(Boolean);
  const attachment =
    !ltlRating?.isLtl && tradeMining.searchSucceeded && tradeMining.workbookAttachment
      ? {
          fileName: tradeMining.workbookAttachment.fileName,
          content: tradeMining.workbookAttachment.content,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
      : null;
  const to = getCompletedInquiryEmailRecipient(ltlRating);

  await sendGmailSmtpMessage({
    to,
    subject,
    html: buildCompletedInquiryEmailHtml({
      parsedData,
      quote,
      tradeMining,
      ltlRating,
      warnings
    }),
    attachments: attachment ? [attachment] : []
  });

  console.log(
    `[gmail-listener] Completed inquiry email sent to ${to}. quoteNumber=${quote.quoteNumber ?? "(not captured)"} tradeMiningAttachment=${attachment ? "yes" : "no"} ltlRating=${ltlRating?.status ?? "not_applicable"}`
  );
}

export function getCompletedInquiryEmailRecipient(ltlRating?: Pick<LtlInquiryRatingResult, "isLtl">) {
  return ltlRating?.isLtl ? COMPLETED_LTL_INQUIRY_EMAIL_TO : COMPLETED_INQUIRY_EMAIL_TO;
}

export function getOpsRepNameForInquiry(data: Pick<LogisticsInquiry, "mode" | "shipmentType">) {
  return isLtlInquiry(data) ? "Dispatch D" : "Pricing D";
}

export function buildCompletedInquiryEmailHtml({
  parsedData,
  quote,
  tradeMining,
  ltlRating,
  warnings
}: {
  parsedData: LogisticsInquiry;
  quote: TmsCreatedQuoteResult;
  tradeMining: TradeMiningCustomerIntelligenceResult;
  ltlRating?: LtlInquiryRatingResult;
  warnings: Array<string | null | undefined>;
}) {
  const quoteUrl = quote.quoteUrl ? `<a href="${escapeHtmlAttribute(quote.quoteUrl)}">${escapeHtml(quote.quoteUrl)}</a>` : "(not captured)";

  return [
    "<!doctype html>",
    "<html>",
    '<body style="font-family:Arial,sans-serif; font-size:11px; color:rgb(0,0,104); line-height:1.4; max-width:900px; margin:0 auto; padding:20px;">',

    '<h2 style="margin:0 0 16px;">Teamship File</h2>',

    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin-bottom:24px;">',
    "<tr>",
    '<td style="padding:4px 18px 4px 0; font-weight:bold;">Quote #</td>',
    `<td style="padding:4px 0;">${escapeHtml(quote.quoteNumber ?? "(not captured)")}</td>`,
    "</tr>",
    "<tr>",
    '<td style="padding:4px 18px 4px 0; font-weight:bold;">Teamship Link</td>',
    `<td style="padding:4px 0;">${quoteUrl}</td>`,
    "</tr>",
    "</table>",

    '<h3 style="margin:0 0 10px;">Inquiry Details</h3>',
    buildHtmlTable(ltlRating?.isLtl ? logisticsInquiryToLtlDisplayRows(parsedData, ltlRating) : logisticsInquiryToDisplayRows(parsedData)),

    ltlRating?.isLtl
      ? buildLtlRatingEmailSection(ltlRating)
      : buildTradeMiningEmailSection(tradeMining),

    warnings.length > 0
      ? [
          '<div style="margin-top:24px; padding-top:10px; border-top:1px solid #ddd; color:#777; font-size:11px;">',
          "<strong>Warnings</strong>",
          '<ul style="margin:5px 0 0; padding-left:18px;">',
          warnings
            .map(
              (warning) =>
                `<li>${escapeHtml(warning ?? "")}</li>`
            )
            .join(""),
          "</ul>",
          "</div>"
        ].join("")
      : "",

    "</body>",
    "</html>"
  ].join("\n");
}

function buildTradeMiningEmailSection(tradeMining: TradeMiningCustomerIntelligenceResult) {
  return [
    "<h3>TradeMining</h3>",
    buildHtmlTable([
      ["Customer searched", tradeMining.customerNameSearched ?? "(none)"],
      ["Customer type", tradeMining.customerType],
      ["TradeMining search field", tradeMining.searchField],
      ["Date range", `${tradeMining.dateRange.start} - ${tradeMining.dateRange.end}`]
    ])
  ].join("\n");
}

function buildLtlRatingEmailSection(result: LtlInquiryRatingResult) {
  if (result.status === "skipped") {
    return [
      "<h3>7L LTL Rating</h3>",
      "<p>7L was skipped because the current integration requires complete rating fields before calling 7L.</p>",
      buildHtmlTable([
        ["Missing required fields", result.adapter.missingRequiredFields.join(", ") || "(none)"],
        ["Adapter warnings", result.adapter.warnings.join("\n") || "(none)"],
        ["7L accessorials", formatLtlAccessorialsForEmail(result.adapter.request?.accessorialCodes)],
        ["Applied defaults", result.adapter.appliedDefaults.join(", ") || "(none)"]
      ])
    ].join("\n");
  }

  const estimatedClassNotice = buildLtlFreightClassEstimateNotice(result.adapter);

  if (result.status === "failed") {
    return [
      "<h3>7L LTL Rating</h3>",
      "<p>7L rating failed after the TMS quote was created.</p>",
      estimatedClassNotice,
      buildHtmlTable([
        ["7L account", result.accountName ?? "(none)"],
        ["Carriers requested", String(result.enabledCarrierCount)],
        ["7L accessorials", formatLtlAccessorialsForEmail(result.adapter.request?.accessorialCodes)],
        ["Safe error", result.warning]
      ])
    ].join("\n");
  }

  if (result.status === "quoted") {
    return [
      "<h3>7L LTL Rating</h3>",
      estimatedClassNotice,
      buildHtmlTable([
        ["7L accessorials", formatLtlAccessorialsForEmail(result.adapter.request?.accessorialCodes)],
        ["Successful carrier results", String(result.quotes.length)]
      
      ]),
      result.quotes.length > 0 ? "<h4>7L Results — Cheapest First</h4>" + buildLtlQuotesTable(result.quotes) : "<p>No successful 7L carrier results were returned.</p>",
      result.errors.length > 0 ? "<h4>Carrier Errors</h4>" + buildHtmlTable(result.errors.map((error) => [error.carrierName, error.errorMessage])) : ""
    ].join("\n");
  }

  return "";
}

function formatLtlAccessorialsForEmail(codes: string[] | undefined) {
  if (!codes || codes.length === 0) {
    return "(none)";
  }

  const labelsByCode = new Map(LTL_ACCESSORIAL_LEGEND.map((item) => [item.code, item.label]));
  return codes.map((code) => labelsByCode.get(code as (typeof LTL_ACCESSORIAL_LEGEND)[number]["code"]) ?? code).join(", ");
}

function buildLtlFreightClassEstimateNotice(adapter: NonNullable<LtlInquiryRatingResult["adapter"]>) {
  if (adapter.freightClassEstimates.length === 0) {
    return "";
  }

  return [
    "<p>Freight class was estimated from shipment density because no freight class was provided in the inquiry. The carrier may reclassify the shipment.</p>",
    buildHtmlTable(
      adapter.freightClassEstimates.map((estimate) => [
        estimate.fieldPrefix,
        `Density ${formatNumber(estimate.density)} lb/ft3; estimated class ${estimate.freightClass}`
      ])
    )
  ].join("\n");
}

function buildLtlQuotesTable(quotes: LtlInquiryRatingResult["quotes"]) {
  const sortedQuotes = [...quotes].sort((a, b) => {
    const aTotal = Number.isFinite(a.total) ? a.total : Number.POSITIVE_INFINITY;
    const bTotal = Number.isFinite(b.total) ? b.total : Number.POSITIVE_INFINITY;

    return aTotal - bTotal;
  });

  const rows = sortedQuotes.map((quote) => {
    const remarks = Array.isArray(quote.rateRemarks)
      ? quote.rateRemarks.filter(Boolean).join("; ")
      : "";

    const details = [
      quote.serviceLevel ? `<strong>Service:</strong> ${escapeHtml(quote.serviceLevel)}` : "",
      Number.isFinite(quote.transitDays)
        ? `<strong>Transit:</strong> ${escapeHtml(String(quote.transitDays))} days`
        : "",
      quote.quoteNumber
        ? `<strong>7L Quote:</strong> ${escapeHtml(quote.quoteNumber)}`
        : "",
      `<strong>Linehaul:</strong> ${escapeHtml(formatCurrency(quote.linehaulCharge))}`,
      `<strong>Fuel:</strong> ${escapeHtml(formatCurrency(quote.fuelCharge))}`,
      `<strong>Accessorials:</strong> ${escapeHtml(formatCurrency(quote.accessorialCharge))}`,
      remarks ? `<strong>Remarks:</strong> ${escapeHtml(remarks)}` : ""
    ]
      .filter(Boolean)
      .join("<br>");

    return [
      "<tr>",
      '<td style="padding:10px 12px; vertical-align:top; border-bottom:1px solid #dddddd;">',
      `<strong style="font-size:15px;">${escapeHtml(quote.carrierName || "(carrier not returned)")}</strong>`,
      "</td>",
      '<td style="padding:10px 12px; vertical-align:top; border-bottom:1px solid #dddddd;">',
      details,
      "</td>",
      '<td style="padding:10px 12px; vertical-align:top; text-align:right; white-space:nowrap; border-bottom:1px solid #dddddd;">',
      `<strong style="font-size:16px;">${escapeHtml(formatCurrency(quote.total))}</strong>`,
      "</td>",
      "</tr>"
    ].join("");
  });

  return [
    '<table cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse;">',
    "<thead>",
    "<tr>",
    '<th align="left" style="padding:8px 12px; border-bottom:2px solid #999999;">Carrier</th>',
    '<th align="left" style="padding:8px 12px; border-bottom:2px solid #999999;">Details</th>',
    '<th align="right" style="padding:8px 12px; border-bottom:2px solid #999999;">Total</th>',
    "</tr>",
    "</thead>",
    "<tbody>",
    ...rows,
    "</tbody>",
    "</table>"
  ].join("\n");
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatCurrency(value: number) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : "(not returned)";
}

function logisticsInquiryToDisplayRows(data: LogisticsInquiry): Array<[string, string]> {
  const origin = data.origin || data.originPostalCode;
  const destination = data.destination || data.destinationPostalCode;
  return [
    ["Customer", data.customer],
    ["Customer type", data.customertype],
    ["Mode", data.mode],
    ["Direction", data.direction],
    ["Shipment type", data.shipmentType],
    ["Origin", origin],
    ["Destination", destination],
    ["Incoterms", data.incoterms],
    ["Service", data.service],
    ["Urgency", data.urgency],
    ["Requested timing", data.requestedTiming],
    ["Container quantity", data.containerQuantity],
    ["Container size", data.containerSize],
    ["Equipment type", data.equipmentType],
    ["Container weight", data.containerWeight],
    ["Weight unit", data.weightUnit],
    ["Dimensions unit", data.dimensionsUnit],
    ["Floor loaded", data.floorLoaded ? "Yes" : "No"],
    ["Commodity", data.commodity],
    ["Insurance", data.insurance ? "Yes" : "No"],
    ["Customs", data.customs ? "Yes" : "No"],
    ["Dangerous goods", data.dangerousGoods ? "Yes" : "No"],
    ["Ready date", data.readyDate],
    ["Items", data.items.length > 0 ? data.items.map((item, index) => `#${index + 1}: qty ${item.quantity}, ${item.length} x ${item.width} x ${item.height}, weight ${item.weight}`).join("\n") : "(none)"]
  ];
}

function logisticsInquiryToLtlDisplayRows(data: LogisticsInquiry, ltlRating: LtlInquiryRatingResult): Array<[string, string]> {
  const origin = data.origin || data.originPostalCode;
  const destination = data.destination || data.destinationPostalCode;
  const accessorialNames =
    ltlRating.adapter.detectedAccessorials.length > 0
      ? formatLtlAccessorialsForEmail(ltlRating.adapter.detectedAccessorials.map((item) => item.code))
      : formatLtlAccessorialsForEmail(ltlRating.adapter.request?.accessorialCodes);

  return [
    ["Customer", data.customer],
    ["Shipment type", data.shipmentType],
    ["Origin", origin],
    ["Destination", destination],
    ["Items", formatLtlItemsForEmail(data.items)],
    ["Weight unit", data.weightUnit],
    ["Dimension unit", data.dimensionsUnit],
    ["Commodity", data.commodity],
    ["Dangerous goods", data.dangerousGoods ? "Yes" : "No"],
    ["Detected accessorials", accessorialNames],
    ["Insurance", data.insurance ? "Yes" : "No"],
    ["Customs", data.customs ? "Yes" : "No"]
  ];
}

function formatLtlItemsForEmail(items: LogisticsInquiry["items"]) {
  if (items.length === 0) {
    return "(none)";
  }

  return items
    .map((item, index) => {
      const quantity = readLtlItemQuantity(item);
      return `#${index + 1}: pieces ${quantity}, ${item.length} x ${item.width} x ${item.height}, weight ${item.weight}`;
    })
    .join("\n");
}

function readLtlItemQuantity(item: LogisticsInquiry["items"][number]) {
  const itemWithParsedAliases = item as LogisticsInquiry["items"][number] & {
    numberPieces?: string | number;
    number?: string | number;
  };
  return String(item.quantity || itemWithParsedAliases.numberPieces || itemWithParsedAliases.number || "(empty)");
}

function buildHtmlTable(rows: Array<[string, string]>) {
  return [
    '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;">',
    ...rows.map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value || "(empty)").replace(/\n/g, "<br>")}</td></tr>`),
    "</table>"
  ].join("\n");
}

type OutgoingEmailAttachment = {
  fileName: string;
  content: Buffer;
  contentType: string;
};

async function sendGmailSmtpMessage({
  to,
  subject,
  html,
  attachments
}: {
  to: string;
  subject: string;
  html: string;
  attachments: OutgoingEmailAttachment[];
}) {
  const from = getFirstEnvValue(["GMAIL_EMAIL", "OFFICE365_EMAIL"]);
  const password = getFirstEnvValue(["GMAIL_APP_PASSWORD", "GMAIL_PASSWORD", "OFFICE365_PASSWORD"]);
  const host = process.env.GMAIL_SMTP_HOST?.trim() || GMAIL_SMTP_HOST;
  const port = Number(process.env.GMAIL_SMTP_PORT || GMAIL_SMTP_PORT);
  const boundary = `newl-tms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const message = buildMimeMessage({
    from,
    to,
    subject,
    html,
    boundary,
    attachments
  });

  await sendSmtpData({
    host,
    port,
    username: from,
    password,
    from,
    to,
    message
  });
}

function buildMimeMessage({
  from,
  to,
  subject,
  html,
  boundary,
  attachments
}: {
  from: string;
  to: string;
  subject: string;
  html: string;
  boundary: string;
  attachments: OutgoingEmailAttachment[];
}) {
  const lines = [
    `From: ${formatEmailAddress(from)}`,
    `To: ${formatEmailAddress(to)}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(html)
  ];

  for (const attachment of attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${escapeMimeParameter(attachment.fileName)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${escapeMimeParameter(attachment.fileName)}"`,
      "",
      attachment.content.toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd()
    );
  }

  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

async function sendSmtpData({
  host,
  port,
  username,
  password,
  from,
  to,
  message
}: {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string;
  message: string;
}) {
  const socket = connectTls({ host, port, servername: host });
  socket.setEncoding("utf8");

  let buffer = "";
  const pendingReaders: Array<(line: string) => void> = [];

  socket.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const match = buffer.match(/^(\d{3})([\s-]).*\r?\n/m);
      if (!match) {
        break;
      }

      const lineEnd = buffer.indexOf("\n") + 1;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd);
      if (match[2] === " " && pendingReaders.length > 0) {
        pendingReaders.shift()?.(line);
      }
    }
  });

  function readResponse() {
    return new Promise<string>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off("error", onError);
        reject(error);
      };
      socket.once("error", onError);
      pendingReaders.push((line) => {
        socket.off("error", onError);
        resolve(line);
      });
    });
  }

  async function command(commandText: string, expectedPrefix: string) {
    socket.write(`${commandText}\r\n`);
    const response = await readResponse();
    if (!response.startsWith(expectedPrefix)) {
      throw new Error(`SMTP command failed. command=${commandText.split(" ")[0]} response=${response.trim()}`);
    }
  }

  try {
    const greeting = await readResponse();
    if (!greeting.startsWith("220")) {
      throw new Error(`SMTP greeting failed. response=${greeting.trim()}`);
    }

    await command(`EHLO ${getSmtpClientName()}`, "250");
    await command("AUTH LOGIN", "334");
    await command(Buffer.from(username).toString("base64"), "334");
    await command(Buffer.from(password).toString("base64"), "235");
    await command(`MAIL FROM:<${from}>`, "250");
    await command(`RCPT TO:<${to}>`, "250");
    await command("DATA", "354");
    socket.write(`${dotStuffSmtpMessage(message)}\r\n.\r\n`);
    const dataResponse = await readResponse();
    if (!dataResponse.startsWith("250")) {
      throw new Error(`SMTP DATA failed. response=${dataResponse.trim()}`);
    }
    await command("QUIT", "221");
  } finally {
    socket.end();
  }
}

function dotStuffSmtpMessage(message: string) {
  return message.replace(/^\./gm, "..");
}

function getSmtpClientName() {
  return "newl-apps.local";
}

function formatEmailAddress(email: string) {
  return `<${email}>`;
}

function encodeMimeHeader(value: string) {
  return /^[\x00-\x7F]*$/.test(value) ? value.replace(/\r|\n/g, " ") : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function escapeMimeParameter(value: string) {
  return value.replace(/["\\\r\n]/g, "_");
}

function encodeQuotedPrintable(value: string) {
  return Buffer.from(value)
    .toString("hex")
    .replace(/([0-9a-f]{2})/gi, "=$1")
    .replace(/(?:=0D)?=0A/g, "\r\n")
    .replace(/(.{1,72})(?==)/g, "$1=\r\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

export async function parseLogisticsInquiryWithGemini(emailBody: string): Promise<LogisticsInquiry> {
  const parsedData = JSON.parse(await parseEmailWithGemini(emailBody)) as ParsedEmailLogisticsData;
  await resolveParsedCustomerNameFromWebsite(parsedData, null);
  return normalizeLogisticsInquiry(parsedData);
}

export async function parseEmailWithGemini(emailBody: string): Promise<string> {
  const apiKey = requireEnvValue("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json"
    }
  });

  const result = await model.generateContent([
    [
      "You are a logistics operations agent for a freight forwarding company.",
      "Analyze messy freight inquiry emails like a forwarding coordinator would.",
      "Use the email body, quoted/replied text, sender name, sender email domain, signature block, company footer, and any attached-looking pasted text to infer the shipment request.",
      "Extract every data point needed to create a TMS quote.",
      "Return only a clean, parseable JSON string.",
      "Do not return markdown wrapper blocks such as ```json.",
      "Do not include comments, explanations, or extra text.",
      "Use empty strings for unknown string fields.",
      "Use false for unknown boolean fields.",
      "Use an empty array when no item dimensions are listed.",
      "The customer field must be the requesting customer, or company that is asking for the quote. Never return website url or domain name. Extract actual company name from the email text, signature, original forwarded sender email domain, or if not available then check proper details from sender's website",
      "For customer, never output a raw email address, website URL, hostname, or bare domain such as example.com.",
      "If the only customer clue is an email domain, convert the organization part into a readable company name by removing the user, protocol, www, path, and TLD. Example: logistics-example.com must become Logistics Example, not logistics-example.com.",
      "When the forwarded sender domain clearly points to one company but the email body contains multiple company names separated by slash, pipe, parenthesis, or DBA wording, prefer the company supported by the original sender domain.",
      "Do not use the email receiver, To recipient, Newl, Newl Express, Teamship, or an internal receiver name as customer.",
      "If the email contains a From signature/company, use that as customer only when no explicit customer/account is stated in the body.",
      "Populate customertype as either customer or agent only.",
      "Use customertype=customer when the company is requesting freight services for its own shipment or business.",
      "Use customertype=agent when an overseas or forwarding partner is arranging the shipment on behalf of another company.",
      "Classify customertype using the email content, forwarded headers, signature, wording, email domain, and country. Overseas forwarding/logistics companies outside Canada or the USA can be marked as agent when the wording supports that they are arranging for another party.",
      "Populate urgency from language like urgent, asap, today, rush, quote needed, deadline, standard, or normal. Use empty string if unknown.",
      "Populate requestedTiming with the exact requested timing phrase, due date, pickup date, cargo ready date, cut-off, delivery deadline, or quote deadline when present. Use empty string if unknown.",
      "Populate direction with import, export, domestic, cross-border, or unknown when stated or inferable. Use empty string if unknown.",
      "Normalize mode to the lowercase TMS selector key: air, ocean, ground, trucking, rail, drayage, warehousing, or the nearest available mode.",
      "Populate shipmentType with LCL or FCL for ocean shipments, LTL or FTL for trucking or ground shipments, or empty string when unknown or not applicable.",
      "For trucking or ground, identify LTL vs FTL, number of pieces, packaging type such as pieces, boxes, cartons, crates, skids, or pallets, and truck type such as 53' dry van, 48' flatbed, reefer, sprinter, straight truck, etc. Put LTL or FTL into shipmentType and truck type/equipment into equipmentType.",
      "For ocean, identify LCL vs FCL, container quantity, 20 or 40 container size, general purpose vs high cube, and map equipmentType to the closest TMS value such as HC - High Cube or GP - General Purpose. Put LCL or FCL into shipmentType.",
      "For air, identify chargeable/gross weight, pieces, dimensions, origin airport/city/address, destination airport/city/address, commodity, and readiness date.",
      "For drayage, identify port/rail ramp, pickup/delivery location, container size/type, weight, and ready date.",
      "For warehousing, identify storage/service request, commodity, pieces/pallets, location, dates, and special handling.",
      "For origin and destination only: preserve the full original location text from the email as received typically listed as origin, POL, shipper, consignee, POD, receiver, AOL, or AOD.",
      "Never truncate brief geographic indicators. If the email says 'POL: SHENGZHEN', origin must include 'SHENGZHEN' exactly, or map the full extracted value into origin.",
      "If the email says 'POD: TORONTO' or 'Destination: TORONTO', destination must include 'TORONTO' exactly, or map the full extracted value into destination.",
      "Do not drop short city, port, airport, rail ramp, or country names just because they are brief or uppercase.",
      "Do not shorten, normalize, clean, strip, summarize, or remove street addresses, suite numbers, postal codes, dock details, warehouse names, port names, ramp names, state/province, or country from origin or destination.",
      "If the email gives a full pickup or delivery address, put that full raw address in origin or destination.",
      "Extract commodity, number of pieces, packaging type, pallet/container rows, length, width, height, weight, and units.",
      "For LTL/trucking/ground inquiries, extract originPostalCode, originCountry, destinationPostalCode, destinationCountry, pickupDate, freightClass, NMFC, UN number, and accessorial wording when explicitly stated.",
      "Use originCountry and destinationCountry values US, CA, or MX only when stated or clearly inferable from the address/postal code. Use empty string otherwise.",
      "Put accessorial wording as customer-stated phrases in accessorials. Do not convert accessorial wording to 7L codes.",
      "For item piece count, use the item key quantity only. Do not output item keys named numberPieces, pieces, count, noOfPieces, or number.",
      "For each item, populate packagingType from stated terms like pallet, skid, carton, box, crate, drum, cylinder, bundle, container, or envelope.",
      "For each item, populate weightType as total when the weight is stated as total shipment weight or total line weight, each when the weight is clearly per piece, or empty string when unclear.",
      "For each item, populate freightClass, NMFC, and UN number only when stated for that item. If stated only once for the whole shipment, use the top-level freightClass, nmfc, or unNumber field.",
      "Normalize weightUnit to LBS or KG only. Normalize dimensionsUnit to INCH or CM only.",
      "Extract whether insurance is required. If explicitly declined or absent, use false.",
      "Extract whether customs clearance is required. If explicitly declined or absent, use false.",
      "Extract whether dangerous goods / hazmat / DG is involved. If explicitly declined or absent, use false.",
      "Extract readyDate as a clear date string from pickup date, cargo ready date, cut-off, or requested ship date.",
      "Normalize incoterms to a TMS value such as EXW when stated or inferable.",
      "Normalize service to a TMS value such as port_to_port when stated or inferable.",
      "For containers, map the first container count/size/equipment/weight into containerQuantity, containerSize, equipmentType, and containerWeight.",
      "For loose cargo or pallets, map pallet/carton rows into items.",
      "Always include customertype, direction, shipmentType, urgency, requestedTiming, originPostalCode, originCountry, destinationPostalCode, destinationCountry, pickupDate, freightClass, nmfc, unNumber, and accessorials in the returned JSON object.",
      "The JSON object must use exactly these keys:",
      JSON.stringify(emptyParsedEmailLogisticsData()),
      "",
      "Email body:",
      emailBody
    ].join("\n")
  ]);

  return stripJsonFence(result.response.text());
}

export async function runTmsAutomationTestAction(_rawEmailInquiry?: string): Promise<TmsAutomationResult> {
  void _rawEmailInquiry;

  try {
    const emailText = await fetchLatestTmsEmail();
    return {
      ok: true,
      tmsFileNumber: emailText ? "Email fetched" : "No email found",
      message: emailText
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not fetch the latest TMS email."
    };
  }
}

async function completeQuoteFormForMode(page: Page, data: LogisticsInquiry): Promise<void> {
  const mode = getTmsModeSelectorKey(data.mode);

  if (mode === "ocean") {
    await completeOceanQuoteForm(page, data);
    return;
  }

  if (mode === "air") {
    await completeAirQuoteForm(page, data);
    return;
  }

  if (mode === "trucking") {
    await completeTruckingQuoteForm(page, data);
    return;
  }

  if (mode === "dryage") {
    await completeDrayageQuoteForm(page, data);
    return;
  }

  if (mode === "warehouse") {
    await completeWarehouseQuoteForm(page, data);
    return;
  }

  console.log(`[tms-automation] No mode-specific automation configured for mode="${data.mode}". Skipping detail fields.`);
}

async function completeOceanQuoteForm(page: Page, data: LogisticsInquiry): Promise<void> {
  await typeRawLocationAndTab(page, {
    rootSelector: '[data-test-id="quotes_create_ocean_origin_id_0"]',
    value: data.origin,
    label: "origin"
  });

  await typeRawLocationAndTab(page, {
    rootSelector: '[data-test-id="quotes_create_ocean_destination_id_0"]',
    value: data.destination,
    label: "destination"
  });

  await selectShipmentDirection(page, "quotes_create_ocean_shipment_type", data.direction);
  await selectOceanShipmentType(page, data.shipmentType);
  await selectDropdownFromParsedValue(page.locator('[data-test-id="quotes_create_ocean_incoterms_id"]'), data.incoterms);
  await selectDropdownFromParsedValue(page.locator('[data-test-id="quotes_create_ocean_service_id"]'), data.service);
  await fillIfVisible(page.locator('[data-test-id="containerQuantity_id_0"]'), data.containerQuantity);
  await selectDropdownFromParsedValue(page.locator('[data-test-id="containerSize_id_0"]'), data.containerSize);
  await selectDropdownFromParsedValue(page.locator("#equipmentType-0"), data.equipmentType);
  await fillIfVisible(page.locator('[data-test-id="containerWeight_id_0"]'), data.containerWeight);
  await selectOceanContainerWeightUnit(page, data.weightUnit);

  if (data.floorLoaded) {
    await clickIfVisible(page.getByText("Floor Loaded"));
  }

  await fillIfVisible(page.locator('[data-test-id="quotes_create_ocean_container_commodity_id_0"]'), data.commodity);
  await selectOceanPalletUnits(page, data);

  for (const [index, item] of data.items.entries()) {
    if (index > 0) {
      await clickIfVisible(page.getByText("+ Add Another Pallet Size"));
    }

    await fillIfVisible(page.locator(`[data-test-id="quantity_id_0_${index}"]`), item.quantity);
    await fillIfVisible(page.locator(`[data-test-id="length_id_0_${index}"]`), item.length);
    await fillIfVisible(page.locator(`[data-test-id="width_id_0_${index}"]`), item.width);
    await fillIfVisible(page.locator(`[data-test-id="height_id_0_${index}"]`), item.height);
    await fillIfVisible(page.locator(`[data-test-id="weight_id_0_${index}"]`), item.weight);
  }

  await clickYesNoIfExists(page, "quotes_create_ocean_insurance", data.insurance);
  await clickYesNoIfExists(page, "quotes_create_ocean_custom", data.customs);
  await clickDangerousGoodsYesNo(page, "quotes_create_ocean_dangerousGood", data.dangerousGoods);
  await fillReadyDateIfVisible(page, data.readyDate);
}

async function completeAirQuoteForm(page: Page, data: LogisticsInquiry): Promise<void> {
  await typeRawLocationAndTab(page, {
    rootSelector: '[data-test-id="quotes_create_air_origin_id_0"]',
    value: data.origin,
    label: "origin"
  });

  await typeRawLocationAndTab(page, {
    rootSelector: '[data-test-id="quotes_create_air_destination_id_0"]',
    value: data.destination,
    label: "destination"
  });

  await selectShipmentDirection(page, "quotes_create_air_shipment_type", data.direction);
  await fillIfVisible(page.locator('[data-test-id="quotes_create_air_commodity_id"]'), data.commodity);
  await selectDropdownFromParsedValue(page.locator('[data-test-id="quotes_create_air_incoterms_id"]'), data.incoterms);
  await selectDropdownFromParsedValue(page.locator('[data-test-id="quotes_create_air_service_id"]'), data.service);
  await selectAirPalletUnits(page, data);
  await fillAirPalletRows(page, data);
  await clickYesNoIfExists(page, "quotes_create_air_insurance", data.insurance);
  await clickYesNoIfExists(page, "quotes_create_air_custom", data.customs);
  await clickDangerousGoodsYesNo(page, "quotes_create_air_dangerousGood", data.dangerousGoods);
  await fillReadyDateIfVisible(page, data.readyDate);
}

async function completeTruckingQuoteForm(page: Page, data: LogisticsInquiry): Promise<void> {
  await typeRawLocationAndTab(page, {
    rootSelector: '[data-test-id="quotes_create_origin_id_0"]',
    value: data.origin || data.originPostalCode,
    label: "origin"
  });

  await typeRawLocationAndTab(page, {
    rootSelector: '[data-test-id="quotes_create_destination_id_0"]',
    value: data.destination || data.destinationPostalCode,
    label: "destination"
  });

  await fillIfVisible(page.locator('[data-test-id="quotes_create_commodity_id"]'), data.commodity);
  await selectTruckingShipmentType(page, data.shipmentType);
  await selectDropdownFromParsedValue(page.locator('[data-test-id="quotes_create_truckType_id"]'), data.equipmentType);
  await selectTruckingUnits(page, data);

  for (const [index, item] of data.items.entries()) {
    if (index > 0) {
      await clickIfVisible(page.locator('[data-test-id="quotes_create_addPallet_id"]'));
    }

    await fillIfVisible(page.locator(`[data-test-id="quotes_create_noOfPallets_id_${index}"]`), item.quantity);
    await fillIfVisible(page.locator(`[data-test-id="quotes_create_length_id_${index}"]`), item.length);
    await fillIfVisible(page.locator(`[data-test-id="quotes_create_width_id_${index}"]`), item.width);
    await fillIfVisible(page.locator(`[data-test-id="quotes_create_height_id_${index}"]`), item.height);
    await fillIfVisible(page.locator(`[data-test-id="quotes_create_weight_id_${index}"]`), item.weight);
  }

  await clickYesNoIfExists(page, "quotes_create_insurance", data.insurance);
  await clickYesNoIfExists(page, "quotes_create_custom", data.customs);
  await clickDangerousGoodsYesNo(page, "quotes_create_dangerousGood", data.dangerousGoods);
  await fillReadyDateIfVisible(page, data.readyDate);
}

async function completeDrayageQuoteForm(page: Page, data: LogisticsInquiry): Promise<void> {
  await fillIfVisible(page.locator("#commodities"), data.commodity);
  await selectDropdownFromParsedValue(page.locator("#equipmentSize"), data.containerSize);
  await selectDropdownFromParsedValue(page.locator("#equipmentType"), data.equipmentType);
  await fillIfVisible(page.locator('input[placeholder="Weight"]').first(), data.containerWeight);
  await selectDrayageWeightUnit(page, data.weightUnit);
}

async function completeWarehouseQuoteForm(page: Page, data: LogisticsInquiry): Promise<void> {
  await fillIfVisible(page.locator("#commodities"), data.commodity);

  if (data.containerQuantity || data.containerSize || data.equipmentType) {
    await clickRadioIfExists(page.locator("#inventoryReceiveByContainer"));
    return;
  }

  if (data.items.length > 0) {
    await clickRadioIfExists(page.locator("#outboundShipmentByPallet"));
  }
}

async function fillAirPalletRows(page: Page, data: LogisticsInquiry): Promise<void> {
  for (const [index, item] of data.items.entries()) {
    if (index > 0) {
      await clickIfVisible(page.locator('[data-test-id="add_pallet_air_id"]'));
    }

    await fillIfVisible(page.locator(`[data-test-id="palletQuantity_id_${index}"]`), item.quantity);
    await fillIfVisible(page.locator(`[data-test-id="palletLength_id_${index}"]`), item.length);
    await fillIfVisible(page.locator(`[data-test-id="palletWidth_id_${index}"]`), item.width);
    await fillIfVisible(page.locator(`[data-test-id="palletHeight_id_${index}"]`), item.height);
    await fillIfVisible(page.locator(`[data-test-id="palletWeight_id_${index}"]`), item.weight);
  }
}

async function clickYesNoIfExists(page: Page, testIdPrefix: string, value: boolean): Promise<void> {
  await clickRadioIfExists(page.locator(`[data-test-id="${testIdPrefix}${value ? "Yes" : "No"}_id"]`));
}

async function clickDangerousGoodsYesNo(page: Page, testIdPrefix: string, value: boolean): Promise<void> {
  await clickRadioIfExists(page.locator(`[data-test-id="${testIdPrefix}${value ? "Yes" : "No"}_id"]`));
}

async function clickRadioIfExists(option: Locator): Promise<void> {
  if (!(await option.count())) {
    return;
  }

  await option.waitFor({ state: "attached" });

  const radioState = await option.evaluate((element) => {
    const input = element instanceof HTMLInputElement ? element : element.querySelector("input");
    if (!input) {
      return {
        inputId: "",
        inputType: "",
        isChecked: false,
        isVisible: false
      };
    }

    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return {
      inputId: input.id,
      inputType: input.type,
      isChecked: input.checked,
      isVisible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
    };
  });

  if (radioState.isChecked) {
    return;
  }

  if (radioState.isVisible) {
    await option.click();
  } else {
    await option.evaluate((element) => {
      const input = element instanceof HTMLInputElement ? element : element.querySelector("input");
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      const explicitLabel = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      const clickable = explicitLabel ?? input.closest("label") ?? input.parentElement;
      if (clickable instanceof HTMLElement) {
        clickable.click();
      }
    });
  }

  const isCheckedAfterClick = await option.evaluate((element) => {
    const input = element instanceof HTMLInputElement ? element : element.querySelector("input");
    return input instanceof HTMLInputElement ? input.checked : false;
  });

  if (!isCheckedAfterClick && radioState.inputType === "radio") {
    await option.evaluate((element) => {
      const input = element instanceof HTMLInputElement ? element : element.querySelector("input");
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      input.checked = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const isChecked = await option.evaluate((element) => {
    const input = element instanceof HTMLInputElement ? element : element.querySelector("input");
    return input instanceof HTMLInputElement ? input.checked : false;
  });

  if (!isChecked) {
    throw new Error("Radio option did not become checked.");
  }
}

async function selectShipmentDirection(page: Page, testIdPrefix: string, direction: string): Promise<void> {
  const normalizedDirection = direction.trim().toLowerCase();
  if (normalizedDirection !== "import" && normalizedDirection !== "export") {
    return;
  }

  const option = page.locator(`[data-test-id="${testIdPrefix}_${normalizedDirection}_id"]`);
  if (!(await option.count())) {
    const screenshotPath = await saveTmsDiagnosticScreenshot(page, `${testIdPrefix}-${normalizedDirection}-missing`);
    throw new Error(`TMS ${testIdPrefix} ${normalizedDirection} option was not found. screenshot=${screenshotPath}`);
  }

  await clickRadioIfExists(option);
  const selected = await option.evaluate((element) => {
    const input = element instanceof HTMLInputElement ? element : element.querySelector("input");
    return input instanceof HTMLInputElement ? input.checked : false;
  });

  if (!selected) {
    const screenshotPath = await saveTmsDiagnosticScreenshot(page, `${testIdPrefix}-${normalizedDirection}-not-selected`);
    throw new Error(`TMS ${testIdPrefix} ${normalizedDirection} option did not become selected. screenshot=${screenshotPath}`);
  }
}

async function selectOceanShipmentType(page: Page, shipmentType: string): Promise<void> {
  const normalizedShipmentType = shipmentType.trim().toLowerCase();
  if (normalizedShipmentType === "lcl" || normalizedShipmentType === "fcl") {
    await clickRadioIfExists(page.locator(`[data-test-id="quotes_create_ocean_service_${normalizedShipmentType}_id"]`));
  }
}

async function selectTruckingShipmentType(page: Page, shipmentType: string): Promise<void> {
  const normalizedShipmentType = shipmentType.trim().toLowerCase();
  if (normalizedShipmentType === "ltl" || normalizedShipmentType === "ftl") {
    await clickRadioIfExists(page.locator(`[data-test-id="quotes_create_${normalizedShipmentType}_id"]`));
  }
}

async function selectTruckingUnits(page: Page, data: LogisticsInquiry): Promise<void> {
  if (data.dimensionsUnit === "INCH") {
    await clickRadioIfExists(page.locator('[data-test-id="quotes_create_inchUnit_id"]'));
  }

  if (data.dimensionsUnit === "CM") {
    await clickRadioIfExists(page.locator('[data-test-id="quotes_create_cmUnit_id"]'));
  }

  if (data.weightUnit === "LBS") {
    await clickRadioIfExists(page.locator('[data-test-id="quotes_create_palletLbsUnit_id"]'));
  }

  if (data.weightUnit === "KG") {
    await clickRadioIfExists(page.locator('[data-test-id="quotes_create_palletKgUnit_id"]'));
  }
}

async function selectOceanContainerWeightUnit(page: Page, weightUnit: LogisticsInquiry["weightUnit"]): Promise<void> {
  if (weightUnit === "LBS") {
    await clickRadioIfExists(page.locator('[data-test-id="conWeightUnitLBS_id_0"]'));
  }

  if (weightUnit === "KG") {
    await clickRadioIfExists(page.locator('[data-test-id="conWeightUnitKG_id_0"]'));
  }
}

async function selectOceanPalletUnits(page: Page, data: LogisticsInquiry): Promise<void> {
  if (data.dimensionsUnit === "INCH") {
    await clickRadioIfExists(page.locator('[data-test-id="palletinch_id_0"]'));
  }

  if (data.dimensionsUnit === "CM") {
    await clickRadioIfExists(page.locator('[data-test-id="palletcm_id_0"]'));
  }

  if (data.weightUnit === "LBS") {
    await clickRadioIfExists(page.locator('[data-test-id="palletLBS_id_0"]'));
  }

  if (data.weightUnit === "KG") {
    await clickRadioIfExists(page.locator('[data-test-id="palletKG_id_0"]'));
  }
}

async function selectAirPalletUnits(page: Page, data: LogisticsInquiry): Promise<void> {
  if (data.dimensionsUnit === "INCH") {
    await clickRadioIfExists(page.locator('[data-test-id="palletinch_air_id"]'));
  }

  if (data.dimensionsUnit === "CM") {
    await clickRadioIfExists(page.locator('[data-test-id="palletcm_air_id"]'));
  }

  if (data.weightUnit === "LBS") {
    await clickRadioIfExists(page.locator('[data-test-id="palletLBS_air_id"]'));
  }

  if (data.weightUnit === "KG") {
    await clickRadioIfExists(page.locator('[data-test-id="palletKG_air_id"]'));
  }
}

async function selectDrayageWeightUnit(page: Page, weightUnit: LogisticsInquiry["weightUnit"]): Promise<void> {
  if (weightUnit === "LBS") {
    await clickRadioIfExists(page.locator("#container_weight_unit_lbs"));
  }

  if (weightUnit === "KG") {
    await clickRadioIfExists(page.locator("#container_weight_unit_kg"));
  }
}

async function fillIfVisible(locator: Locator, value: string): Promise<void> {
  if (!value || !(await locator.count())) {
    return;
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 2500 });
    await locator.fill(value);
  } catch {
    // Field is not available for the selected TMS mode.
  }
}

async function clickIfVisible(locator: Locator): Promise<void> {
  if (!(await locator.count())) {
    return;
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 2500 });
    await locator.click();
  } catch {
    // Field is not available for the selected TMS mode.
  }
}

async function fillReadyDateIfVisible(page: Page, readyDate: string): Promise<void> {
  if (!readyDate) {
    return;
  }

  await fillIfVisible(page.getByRole("textbox", { name: "MM/DD/YYYY" }), formatReadyDate(readyDate));
}

function getTmsModeSelectorKey(mode: string): string {
  const normalizedMode = mode.trim().toLowerCase();
  if (normalizedMode === "drayage") {
    return "dryage";
  }

  if (normalizedMode === "warehousing") {
    return "warehouse";
  }

  if (normalizedMode === "ground") {
    return "trucking";
  }

  return normalizedMode;
}

async function selectQuoteTypeOptions(page: Page, data: LogisticsInquiry): Promise<void> {
  const mode = getTmsModeSelectorKey(data.mode);
  const shipmentType = data.shipmentType?.trim().toUpperCase() ?? "";
  const direction = data.direction?.trim().toLowerCase() ?? "";

  if (mode === "ocean" && ["LCL", "FCL"].includes(shipmentType)) {
    await clickVisibleTextIfPresent(page, shipmentType);
  }

  if (mode === "trucking" && ["LTL", "FTL"].includes(shipmentType)) {
    await clickVisibleTextIfPresent(page, shipmentType);
  }

  if (direction === "import") {
    await clickVisibleTextIfPresent(page, "Import");
  }

  if (direction === "export") {
    await clickVisibleTextIfPresent(page, "Export");
  }
}

async function clickVisibleTextIfPresent(page: Page, text: string): Promise<void> {
  const target = page.getByText(text, { exact: true }).first();
  try {
    await target.waitFor({ state: "visible", timeout: 2500 });
    await target.click();
    console.log(`[tms-automation] Selected visible quote option "${text}".`);
  } catch {
    console.log(`[tms-automation] Quote option "${text}" was not visible. Continuing without selecting it.`);
  }
}

async function selectDropdownFromParsedValue(dropdown: Locator, parsedValue: unknown): Promise<void> {
  const normalizedValue = normalizeDropdownCandidate(parsedValue);
  const comparableValue = normalizeDropdownComparable(normalizedValue);
  if (!normalizedValue) {
    return;
  }

  if (!(await dropdown.count())) {
    return;
  }

  try {
    await dropdown.waitFor({ state: "visible", timeout: 2500 });
  } catch {
    return;
  }

  const options = await dropdown.locator("option").evaluateAll((optionElements) =>
    optionElements.map((optionElement) => {
      const option = optionElement as HTMLOptionElement;
      return {
        value: option.value,
        text: option.textContent ?? ""
      };
    })
  );

  function setNativeSelectValue(value: string): Promise<void> {
    return dropdown.evaluate((selectElement, nextValue) => {
      const select = selectElement as HTMLSelectElement;
      select.value = nextValue;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }

  function normalizeDropdownComparable(value: string): string {
    return value
      .trim()
      .replace(/[–—]/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .toLowerCase();
  }

  const valueMatch = options.find((option) => normalizeDropdownComparable(option.value) === comparableValue);
  if (valueMatch) {
    await setNativeSelectValue(valueMatch.value);
    return;
  }

  const textMatch = options.find((option) => normalizeDropdownComparable(option.text) === comparableValue);
  if (textMatch) {
    await setNativeSelectValue(textMatch.value);
    return;
  }

  const partialTextMatches = options.filter((option) => normalizeDropdownComparable(option.text).includes(comparableValue));
  if (partialTextMatches.length === 1) {
    const [partialTextMatch] = partialTextMatches;
    await setNativeSelectValue(partialTextMatch.value);
    return;
  }

}

function normalizeDropdownCandidate(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

async function selectDynamicDropdownOption(
  page: Page,
  {
    rootSelector,
    inputRole,
    value,
    label,
    addLeadWhenNoMatch = false
  }: {
    rootSelector: string;
    inputRole: "textbox" | "combobox";
    value: string;
    label: string;
    addLeadWhenNoMatch?: boolean;
  }
): Promise<void> {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error(`Cannot select ${label}; parsed value is empty.`);
  }

  const root = page.locator(rootSelector);
  await root.waitFor({ state: "visible" });
  await root.click();

  const input =
    inputRole === "textbox"
      ? root.getByRole("textbox", { name: "Select option" })
      : root.getByRole("combobox", { name: "Select option" });

  await input.waitFor({ state: "visible" });
  await input.fill(trimmedValue);
  await clickVisibleDropdownOption(page, root, trimmedValue, { addLeadWhenNoMatch });
}

async function typeRawLocationAndTab(
  page: Page,
  {
    rootSelector,
    value,
    label
  }: {
    rootSelector: string;
    value: string;
    label: string;
  }
): Promise<void> {
  const rawLocation = value ?? "";
  const input = page.locator(`${rootSelector} input`).first();
  console.log(`[tms-automation] Filling ${label} with raw parsed location="${rawLocation}"`);
  await input.waitFor({ state: "visible" });
  await input.focus();
  await page.keyboard.type(rawLocation);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
}

async function clickVisibleDropdownOption(
  page: Page,
  root: Locator,
  value: string,
  { addLeadWhenNoMatch = false }: { addLeadWhenNoMatch?: boolean } = {}
): Promise<void> {
  const optionText = flexibleOptionMatcher(value);
  const candidates = addLeadWhenNoMatch
    ? [
        page.getByRole("option", { name: optionText }).first(),
        page.locator('[role="listbox"]').getByText(optionText).first(),
        page.locator('[class*="menu"], [class*="Menu"], [class*="option"], [class*="Option"]').getByText(optionText).first()
      ]
    : [
        page.getByRole("option", { name: optionText }).first(),
        page.locator('[role="listbox"]').getByText(optionText).first(),
        page.locator('[class*="menu"], [class*="Menu"], [class*="option"], [class*="Option"]').getByText(optionText).first(),
        root.getByText(optionText).first(),
        page.getByText(optionText).first()
      ];

  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: "visible", timeout: 2500 });
      await candidate.click();
      if (addLeadWhenNoMatch) {
        const customerAccepted = await waitForCustomerLookupAccepted(page, root, value);
        if (!customerAccepted.ok) {
          const screenshotPath = await saveTmsDiagnosticScreenshot(page, "customer-match-not-accepted");
          throw new Error(
            `Customer match click did not confirm an accepted customer value. reason=${customerAccepted.reason}. validation=${customerAccepted.validationMessage || "(none)"}. screenshot=${screenshotPath}`
          );
        }
        console.log("[tms-automation] Customer match found and selected");
      }
      return;
    } catch {
      // Try the next common dropdown rendering pattern.
    }
  }

  if (addLeadWhenNoMatch) {
    await selectVisibleAddLeadOption(page, root, value);
    return;
  }

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

async function selectVisibleAddLeadOption(page: Page, customerLookupRoot: Locator, customerName: string): Promise<void> {
  const addLeadButton = page.locator('[data-test-id="quotes_create_addLead_id"]').first();
  const addLeadCount = await page.locator('[data-test-id="quotes_create_addLead_id"]').count();
  console.log(`[tms-automation] Add a Lead exists count=${addLeadCount}`);

  try {
    await addLeadButton.waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    const activeDropdownHtml = await readVisibleCustomerDropdownHtml(page, customerLookupRoot);
    const screenshotPath = await saveTmsDiagnosticScreenshot(page, "add-lead-not-visible");
    throw new Error(
      `Add a Lead selection failed: stable Add a Lead button was not visible after customer search. screenshot=${screenshotPath}. activeDropdown=${activeDropdownHtml || "(not found)"}. ${error instanceof Error ? error.message : ""}`
    );
  }

  console.log("[tms-automation] No customer match; Add a Lead visible");

  const isEnabled = await addLeadButton.isEnabled().catch(() => false);
  console.log(`[tms-automation] Add a Lead enabled=${isEnabled}`);
  if (!isEnabled) {
    const screenshotPath = await saveTmsDiagnosticScreenshot(page, "add-lead-disabled");
    throw new Error(`Add a Lead selection failed: stable Add a Lead button was visible but disabled. screenshot=${screenshotPath}`);
  }

  try {
    await addLeadButton.scrollIntoViewIfNeeded();
    console.log("[tms-automation] Add a Lead click attempted");
    await addLeadButton.click();
  } catch (error) {
    const screenshotPath = await saveTmsDiagnosticScreenshot(page, "add-lead-click-failed");
    throw new Error(`Add a Lead selection failed: click did not succeed. screenshot=${screenshotPath}. ${error instanceof Error ? error.message : "Unknown click error."}`);
  }

  await addLeadButton.waitFor({ state: "hidden", timeout: 5000 }).catch(async () => {
    const activeDropdownHtml = await readVisibleCustomerDropdownHtml(page, customerLookupRoot);
    const screenshotPath = await saveTmsDiagnosticScreenshot(page, "add-lead-still-visible");
    throw new Error(`Add a Lead selection failed: click was attempted, but the Add a Lead button stayed visible. screenshot=${screenshotPath}. activeDropdown=${activeDropdownHtml || "(not found)"}`);
  });

  const customerAccepted = await waitForCustomerLookupAccepted(page, customerLookupRoot, customerName);
  if (!customerAccepted.ok) {
    const screenshotPath = await saveTmsDiagnosticScreenshot(page, "add-lead-not-accepted");
    const pageState = await readTmsVisiblePageState(page);
    throw new Error(
      `Add a Lead selection failed: TMS did not confirm an accepted customer/lead after click. reason=${customerAccepted.reason}. validation=${customerAccepted.validationMessage || "(none)"}. leadFormAppeared=${pageState.leadFormAppeared}. requiredEmptyFields=${pageState.requiredEmptyFields || "(none)"}. visiblePageState="${pageState.visibleText}". screenshot=${screenshotPath}`
    );
  }

  console.log("[tms-automation] Add a Lead selected successfully");
}

async function waitForCustomerLookupAccepted(page: Page, customerLookupRoot: Locator, customerName: string) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const state = await readCustomerLookupState(page, customerLookupRoot, customerName);
    if (state.ok) {
      return state;
    }
    await page.waitForTimeout(300);
  }

  return readCustomerLookupState(page, customerLookupRoot, customerName);
}

async function readCustomerLookupState(page: Page, customerLookupRoot: Locator, customerName: string): Promise<{ ok: boolean; reason: string; validationMessage: string }> {
  const state = await customerLookupRoot.evaluate((element, expectedCustomer) => {
    const rootText = element.textContent ?? "";
    const inputs = [...element.querySelectorAll("input")].map((input) => ({
      value: input.value,
      ariaInvalid: input.getAttribute("aria-invalid"),
      required: input.required
    }));
    const expected = String(expectedCustomer).trim().toLowerCase();
    const hasAcceptedText = expected.length > 0 && rootText.toLowerCase().includes(expected);
    const hasInputValue = inputs.some((input) => input.value.trim().toLowerCase() === expected);
    const hasInvalidInput = inputs.some((input) => input.ariaInvalid === "true");
    const requiredEmpty = inputs.some((input) => input.required && !input.value.trim());

    return {
      rootText,
      inputs,
      hasAcceptedText,
      hasInputValue,
      hasInvalidInput,
      requiredEmpty
    };
  }, customerName);

  const validationMessage = await readVisibleTmsValidationMessage(page);
  if (state.hasAcceptedText || state.hasInputValue) {
    return {
      ok: true,
      reason: "customer lookup contains accepted customer/lead value",
      validationMessage
    };
  }

  return {
    ok: false,
    reason: `customer lookup did not contain accepted customer/lead value. rootText="${state.rootText.trim().slice(0, 200)}" inputs=${JSON.stringify(state.inputs)}`,
    validationMessage
  };
}

async function readVisibleTmsValidationMessage(page: Page): Promise<string> {
  const candidates = page.locator('[class*="error"], [class*="invalid"], [role="alert"], .text-danger, .invalid-feedback');
  const messages = await candidates.evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 5)
  );

  return messages.join(" | ");
}

async function readTmsVisiblePageState(page: Page): Promise<{ visibleText: string; leadFormAppeared: boolean; requiredEmptyFields: string }> {
  return page.evaluate(() => {
    const visibleText = (document.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
    const visibleInputs = [...document.querySelectorAll("input, textarea, select")]
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const label =
          input.getAttribute("aria-label") ||
          input.getAttribute("placeholder") ||
          input.getAttribute("name") ||
          input.id ||
          "unnamed field";
        return {
          label,
          required: input.required || input.getAttribute("aria-required") === "true",
          value: "value" in input ? input.value : ""
        };
      });

    return {
      visibleText,
      leadFormAppeared: /add\s+a\s+lead|lead/i.test(visibleText),
      requiredEmptyFields: visibleInputs
        .filter((input) => input.required && !input.value.trim())
        .map((input) => input.label)
        .join(", ")
    };
  });
}

async function saveTmsDiagnosticScreenshot(page: Page, reason: string): Promise<string> {
  await mkdir(TMS_DIAGNOSTIC_DIR, { recursive: true });
  const filePath = path.join(TMS_DIAGNOSTIC_DIR, `${Date.now()}-${reason}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function readVisibleCustomerDropdownHtml(page: Page, customerLookupRoot: Locator): Promise<string> {
  const handles = [
    page.locator('[data-test-id="quotes_create_addLead_id"]').first(),
    page.locator('[role="listbox"]').first(),
    customerLookupRoot
  ];

  for (const handle of handles) {
    try {
      if (await handle.isVisible()) {
        return (await handle.evaluate((element) => element.outerHTML)).slice(0, 500);
      }
    } catch {
      // Try the next visible dropdown candidate.
    }
  }

  return "";
}

function flexibleOptionMatcher(value: string): RegExp {
  const words = value
    .trim()
    .split(/\s+/)
    .map((word) => escapeRegExp(word))
    .filter(Boolean);

  return new RegExp(words.join(".*"), "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatReadyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${month}/${day}/${year}`;
}

function createGmailClient(): ImapFlow {
  const email = getFirstEnvValue(["GMAIL_EMAIL", "OFFICE365_EMAIL"]);
  const password = getFirstEnvValue(["GMAIL_APP_PASSWORD", "GMAIL_PASSWORD", "OFFICE365_PASSWORD"]);

  return new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST?.trim() || GMAIL_IMAP_HOST,
    port: Number(process.env.GMAIL_IMAP_PORT || GMAIL_IMAP_PORT),
    secure: true,
    disableAutoIdle: true,
    maxIdleTime: GMAIL_IDLE_REFRESH_MS,
    auth: {
      user: email,
      pass: password
    },
    logger: false
  });
}

function getTargetFolder(): string {
  const folder = getFirstEnvValue(["GMAIL_TARGET_FOLDER", "OFFICE365_TARGET_FOLDER"]);
  return folder.trim().toLowerCase() === "inbox" ? "INBOX" : folder;
}

async function searchUnreadUids(client: ImapFlow): Promise<number[]> {
  const result = await client.search({ seen: false }, { uid: true });
  return Array.isArray(result) ? result : [];
}

async function fetchMessagePayloadByUid(client: ImapFlow, uid: number): Promise<GmailMessagePayload | null> {
  const message = await client.fetchOne(
    String(uid),
    {
      envelope: true,
      bodyParts: ["TEXT"],
      source: true
    },
    {
      uid: true
    }
  );

  return extractPayloadFromFetchedMessage(message);
}

async function markMessageSeenByUid(client: ImapFlow, uid: number): Promise<void> {
  const marked = await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
  console.log(`[gmail-listener] Marked UID ${uid} as read. success=${String(marked)}`);
}

async function markFetchedEmailSeen(client: ImapFlow, uid: number): Promise<void> {
  console.log(`[gmail-listener] Marking fetched Gmail UID ${uid} as SEEN before Gemini/Playwright.`);
  await markMessageSeenByUid(client, uid);
}

async function fetchMessagePayloadBySequence(
  client: ImapFlow,
  sequence: number
): Promise<GmailMessagePayload | null> {
  const message = await client.fetchOne(String(sequence), {
    uid: true,
    envelope: true,
    bodyParts: ["TEXT"],
    source: true
  });

  return extractPayloadFromFetchedMessage(message);
}

function extractPayloadFromFetchedMessage(message: Awaited<ReturnType<ImapFlow["fetchOne"]>>): GmailMessagePayload | null {
  if (!message || !message.uid) {
    return null;
  }

  const emailText = extractTextFromFetchedMessage(message);
  return emailText
    ? {
        uid: message.uid,
        subject: message.envelope?.subject ?? "",
        emailText,
        forwardingSenderDomain: extractSenderDomainFromFetchedMessage(message)
      }
    : null;
}

function extractSenderDomainFromFetchedMessage(message: Awaited<ReturnType<ImapFlow["fetchOne"]>>): string | null {
  if (!message) {
    return null;
  }

  const from = message.envelope?.from?.[0] as ({ address?: string; mailbox?: string; host?: string } | undefined);
  const fromAddress = from?.address ?? (from?.mailbox && from.host ? `${from.mailbox}@${from.host}` : null);
  if (!fromAddress) {
    return null;
  }

  const match = String(fromAddress).match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractOriginalSenderInfo(emailText: string, forwardingSenderDomain: string | null): OriginalSenderInfo {
  for (const forwardedFrom of extractForwardedFromLines(emailText)) {
    const parsed = parseSenderLine(forwardedFrom);
    if (parsed.domain && !isNewlDomain(parsed.domain)) {
      return {
        ...parsed,
        source: "forwarded From header"
      };
    }
  }

  return {
    name: null,
    email: null,
    domain: forwardingSenderDomain && !isNewlDomain(forwardingSenderDomain) ? forwardingSenderDomain : null,
    source: forwardingSenderDomain && !isNewlDomain(forwardingSenderDomain) ? "Gmail envelope sender" : "unresolved"
  };
}

function extractForwardedFromLines(emailText: string): string[] {
  const lines = emailText.replace(/\r\n/g, "\n").split("\n");
  const matches: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const match = line.match(/^(?:from|de)\s*:\s*(.+)$/i);
    if (!match?.[1]) {
      continue;
    }

    const value = unfoldForwardedHeaderValue(match[1], lines, index + 1);
    if (/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value)) {
      matches.push(value);
    }
  }

  return matches;
}

function unfoldForwardedHeaderValue(firstValue: string, lines: string[], startIndex: number): string {
  const parts = [firstValue.trim()];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^\s+/.test(line) || /^(?:sent|date|to|cc|subject|from|de|envoyé|à|objet)\s*:/i.test(line.trim())) {
      break;
    }
    parts.push(line.trim());
  }

  return parts.join(" ");
}

function parseSenderLine(value: string): Omit<OriginalSenderInfo, "source"> {
  const angleMatch = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  const plainEmailMatch = value.match(/([A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,}))/);
  const email = angleMatch?.[2]?.trim() ?? plainEmailMatch?.[1]?.trim() ?? null;
  const domain = email?.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/)?.[1]?.toLowerCase() ?? null;
  const name = (angleMatch?.[1] ?? value.replace(plainEmailMatch?.[1] ?? "", ""))
    .replace(/^["']|["']$/g, "")
    .trim() || null;

  return {
    name,
    email,
    domain
  };
}

function isNewlDomain(domain: string) {
  return ["newl.ca", "newlgroup.com"].includes(domain.toLowerCase());
}

function extractTextFromFetchedMessage(message: Awaited<ReturnType<ImapFlow["fetchOne"]>>): string {
  if (!message) {
    return "";
  }

  const textPart = message.bodyParts?.get("TEXT");
  if (textPart) {
    return safeText(textPart);
  }

  if (message.source) {
    return extractBodyFromRawMessage(message.source);
  }

  return "";
}

function extractBodyFromRawMessage(source: Buffer): string {
  const rawMessage = safeText(source);
  const bodyStart = rawMessage.search(/\r?\n\r?\n/);
  return bodyStart === -1 ? rawMessage : safeText(rawMessage.slice(bodyStart));
}

function getFirstEnvValue(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  throw new Error(`${names.join(" or ")} is missing.`);
}

function requireEnvValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing.`);
  }

  return value;
}

function normalizeLogisticsInquiry(value: unknown): LogisticsInquiry {
  const record = asRecord(value);
  const normalizedCustomer = readCustomerName(record.customer);

  return {
    customer: normalizedCustomer,
    customertype: normalizeCustomerType(record.customertype),
    mode: readString(record.mode),
    origin: readRawString(record.origin),
    destination: readRawString(record.destination),
    incoterms: readString(record.incoterms),
    service: readString(record.service),
    direction: readString(record.direction),
    shipmentType: readString(record.shipmentType),
    urgency: readString(record.urgency),
    requestedTiming: readString(record.requestedTiming),
    originPostalCode: readString(record.originPostalCode),
    originCountry: readString(record.originCountry),
    destinationPostalCode: readString(record.destinationPostalCode),
    destinationCountry: readString(record.destinationCountry),
    pickupDate: readString(record.pickupDate),
    freightClass: readString(record.freightClass),
    nmfc: readString(record.nmfc),
    unNumber: readString(record.unNumber),
    accessorials: Array.isArray(record.accessorials)
      ? record.accessorials.map((item) => readString(item)).filter(Boolean)
      : [],
    containerQuantity: readString(record.containerQuantity),
    containerSize: readString(record.containerSize),
    equipmentType: readString(record.equipmentType),
    containerWeight: readString(record.containerWeight),
    weightUnit: readEnum(record.weightUnit, ["LBS", "KG"]),
    dimensionsUnit: readEnum(record.dimensionsUnit, ["CM", "INCH"]),
    floorLoaded: readBoolean(record.floorLoaded),
    commodity: readString(record.commodity),
    items: Array.isArray(record.items)
      ? record.items.map((item) => {
          const itemRecord = asRecord(item);
          return {
            quantity:
              readString(itemRecord.quantity) ||
              readString(itemRecord.numberPieces) ||
              readString(itemRecord.noOfPieces) ||
              readString(itemRecord.number) ||
              readString(itemRecord.pieces) ||
              readString(record.pieces),
            packagingType: readString(itemRecord.packagingType),
            length: readString(itemRecord.length),
            width: readString(itemRecord.width),
            height: readString(itemRecord.height),
            weight: readString(itemRecord.weight),
            weightType: readLowerEnum(itemRecord.weightType, ["each", "total"]),
            freightClass: readString(itemRecord.freightClass),
            nmfc: readString(itemRecord.nmfc),
            unNumber: readString(itemRecord.unNumber)
          };
        })
      : [],
    insurance: readBoolean(record.insurance),
    customs: readBoolean(record.customs),
    dangerousGoods: readBoolean(record.dangerousGoods),
    readyDate: readString(record.readyDate)
  };
}

function emptyParsedEmailLogisticsData(): ParsedEmailLogisticsData {
  return {
    customer: "",
    customertype: "customer",
    mode: "",
    origin: "",
    destination: "",
    incoterms: "",
    service: "",
    direction: "",
    shipmentType: "",
    urgency: "",
    requestedTiming: "",
    originPostalCode: "",
    originCountry: "",
    destinationPostalCode: "",
    destinationCountry: "",
    pickupDate: "",
    freightClass: "",
    nmfc: "",
    unNumber: "",
    accessorials: [],
    containerQuantity: "",
    containerSize: "",
    equipmentType: "",
    containerWeight: "",
    weightUnit: "",
    dimensionsUnit: "",
    floorLoaded: false,
    commodity: "",
    items: [],
    insurance: false,
    customs: false,
    dangerousGoods: false,
    readyDate: ""
  };
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function normalizeCustomerType(value: unknown): LogisticsInquiry["customertype"] {
  return readString(value).toLowerCase() === "agent" ? "agent" : "customer";
}

async function resolveParsedCustomerNameFromWebsite(parsedData: ParsedEmailLogisticsData, senderDomain: string | null): Promise<void> {
  const rawCustomer = parsedData.customer;
  const resolvedCustomer = await resolveCustomerNameForTms(rawCustomer, undefined, senderDomain);
  parsedData.customer = resolvedCustomer;
}

async function applyTeamshipCustomerMatch(parsedData: ParsedEmailLogisticsData, senderDomain: string | null): Promise<void> {
  const originalCustomer = readString(parsedData.customer);
  if (!originalCustomer) {
    console.log('[CUSTOMER-MATCH] original parsed customer="(empty)" matched="(none)" score=0 reason="empty customer" final="(empty)"');
    return;
  }

  let customers: string[];
  try {
    customers = await readTeamshipCustomerNames();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown customer-list read error.";
    console.log(
      `[CUSTOMER-MATCH] original parsed customer="${originalCustomer}" matched="(none)" score=0 reason="Teamship customer list could not be read: ${message}" final="${parsedData.customer}"`
    );
    return;
  }

  const match = resolveTeamshipCustomerNameForTms(originalCustomer, customers, senderDomain);
  if (match && match.score >= TEAMSHIP_CUSTOMER_MATCH_THRESHOLD) {
    parsedData.customer = match.customerName;
    console.log(
      `[CUSTOMER-MATCH] original parsed customer="${originalCustomer}" matched="${match.customerName}" score=${match.score.toFixed(3)} reason="${match.reason}" final="${parsedData.customer}"`
    );
    return;
  }

  console.log(
    `[CUSTOMER-MATCH] original parsed customer="${originalCustomer}" matched="${match?.customerName ?? "(none)"}" score=${(match?.score ?? 0).toFixed(3)} reason="${match?.reason ?? "no candidate"}" final="${parsedData.customer}"`
  );
}

let cachedTeamshipCustomerNames: string[] | null = null;

async function readTeamshipCustomerNames(): Promise<string[]> {
  if (cachedTeamshipCustomerNames) {
    return cachedTeamshipCustomerNames;
  }

  const csv = await readFile(TEAMSHIP_CUSTOMER_LIST_PATH, "utf8");
  const rows = parseCsvRows(csv);
  const [header, ...records] = rows;
  const customerNameIndex = header?.indexOf(TEAMSHIP_CUSTOMER_NAME_COLUMN) ?? -1;
  if (customerNameIndex === -1) {
    throw new Error(`Teamship customer list is missing ${TEAMSHIP_CUSTOMER_NAME_COLUMN} column.`);
  }

  cachedTeamshipCustomerNames = [
    ...new Set(
      records
        .map((row) => row[customerNameIndex]?.trim() ?? "")
        .filter(Boolean)
    )
  ];
  return cachedTeamshipCustomerNames;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function resolveTeamshipCustomerNameForTms(
  input: string,
  customerNames: string[],
  senderDomain: string | null = null
): { customerName: string; score: number; reason: string } | null {
  const variants = buildCustomerMatchInputVariants(input, senderDomain);
  if (variants.length === 0) {
    return null;
  }

  let bestMatch: { customerName: string; score: number; reason: string } | null = null;
  for (const customerName of customerNames) {
    const candidateSignature = buildCustomerMatchSignature(customerName);
    if (candidateSignature.tokens.length === 0) {
      continue;
    }

    for (const variant of variants) {
      const score = scoreCustomerNameMatch(variant.signature, candidateSignature, variant.source);
      const reason = describeCustomerMatch(variant.signature, candidateSignature, score, variant.source);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          customerName,
          score,
          reason
        };
      }
    }
  }

  return bestMatch;
}

function buildCustomerMatchInputVariants(input: string, senderDomain: string | null): Array<{ source: string; signature: CustomerMatchSignature }> {
  const values = [
    { source: "full parsed customer", value: input },
    ...splitCustomerNameAlternatives(input).map((value) => ({ source: "parsed customer name segment", value }))
  ];

  const domainEvidence = buildDomainCustomerEvidence(senderDomain);
  if (domainEvidence) {
    values.push({ source: "original sender domain", value: domainEvidence });
  }

  const seen = new Set<string>();
  return values
    .map((item) => ({
      source: item.source,
      signature: buildCustomerMatchSignature(item.value)
    }))
    .filter((item) => {
      if (item.signature.tokens.length === 0 || seen.has(item.signature.normalized)) {
        return false;
      }
      seen.add(item.signature.normalized);
      return true;
    });
}

function splitCustomerNameAlternatives(input: string): string[] {
  return input
    .split(/\s*(?:\/|\||\\|\b(?:dba|aka|formerly known as|fka)\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== input.trim());
}

function buildDomainCustomerEvidence(senderDomain: string | null): string {
  if (!senderDomain || isNewlDomain(senderDomain) || isPersonalEmailDomain(senderDomain)) {
    return "";
  }

  const label = senderDomain.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  return label
    .replace(/[-_]+/g, " ")
    .replace(/\b(?:solutions?|systems?|services?|group|global|logistics|intl|international|inc|llc|ltd|co|corp)\b/g, " ")
    .replace(/solutions?$/i, "")
    .replace(/systems?$/i, "")
    .replace(/services?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

type CustomerMatchSignature = {
  normalized: string;
  tokens: string[];
  tokenSet: Set<string>;
};

function buildCustomerMatchSignature(value: string): CustomerMatchSignature {
  const normalized = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|llc|incorporated|inc|corporation|corp|company|co)\b\.?/g, " ")
    .replace(/\b(solutions?|systems?|services?)\b/g, " ")
    .replace(/\bdba\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(north\s+america|northamerican|n america|n a|na)\b/g, " north america ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);

  return {
    normalized,
    tokens,
    tokenSet: new Set(tokens)
  };
}

function scoreCustomerNameMatch(input: CustomerMatchSignature, candidate: CustomerMatchSignature, source = "parsed customer"): number {
  if (input.normalized === candidate.normalized) {
    return 1;
  }

  if (input.normalized.replace(/\s+/g, "") === candidate.normalized.replace(/\s+/g, "")) {
    return 1;
  }

  const compactInput = input.normalized.replace(/\s+/g, "");
  const compactCandidate = candidate.normalized.replace(/\s+/g, "");
  if (source === "original sender domain" && compactInput.startsWith(compactCandidate) && compactCandidate.length >= 4) {
    return 0.95;
  }

  const intersectionCount = input.tokens.filter((token) => candidate.tokenSet.has(token)).length;
  const precision = intersectionCount / input.tokens.length;
  const recall = intersectionCount / candidate.tokens.length;
  const tokenScore = precision === 0 || recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const sequenceBonus = candidate.normalized.includes(input.normalized) || input.normalized.includes(candidate.normalized) ? 0.08 : 0;

  return Math.min(1, tokenScore + sequenceBonus);
}

function describeCustomerMatch(input: CustomerMatchSignature, candidate: CustomerMatchSignature, score: number, source = "parsed customer"): string {
  if (input.normalized === candidate.normalized) {
    return `${source}: normalized names are equal after legal suffix and punctuation cleanup`;
  }

  if (input.normalized.replace(/\s+/g, "") === candidate.normalized.replace(/\s+/g, "")) {
    return `${source}: normalized names are equal after legal suffix, punctuation, and spacing cleanup`;
  }

  return `${source}: token similarity after cleanup; input="${input.normalized}" candidate="${candidate.normalized}" score=${score.toFixed(3)}`;
}

export async function resolveCustomerNameForTms(
  value: unknown,
  fetchWebsiteHtml: (domain: string) => Promise<string | null> = fetchWebsiteHtmlForDomain,
  senderDomain: string | null = null
): Promise<string> {
  const customer = readString(value);
  if (!customer) {
    return "";
  }

  const parsedDomain = extractDomainFromCustomerValue(customer);
  const cleanedFromSenderDomain = Boolean(senderDomain && isCleanedDomainCustomerName(customer, senderDomain));
  const domain = parsedDomain ?? (cleanedFromSenderDomain ? senderDomain : null);
  if (!domain) {
    return stripDomainLikeCustomerTokens(customer);
  }

  if (isPersonalEmailDomain(domain)) {
    return "";
  }

  const html = await fetchWebsiteHtml(domain);
  const evidence = html ? extractCompanyNameFromWebsiteHtml(html) : null;
  return evidence ?? "";
}

function readCustomerName(value: unknown): string {
  const customer = readString(value);
  if (!customer) {
    return "";
  }

  if (extractDomainFromCustomerValue(customer)) {
    return "";
  }

  return stripDomainLikeCustomerTokens(customer);
}

function extractDomainFromCustomerValue(value: string): string | null {
  const normalized = value.trim();
  const emailMatch = normalized.match(/^[^\s@]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:[/?#].*)?$/i);
  const urlOrDomainMatch = normalized.match(/^(?:https?:\/\/)?(?:www\.)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:[/?#].*)?$/i);
  const decoratedDomainMatch = normalized.match(/^(?:[^\w]+)?(?:https?:\/\/)?(?:www\.)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:[/?#][^\s)]*)?(?:\s*\([^)]*\)|[^\w]+)?$/i);
  return (emailMatch?.[1] ?? urlOrDomainMatch?.[1] ?? decoratedDomainMatch?.[1] ?? null)?.toLowerCase() ?? null;
}

function isCleanedDomainCustomerName(customer: string, domain: string): boolean {
  const domainLabel = domain.toLowerCase().split(".")[0] ?? "";
  const normalizedCustomer = normalizeCustomerComparison(customer);
  const labelWords = domainLabel.split(/[-_]+/).filter(Boolean);
  const normalizedLabel = normalizeCustomerComparison(labelWords.join(" "));
  const acronymLabel = labelWords.map((word) => word[0]).join("");
  const firstLabelWord = normalizeCustomerComparison(labelWords[0] ?? "");

  return (
    normalizedCustomer === normalizedLabel ||
    normalizedCustomer === acronymLabel ||
    normalizedCustomer === firstLabelWord ||
    normalizedCustomer === normalizeCustomerComparison(`${labelWords[0] ?? ""} ${acronymLabel.slice(1)}`)
  );
}

function normalizeCustomerComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isPersonalEmailDomain(domain: string) {
  const personalDomains = new Set([
    "aol.com",
    "gmail.com",
    "hotmail.com",
    "icloud.com",
    "live.com",
    "outlook.com",
    "proton.me",
    "protonmail.com",
    "yahoo.com"
  ]);
  return personalDomains.has(domain.toLowerCase());
}

async function fetchWebsiteHtmlForDomain(domain: string): Promise<string | null> {
  for (const url of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`, `http://www.${domain}`]) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent": "Mozilla/5.0 NewlAppsTmsCustomerResolver/1.0"
        }
      });
      if (!response.ok) {
        continue;
      }

      return await response.text();
    } catch {
      // Try the next common website URL form.
    }
  }

  return null;
}

function extractCompanyNameFromWebsiteHtml(html: string): string | null {
  const candidates = [
    readMetaContent(html, "og:site_name"),
    readMetaContent(html, "application-name"),
    readMetaContent(html, "twitter:site"),
    readTitle(html)
  ];

  for (const candidate of candidates) {
    const cleaned = cleanWebsiteCompanyName(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

function readMetaContent(html: string, propertyOrName: string): string | null {
  const escaped = escapeRegExp(propertyOrName);
  const metaMatch = html.match(new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i"));
  return metaMatch?.[1] ? decodeHtmlEntities(metaMatch[1]) : null;
}

function readTitle(html: string): string | null {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]*>/g, " ")) : null;
}

function cleanWebsiteCompanyName(value: string | null): string | null {
  const cleaned = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*[|–—-]\s*(home|official site|homepage|welcome).*$/i, "")
    .replace(/\s*[|–—-]\s*.*$/i, "")
    .replace(/\bNorth America LLC\b/i, "North America, LLC")
    .replace(/\b([A-Za-z0-9&.' ]+?) LLC\b/g, "$1, LLC")
    .trim();

  if (!cleaned || extractDomainFromCustomerValue(cleaned)) {
    return null;
  }

  return cleaned;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

function stripDomainLikeCustomerTokens(value: string): string {
  const cleaned = value
    .replace(/[^\s<>()[\]{}"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, "")
    .replace(/\b(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/?#][^\s<>()[\]{}"']*)?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*[-|,;:]\s*$/g, "")
    .trim();

  return cleaned;
}

function readRawString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function readEnum<T extends string>(value: unknown, allowed: T[]): T | "" {
  const normalized = readString(value).toUpperCase();
  return allowed.includes(normalized as T) ? (normalized as T) : "";
}

function readLowerEnum<T extends string>(value: unknown, allowed: T[]): T | "" {
  const normalized = readString(value).toLowerCase();
  return allowed.includes(normalized as T) ? (normalized as T) : "";
}

function readBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["true", "yes", "y", "1"].includes(value.trim().toLowerCase());
  }

  return false;
}

function safeText(value: Buffer | string): string {
  return (Buffer.isBuffer(value) ? value.toString("utf8") : value).replace(/\0/g, "").trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      console.log("Starting continuous Gmail listener for logistics emails...");
      await startTmsEmailListener();
    } catch (error) {
      console.error("Gmail listener failed:", error);
      process.exit(1);
    }
  })();
}
