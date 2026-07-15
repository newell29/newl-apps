import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { compactGarlandSpecialInstructions } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import { parseGarlandShippingOrderPages } from "@/modules/shipment-documents/teamship-review";
import type { GarlandPdfShippingOrder } from "@/modules/shipment-documents/teamship-review-types";

type SmokeOptions = {
  pdfPath: string;
  srNumber: string;
  teamshipUrl: string;
  apiBaseUrl: string;
  orderId: string;
  userId: string;
  email: string;
  password: string;
  confirmDevWrite: boolean;
};

type TeamshipLoginResponse = {
  token?: string;
  data?: {
    token?: string;
  };
};

type CustomField = {
  id?: string | number;
  label?: string;
  edi_key?: string;
};

type TextItemLike = {
  str?: string;
  transform?: unknown[];
};

type PdfPageLike = {
  getTextContent: () => Promise<{ items: TextItemLike[] }>;
};

type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
};

type PdfJsLegacyModule = {
  getDocument: (options: { data: Uint8Array; disableWorker: boolean }) => { promise: Promise<PdfDocumentLike> };
};

type VerificationRow = {
  field: string;
  extractedValue: string | number;
  apiField: string;
  found: boolean;
  paths: string[];
};

const DEV_HOST = "dev.teamshipos.com";

async function main() {
  const options = readOptions(process.argv.slice(2));
  assertDevOnly(options);

  const pdfOrders = await extractOrdersFromPdf(options.pdfPath);
  const pdfOrder = pdfOrders.find((order) => normalizeIdentifier(order.srNumber) === normalizeIdentifier(options.srNumber));

  if (!pdfOrder) {
    throw new Error(`No PDF order found for ${options.srNumber}. Parsed ${pdfOrders.length} order(s).`);
  }

  const token = await login(options);
  const resolvedOrder = await resolveApiOrder(options, token);
  options.orderId = resolvedOrder.orderId;
  const customFields = await fetchCustomFields(options, token);
  const ediIds = resolveEdiFieldIds(customFields);
  const payload = buildPayloadFromPdfOrder({ pdfOrder, ediIds });

  const updateResponse = await fetch(`${options.apiBaseUrl}/v1/ship-inventories/${encodeURIComponent(options.orderId)}`, {
    method: "PUT",
    headers: buildHeaders(token),
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const updateJson = await readJson(updateResponse);

  if (!updateResponse.ok) {
    await writeEvidence({ options, pdfOrder, customFields, payload, updateStatus: updateResponse.status, updateJson });
    throw new Error(`Teamship Dev PDF mapping update failed with status ${updateResponse.status}: ${JSON.stringify(updateJson)}`);
  }

  const afterOrder = await fetchOrder(options, token);
  const verification = verifyPayloadValues(payload, afterOrder);
  const evidencePath = await writeEvidence({
    options,
    pdfOrder,
    customFields,
    payload,
    updateStatus: updateResponse.status,
    updateJson,
    afterOrder: summarizeOrder(afterOrder),
    verification
  });

  console.log(
    JSON.stringify(
      {
        mode: "TEAMSHIP_DEV_PDF_MAPPING_SMOKE",
        sourcePdf: options.pdfPath,
        sourceOrder: summarizePdfOrder(pdfOrder),
        devOrderId: options.orderId,
        requestedOrderReference: readTeamshipOrderId(new URL(options.teamshipUrl)),
        userId: options.userId,
        updateStatus: updateResponse.status,
        customEdiFields: ediIds,
        payload,
        verificationSummary: {
          passed: verification.filter((row) => row.found).length,
          failed: verification.filter((row) => !row.found).length
        },
        verification,
        evidencePath
      },
      null,
      2
    )
  );
}

function buildPayloadFromPdfOrder({
  pdfOrder,
  ediIds
}: {
  pdfOrder: GarlandPdfShippingOrder;
  ediIds: Record<string, string>;
}) {
  const payload: Record<string, unknown> = {};

  setIfValue(payload, "carrier", pdfOrder.shipVia);
  setIfValue(payload, "poNumber", pdfOrder.shipToPo);
  setIfValue(payload, "ship_first_name", pdfOrder.shipToName);
  setIfValue(payload, "ship_address", pdfOrder.shipToAddress1);
  setIfValue(payload, "ship_city", pdfOrder.shipToCity);
  setIfValue(payload, "ship_state", pdfOrder.shipToState);
  setIfValue(payload, "ship_zip", pdfOrder.shipToPostalCode);
  setIfValue(payload, "ship_country", normalizeCountry(pdfOrder.shipToCountry));

  if (ediIds.salesOrderNumber) {
    payload[`edi_field_${ediIds.salesOrderNumber}`] = pdfOrder.srNumber;
  }

  if (ediIds.packSlipNumber) {
    payload[`edi_field_${ediIds.packSlipNumber}`] = `${pdfOrder.psNumber}-${pdfOrder.srNumber}`;
  }

  if (ediIds.freightTermsCode) {
    setIfValue(payload, `edi_field_${ediIds.freightTermsCode}`, pdfOrder.freightTerms);
  }

  if (ediIds.comment) {
    setIfValue(payload, `edi_field_${ediIds.comment}`, compactGarlandSpecialInstructions(pdfOrder.instructions));
  }

  return payload;
}

function setIfValue(payload: Record<string, unknown>, key: string, value: string | null | undefined) {
  const normalized = value?.trim();

  if (normalized) {
    payload[key] = normalized;
  }
}

async function extractOrdersFromPdf(pdfPath: string) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsLegacyModule;
  const data = new Uint8Array(await readFile(pdfPath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push({ pageNumber, text: await extractPageText(page) });
  }

  return parseGarlandShippingOrderPages(pages);
}

async function extractPageText(page: PdfPageLike) {
  const textContent = await page.getTextContent();
  const items = textContent.items
    .map((item) => {
      if (!item.str?.trim()) {
        return null;
      }

      const transform = Array.isArray(item.transform) ? item.transform : [];
      return {
        text: item.str,
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0)
      };
    })
    .filter((item): item is { text: string; x: number; y: number } => Boolean(item))
    .sort((left, right) => {
      const yDiff = right.y - left.y;
      return Math.abs(yDiff) > 3 ? yDiff : left.x - right.x;
    });
  const lines: Array<{ y: number; parts: string[] }> = [];

  for (const item of items) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);

    if (line) {
      line.parts.push(item.text);
      continue;
    }

    lines.push({ y: item.y, parts: [item.text] });
  }

  return lines.map((line) => line.parts.join(" ").replace(/\s+/g, " ").trim()).join("\n");
}

