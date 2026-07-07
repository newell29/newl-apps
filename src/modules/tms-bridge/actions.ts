"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ImapFlow } from "imapflow";
import { chromium, type Locator, type Page } from "playwright";
import { fileURLToPath } from "url";

const GMAIL_IMAP_HOST = "imap.gmail.com";
const GMAIL_IMAP_PORT = 993;
const GMAIL_IDLE_REFRESH_MS = 15_000;
const GEMINI_MODEL = "gemini-2.5-flash";

type GmailMessagePayload = {
  uid: number;
  subject: string;
  emailText: string;
};

export type LogisticsInquiry = {
  customer: string;
  mode: string;
  origin: string;
  destination: string;
  incoterms: string;
  service: string;
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
    length: string;
    width: string;
    height: string;
    weight: string;
  }>;
  insurance: boolean;
  customs: boolean;
  dangerousGoods: boolean;
  readyDate: string;
};

export type ParsedEmailLogisticsData = {
  customer: string;
  mode: string;
  origin: string;
  destination: string;
  incoterms: string;
  service: string;
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
    length: string;
    width: string;
    height: string;
    weight: string;
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
    const { uid, subject, emailText } = message;
    if (processedUids.has(uid)) {
      console.log(`[gmail-listener] UID ${uid} already processed after body extraction. source=${source}. Skipping.`);
      return;
    }

    processedUids.add(uid);
    console.log(`[gmail-listener] Unread email found. source=${source} uid=${uid}. bodyLength=${emailText.length}`);
    console.log(`[gmail-listener] Raw incoming email subject for UID ${uid}: ${subject || "(no subject)"}`);
    await markFetchedEmailSeen(client, uid);
    console.log(`[gmail-listener] Calling Gemini parser for UID ${uid}...`);
    const parsedJson = await parseEmailWithGemini(emailText);
    console.log(`[gmail-listener] Gemini ${GEMINI_MODEL} raw JSON string for UID ${uid}:`, parsedJson);
    const parsedData = JSON.parse(parsedJson) as ParsedEmailLogisticsData;
    console.log(`[gmail-listener] Gemini ${GEMINI_MODEL} parsed JSON object for UID ${uid}:`);
    console.log(JSON.stringify(parsedData, null, 2));
    console.log(`[gmail-listener] Parsed data being passed to runTmsAutomation for UID ${uid}:`, parsedData);
    console.log(`[gmail-listener] About to launch TMS browser automation for UID ${uid}...`);
    await runTmsAutomation(parsedData);
    console.log(`[gmail-listener] TMS browser automation completed for UID ${uid}.`);
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

export async function runTmsAutomation(data: ParsedEmailLogisticsData | LogisticsInquiry): Promise<void> {
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

    console.log(`[tms-automation] About to type into customer lookup. Exact customer string="${tmsData.customer}"`);
    await selectDynamicDropdownOption(page, {
      rootSelector: '[data-test-id="quotes_create_customerLookup_id"]',
      inputRole: "textbox",
      value: tmsData.customer,
      label: "customer lookup"
    });

    const opsRepDropdown = page.locator('[data-test-id="quotes_create_opsRep_id"]');
    await opsRepDropdown.waitFor({ state: "visible" });
    await opsRepDropdown.click();
    const pricingDOption = opsRepDropdown.getByText("Pricing D");
    await pricingDOption.waitFor({ state: "visible" });
    await pricingDOption.click();
    await page.locator(`[data-test-id="quotes_create_type_${tmsData.mode}Id"]`).click();

    await typeRawLocationAndTab(page, {
      rootSelector: '[data-test-id="quotes_create_ocean_origin_id_0"]',
      value: tmsData.origin,
      label: "origin"
    });

    await typeRawLocationAndTab(page, {
      rootSelector: '[data-test-id="quotes_create_ocean_destination_id_0"]',
      value: tmsData.destination,
      label: "destination"
    });

    await page.locator('[data-test-id="quotes_create_ocean_incoterms_id"]').selectOption(tmsData.incoterms || "EXW");
    await page.locator('[data-test-id="quotes_create_ocean_service_id"]').selectOption(tmsData.service || "port_to_port");
    await page.locator('[data-test-id="containerQuantity_id_0"]').fill(tmsData.containerQuantity);
    await page.locator('[data-test-id="containerSize_id_0"]').selectOption(tmsData.containerSize);
    await page.locator("#equipmentType-0").selectOption(tmsData.equipmentType);
    await page.locator('[data-test-id="containerWeight_id_0"]').fill(tmsData.containerWeight);

    if (tmsData.weightUnit) {
      await page.locator("label").filter({ hasText: tmsData.weightUnit }).first().click();
    }

    if (tmsData.dimensionsUnit) {
      await page.getByText(tmsData.dimensionsUnit, { exact: true }).click();
    }

    if (tmsData.floorLoaded) {
      await page.getByText("Floor Loaded").click();
    }

    await page.locator('[data-test-id="quotes_create_ocean_container_commodity_id_0"]').fill(tmsData.commodity);

    for (const [index, item] of tmsData.items.entries()) {
      if (index > 0) {
        await page.getByText("+ Add Another Pallet Size").click();
      }

      await page.locator(`[data-test-id="quantity_id_0_${index}"]`).fill(item.quantity);
      await page.locator(`[data-test-id="length_id_0_${index}"]`).fill(item.length);
      await page.locator(`[data-test-id="width_id_0_${index}"]`).fill(item.width);
      await page.locator(`[data-test-id="height_id_0_${index}"]`).fill(item.height);
      await page.locator(`[data-test-id="weight_id_0_${index}"]`).fill(item.weight);
    }

    await clickYesNo(page, "quotes_create_ocean_insurance", tmsData.insurance);
    await clickYesNo(page, "quotes_create_ocean_custom", tmsData.customs);
    await clickYesNo(page, "quotes_create_ocean_dangerousGoods", tmsData.dangerousGoods);

    if (tmsData.readyDate) {
      await page.getByRole("textbox", { name: "MM/DD/YYYY" }).fill(formatReadyDate(tmsData.readyDate));
    }

    await page.locator('[data-test-id="quotes_createSave_id"]').click();
    console.log("[tms-automation] Quote save button clicked.");
    await browser.close();
    console.log("[tms-automation] Browser closed after successful automation.");
  } catch (error) {
    console.error("[tms-automation] Automation failed. Leaving browser open for inspection.", error);
    throw error;
  }
}