async function login(options: SmokeOptions) {
  const response = await fetch(`${options.apiBaseUrl}/v1/login`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: options.email,
      password: options.password
    }),
    cache: "no-store"
  });
  const json = (await readJson(response)) as TeamshipLoginResponse | null;
  const token = json?.data?.token ?? json?.token;

  if (!response.ok || !token) {
    throw new Error(`Teamship Dev login failed with status ${response.status}.`);
  }

  return token;
}

async function fetchCustomFields(options: SmokeOptions, token: string): Promise<CustomField[]> {
  const response = await fetch(`${options.apiBaseUrl}/v1/ship-inventories/custom-fields/${encodeURIComponent(options.userId)}`, {
    method: "GET",
    headers: buildHeaders(token),
    cache: "no-store"
  });
  const json = await readJson(response);

  if (!response.ok) {
    throw new Error(`Unable to fetch Teamship custom fields. Status ${response.status}.`);
  }

  return unwrapArray(json) as CustomField[];
}

async function fetchOrder(options: SmokeOptions, token: string) {
  const response = await fetchOrderResponse(options, token, options.orderId);
  const json = await readJson(response);

  if (!response.ok) {
    throw new Error(`Unable to fetch Teamship order ${options.orderId}. Status ${response.status}.`);
  }

  return json;
}

async function fetchOrderResponse(options: SmokeOptions, token: string, orderId: string) {
  return fetch(`${options.apiBaseUrl}/v1/ship-inventories/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: buildHeaders(token),
    cache: "no-store"
  });
}

async function resolveApiOrder(options: SmokeOptions, token: string) {
  const directResponse = await fetchOrderResponse(options, token, options.orderId);

  if (directResponse.ok) {
    return {
      orderId: options.orderId,
      order: await readJson(directResponse)
    };
  }

  if (![403, 404].includes(directResponse.status)) {
    throw new Error(`Unable to fetch Teamship order ${options.orderId}. Status ${directResponse.status}.`);
  }

  const listResponse = await fetch(`${options.apiBaseUrl}/v1/ship-inventories?page=1&per_page=100`, {
    method: "GET",
    headers: buildHeaders(token),
    cache: "no-store"
  });
  const listJson = await readJson(listResponse);

  if (!listResponse.ok) {
    throw new Error(`Unable to list Teamship orders while resolving ${options.orderId}. Status ${listResponse.status}.`);
  }

  const requestedDisplayId = readTeamshipOrderId(new URL(options.teamshipUrl));
  const match = collectObjects(listJson).find((item) => {
    const candidates = [item.id, item.order_id, item.display_id, item.record_no, item.ship_inventory_id].map(readPrimitive);
    return candidates.includes(requestedDisplayId);
  });
  const apiId = match ? readPrimitive(match.id) ?? readPrimitive(match.order_id) : null;

  if (!apiId) {
    throw new Error(`Unable to resolve display order ${requestedDisplayId} to an API order id.`);
  }

  const resolvedResponse = await fetchOrderResponse(options, token, String(apiId));
  const resolvedJson = await readJson(resolvedResponse);

  if (!resolvedResponse.ok) {
    throw new Error(`Resolved Teamship API order ${apiId}, but fetch returned ${resolvedResponse.status}.`);
  }

  return {
    orderId: String(apiId),
    order: resolvedJson
  };
}

function resolveEdiFieldIds(customFields: CustomField[]) {
  const fields = customFields.map((field) => ({
    id: field.id == null ? "" : String(field.id),
    label: normalizeLabel(field.label),
    ediKey: normalizeLabel(field.edi_key)
  }));

  return {
    salesOrderNumber: findCustomFieldId(fields, ["sales order number", "salesordernumber"]) ?? "5",
    packSlipNumber: findCustomFieldId(fields, ["pack slip number", "packslipnumber", "pslipno"]) ?? "6",
    freightTermsCode: findCustomFieldId(fields, ["freight terms code", "freighttermscode"]) ?? "7",
    comment: findCustomFieldId(fields, ["special instructions", "comment"]) ?? "8"
  };
}

function findCustomFieldId(fields: Array<{ id: string; label: string; ediKey: string }>, matches: string[]) {
  return fields.find((field) => field.id && matches.some((match) => field.label === match || field.ediKey === match))?.id;
}

function verifyPayloadValues(payload: Record<string, unknown>, afterOrder: unknown): VerificationRow[] {
  const flattenedValues = flattenValues(afterOrder);

  return Object.entries(payload)
    .filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number")
    .map(([field, value]) => {
      const expected = normalizeComparable(value);
      const paths = flattenedValues
        .filter((candidate) => normalizeComparable(candidate.value) === expected)
        .map((candidate) => candidate.path)
        .slice(0, 8);

      return {
        field,
        apiField: field,
        extractedValue: value,
        found: paths.length > 0,
        paths
      };
    });
}

function flattenValues(value: unknown, currentPath = "$"): Array<{ path: string; value: string | number | boolean | null }> {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ path: currentPath, value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenValues(item, `${currentPath}[${index}]`));
  }

  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, nestedValue]) => flattenValues(nestedValue, `${currentPath}.${key}`));
  }

  return [];
}

function summarizeOrder(order: unknown) {
  const values = flattenValues(order);
  const interesting = ["ship", "carrier", "po", "edi", "Sales", "Pack", "Freight", "Comment"];

  return values
    .filter((row) => interesting.some((needle) => row.path.toLowerCase().includes(needle.toLowerCase())))
    .slice(0, 200);
}

function summarizePdfOrder(order: GarlandPdfShippingOrder) {
  return {
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    pageNumbers: order.pageNumbers,
    shipVia: order.shipVia,
    shipToName: order.shipToName,
    shipToAddress1: order.shipToAddress1,
    shipToCity: order.shipToCity,
    shipToState: order.shipToState,
    shipToPostalCode: order.shipToPostalCode,
    shipToCountry: order.shipToCountry,
    shipToPo: order.shipToPo,
    freightTerms: order.freightTerms,
    instructions: compactGarlandSpecialInstructions(order.instructions),
    itemCount: order.items.length
  };
}

async function writeEvidence(value: unknown) {
  const dir = path.join(process.cwd(), "tmp", "teamship-dev-pdf-mapping-smoke");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}.json`);
  await writeFile(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

function buildHeaders(token: string) {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function unwrapArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  for (const key of ["data", "items", "results", "records"]) {
    const nested = (value as Record<string, unknown>)[key];

    if (Array.isArray(nested)) {
      return nested;
    }

    if (nested && typeof nested === "object") {
      const nestedArray = unwrapArray(nested);

      if (nestedArray.length > 0) {
        return nestedArray;
      }
    }
  }

  return [];
}

function collectObjects(value: unknown): Array<Record<string, unknown>> {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectObjects);
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(collectObjects)];
}