export async function parseLogisticsInquiryWithGemini(emailBody: string): Promise<LogisticsInquiry> {
  return normalizeLogisticsInquiry(JSON.parse(await parseEmailWithGemini(emailBody)));
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
      "The customer field must be the requesting customer, shipper, account, or company that is asking for the quote.Extract this from the email text, signature, email domain, or the details on sender's website",
      "Do not use the email receiver, To recipient, Newl, Newl Express, Teamship, or an internal receiver name as customer.",
      "If the email contains a From signature/company, use that as customer only when no explicit customer/account is stated in the body.",
      "Determine request urgency when possible from language like urgent, asap, today, rush, quote needed, or deadline, but only map it into available schema fields when relevant.",
      "Classify the shipment direction if stated or inferable: import, export, domestic, cross-border, or unknown. Put useful classification detail into service when no dedicated field exists.",
      "Normalize mode to the lowercase TMS selector key: air, ocean, ground, trucking, rail, drayage, warehousing, or the nearest available mode.",
      "For trucking or ground, identify LTL vs FTL, number of pieces, packaging type such as pieces, boxes, cartons, crates, skids, or pallets, and truck type such as 53' dry van, 48' flatbed, reefer, sprinter, straight truck, etc. Put truck type/equipment into equipmentType.",
      "For ocean, identify LCL vs FCL, container quantity, 20 or 40 container size, general purpose vs high cube, and map equipmentType to the closest TMS value such as HC - High Cube or GP - General Purpose.",
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
      "Normalize weightUnit to LBS or KG only. Normalize dimensionsUnit to INCH or CM only.",
      "Extract whether insurance is required. If explicitly declined or absent, use false.",
      "Extract whether customs clearance is required. If explicitly declined or absent, use false.",
      "Extract whether dangerous goods / hazmat / DG is involved. If explicitly declined or absent, use false.",
      "Extract readyDate as a clear date string from pickup date, cargo ready date, cut-off, or requested ship date.",
      "Normalize incoterms to a TMS value such as EXW when stated or inferable.",
      "Normalize service to a TMS value such as port_to_port when stated or inferable.",
      "For containers, map the first container count/size/equipment/weight into containerQuantity, containerSize, equipmentType, and containerWeight.",
      "For loose cargo or pallets, map pallet/carton rows into items.",
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

async function clickYesNo(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>,
  testIdPrefix: string,
  value: boolean
): Promise<void> {
  await page.locator(`[data-test-id="${testIdPrefix}${value ? "Yes" : "No"}_id"]`).click();
}

async function selectDynamicDropdownOption(
  page: Page,
  {
    rootSelector,
    inputRole,
    value,
    label
  }: {
    rootSelector: string;
    inputRole: "textbox" | "combobox";
    value: string;
    label: string;
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
  console.log(`[tms-automation] Typing ${label} dropdown value="${trimmedValue}"`);
  await input.fill(trimmedValue);
  await clickVisibleDropdownOption(page, root, trimmedValue, label);
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

async function clickVisibleDropdownOption(page: Page, root: Locator, value: string, label: string): Promise<void> {
  const optionText = flexibleOptionMatcher(value);
  const candidates = [
    page.getByRole("option", { name: optionText }).first(),
    page.locator('[role="listbox"]').getByText(optionText).first(),
    page.locator('[class*="menu"], [class*="Menu"], [class*="option"], [class*="Option"]').getByText(optionText).first(),
    root.getByText(optionText).first(),
    page.getByText(optionText).first()
  ];

  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: "visible", timeout: 2500 });
      console.log(`[tms-automation] Clicking visible ${label} dropdown option for value="${value}"`);
      await candidate.click();
      return;
    } catch {
      // Try the next common dropdown rendering pattern.
    }
  }

  console.log(`[tms-automation] No visible ${label} text option matched "${value}". Falling back to ArrowDown + Enter.`);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
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
        emailText
      }
    : null;
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

  return {
    customer: readString(record.customer),
    mode: readString(record.mode),
    origin: readRawString(record.origin),
    destination: readRawString(record.destination),
    incoterms: readString(record.incoterms),
    service: readString(record.service),
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
            quantity: readString(itemRecord.quantity),
            length: readString(itemRecord.length),
            width: readString(itemRecord.width),
            height: readString(itemRecord.height),
            weight: readString(itemRecord.weight)
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
    mode: "",
    origin: "",
    destination: "",
    incoterms: "",
    service: "",
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