function readPrimitive(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return null;
}

function normalizeComparable(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function normalizeLabel(value: string | null | undefined) {
  return value?.trim().replace(/[^a-z0-9]+/gi, "").toLowerCase() ?? "";
}

function normalizeCountry(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (/^canada$/i.test(value.trim())) {
    return "CA";
  }

  return value.trim();
}

function readTeamshipOrderId(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function readOptions(args: string[]): SmokeOptions {
  const options: SmokeOptions = {
    pdfPath: process.env.GARLAND_TEAMSHIP_PDF_PATH?.trim() ?? "",
    srNumber: process.env.GARLAND_TEAMSHIP_SR_NUMBER?.trim() ?? "",
    teamshipUrl: process.env.TEAMSHIP_DEV_ORDER_URL?.trim() ?? "",
    apiBaseUrl: process.env.TEAMSHIP_DEV_API_BASE_URL?.trim() ?? "",
    orderId: process.env.TEAMSHIP_DEV_ORDER_ID?.trim() ?? "",
    userId: process.env.TEAMSHIP_DEV_USER_ID?.trim() ?? "562",
    email: process.env.TEAMSHIP_DEV_EMAIL?.trim() ?? "",
    password: process.env.TEAMSHIP_DEV_PASSWORD?.trim() ?? "",
    confirmDevWrite: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1] ?? "";

    if (arg === "--pdf") {
      options.pdfPath = next;
      index += 1;
      continue;
    }

    if (arg === "--sr") {
      options.srNumber = next;
      index += 1;
      continue;
    }

    if (arg === "--teamship-url") {
      options.teamshipUrl = next;
      index += 1;
      continue;
    }

    if (arg === "--order-id") {
      options.orderId = next;
      index += 1;
      continue;
    }

    if (arg === "--user-id") {
      options.userId = next;
      index += 1;
      continue;
    }

    if (arg === "--api-base-url") {
      options.apiBaseUrl = next;
      index += 1;
      continue;
    }

    if (arg === "--email") {
      options.email = next;
      index += 1;
      continue;
    }

    if (arg === "--password") {
      options.password = next;
      index += 1;
      continue;
    }

    if (arg === "--confirm-dev-write") {
      options.confirmDevWrite = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.pdfPath || !options.srNumber || !options.teamshipUrl || !options.email || !options.password) {
    throw new Error("Provide --pdf, --sr, --teamship-url, --email, and --password.");
  }

  if (!options.apiBaseUrl) {
    const url = new URL(options.teamshipUrl);
    options.apiBaseUrl = `${url.protocol}//${url.host}/api`;
  }

  if (!options.orderId) {
    options.orderId = readTeamshipOrderId(new URL(options.teamshipUrl));
  }

  if (!options.confirmDevWrite) {
    throw new Error("This writes to Teamship Dev. Re-run with --confirm-dev-write.");
  }

  return options;
}

function assertDevOnly(options: SmokeOptions) {
  const urls = [options.teamshipUrl, options.apiBaseUrl].map((value) => new URL(value));

  for (const url of urls) {
    if (url.hostname !== DEV_HOST) {
      throw new Error(`Refusing to write outside Teamship Dev. Host was ${url.hostname}.`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Teamship Dev PDF mapping smoke test failed.");
  process.exit(1);
});
