import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type SmokeOptions = {
  teamshipUrl: string;
  apiBaseUrl: string;
  orderId: string;
  userId: string;
  email: string;
  password: string;
  confirmDevWrite: boolean;
  includeItemOps: boolean;
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
  field_type?: string;
  is_editable_on_shipping_order?: boolean | number;
};

type VerificationRow = {
  field: string;
  expected: string | number;
  found: boolean;
  paths: string[];
};

const DEV_HOST = "dev.teamshipos.com";

async function main() {
  const options = readOptions(process.argv.slice(2));
  assertDevOnly(options);

  const token = await login(options);
  const resolvedOrder = await resolveApiOrder(options, token);
  options.orderId = resolvedOrder.orderId;
  const [customFields, beforeOrder] = await Promise.all([
    fetchCustomFields(options, token),
    Promise.resolve(resolvedOrder.order)
  ]);
  const ediIds = resolveEdiFieldIds(customFields);
  const marker = buildMarker();
  const payload = buildUpdatePayload({ marker, ediIds, beforeOrder, includeItemOps: options.includeItemOps });

  const updateResponse = await fetch(`${options.apiBaseUrl}/v1/ship-inventories/${encodeURIComponent(options.orderId)}`, {
    method: "PUT",
    headers: buildHeaders(token),
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const updateJson = await readJson(updateResponse);

  if (!updateResponse.ok) {
    await writeEvidence({ options, marker, customFields, payload, updateStatus: updateResponse.status, updateJson });
    throw new Error(`Teamship Dev update failed with status ${updateResponse.status}: ${JSON.stringify(updateJson)}`);
  }

  const afterOrder = await fetchOrder(options, token);
  const verification = verifyPayloadValues(payload, afterOrder);
  const evidencePath = await writeEvidence({
    options,
    marker,
    customFields,
    payload,
    updateStatus: updateResponse.status,
    updateJson,
    beforeOrder: summarizeOrder(beforeOrder),
    afterOrder: summarizeOrder(afterOrder),
    verification
  });

  console.log(
    JSON.stringify(
      {
        mode: "TEAMSHIP_DEV_API_UPDATE_SMOKE",
        orderId: options.orderId,
        requestedOrderReference: readTeamshipOrderId(new URL(options.teamshipUrl)),
        userId: options.userId,
        marker,
        updateStatus: updateResponse.status,
        updateMessage: readNestedString(updateJson, ["message"]) ?? readNestedString(updateJson, ["data", "message"]) ?? null,
        customEdiFields: ediIds,
        payloadKeys: Object.keys(payload),
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

function buildUpdatePayload({
  marker,
  ediIds,
  beforeOrder,
  includeItemOps
}: {
  marker: string;
  ediIds: Record<string, string>;
  beforeOrder: unknown;
  includeItemOps: boolean;
}) {
  const compactMarker = marker.replace(/-/g, "");
  const payload: Record<string, unknown> = {
    shippingMethod: "ltl",
    shippingServiceLevel: `Svc ${marker}`,
    pickETA_date: "2026-07-31",
    carrier: `Carrier ${marker}`,
    proNumber: `PRO-${compactMarker}`,
    poNumber: `PO-${compactMarker}`,
    supplier: `Supplier ${marker}`,
    ship_first_name: `DevFirst${compactMarker.slice(-4)}`,
    ship_last_name: `DevLast${compactMarker.slice(-4)}`,
    ship_address: `123 API Smoke ${compactMarker.slice(-4)} Ave`,
    ship_city: "Toronto",
    ship_state: "ON",
    ship_zip: "M1A 1A1",
    ship_country: "CA",
    ship_phone_number: "+1-416-555-0123",
    ship_email: `teamshipdev${compactMarker.toLowerCase()}@example.com`,
    pallets: [
      {
        quantity: 2,
        length: 31,
        width: 22,
        height: 13,
        weight: 44,
        weight_unit: "lbs",
        commodity: `API PALLET A ${marker}`
      },
      {
        quantity: 1,
        length: 41,
        width: 32,
        height: 23,
        weight: 54,
        weight_unit: "lbs",
        commodity: `API PALLET B ${marker}`
      }
    ]
  };

  if (ediIds.salesOrderNumber) {
    payload[`edi_field_${ediIds.salesOrderNumber}`] = `SO-${compactMarker}`;
  }

  if (ediIds.packSlipNumber) {
    payload[`edi_field_${ediIds.packSlipNumber}`] = `PS-${compactMarker}`;
  }

  if (ediIds.freightTermsCode) {
    payload[`edi_field_${ediIds.freightTermsCode}`] = `FT${compactMarker.slice(-8)}`.slice(0, 10);
  }

  if (ediIds.comment) {
    payload[`edi_field_${ediIds.comment}`] = `API comment ${marker}`;
  }

  if (includeItemOps) {
    const items = collectObjects(beforeOrder).filter((item) => itemHasKeys(item, ["id"]));
    const firstItem = items.find((item) => readPrimitive(item.id) != null && readItemQuantity(item) != null);

    if (firstItem) {
      payload.update_items = [
        {
          id: Number(readPrimitive(firstItem.id)),
          quantity: Number(readItemQuantity(firstItem))
        }
      ];
    }
  }

  return payload;
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
  const expectedRows = flattenPayloadExpectations(payload);

  return expectedRows.map((row) => {
    const expected = normalizeComparable(row.expected);
    const paths = flattenedValues
      .filter((value) => normalizeComparable(value.value) === expected)
      .map((value) => value.path)
      .slice(0, 8);

    return {
      field: row.field,
      expected: row.expected,
      found: paths.length > 0,
      paths
    };
  });
}

function flattenPayloadExpectations(payload: Record<string, unknown>) {
  const rows: Array<{ field: string; expected: string | number }> = [];

  for (const [field, value] of Object.entries(payload)) {
    if (field === "pallets" && Array.isArray(value)) {
      value.forEach((pallet, index) => {
        if (!pallet || typeof pallet !== "object") {
          return;
        }

        for (const [palletField, palletValue] of Object.entries(pallet)) {
          if (typeof palletValue === "string" || typeof palletValue === "number") {
            rows.push({ field: `pallets[${index}].${palletField}`, expected: palletValue });
          }
        }
      });
      continue;
    }

    if (field === "update_items") {
      continue;
    }

    if (typeof value === "string" || typeof value === "number") {
      rows.push({ field, expected: value });
    }
  }

  return rows;
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
  const interesting = ["ship", "carrier", "pro", "po", "supplier", "pallet", "edi", "Sales", "Pack", "Freight", "Comment"];

  return values
    .filter((row) => interesting.some((needle) => row.path.toLowerCase().includes(needle.toLowerCase())))
    .slice(0, 200);
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
    throw new Error(`Unable to resolve Teamship display order ${options.orderId}. List status ${listResponse.status}.`);
  }

  const matchingOrder = unwrapArray(listJson).find((order) => orderMatchesDisplayId(order, options.orderId));
  const resolvedId = matchingOrder ? readOrderApiId(matchingOrder) : null;

  if (!resolvedId) {
    throw new Error(
      `Teamship display order ${options.orderId} was not directly accessible and was not found in the first 100 listed orders.`
    );
  }

  const resolvedResponse = await fetchOrderResponse(options, token, resolvedId);
  const resolvedJson = await readJson(resolvedResponse);

  if (!resolvedResponse.ok) {
    throw new Error(`Resolved Teamship API order ${resolvedId} from display order ${options.orderId}, but fetch returned ${resolvedResponse.status}.`);
  }

  return {
    orderId: resolvedId,
    order: resolvedJson
  };
}

function readOptions(args: string[]): SmokeOptions {
  const teamshipUrl = readStringOption(args, "--teamship-url") ?? process.env.TEAMSHIP_DEV_ORDER_URL;

  if (!teamshipUrl) {
    throw new Error("Provide --teamship-url or TEAMSHIP_DEV_ORDER_URL.");
  }

  const parsedUrl = new URL(teamshipUrl);
  const apiBaseUrl =
    readStringOption(args, "--api-base-url") ?? process.env.TEAMSHIP_API_BASE_URL ?? `${parsedUrl.origin.replace(/\/+$/, "")}/api`;

  return {
    teamshipUrl,
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    orderId: readStringOption(args, "--order-id") ?? readTeamshipOrderId(parsedUrl),
    userId: readStringOption(args, "--user-id") ?? process.env.TEAMSHIP_DEV_USER_ID ?? "562",
    email: readStringOption(args, "--email") ?? process.env.TEAMSHIP_EMAIL ?? "",
    password: readStringOption(args, "--password") ?? process.env.TEAMSHIP_PASSWORD ?? "",
    confirmDevWrite: args.includes("--confirm-dev-write"),
    includeItemOps: args.includes("--include-item-ops")
  };
}

function assertDevOnly(options: SmokeOptions) {
  const urlHost = new URL(options.teamshipUrl).hostname;
  const apiHost = new URL(options.apiBaseUrl).hostname;

  if (urlHost !== DEV_HOST || apiHost !== DEV_HOST) {
    throw new Error("This smoke test is restricted to dev.teamshipos.com.");
  }

  if (!options.confirmDevWrite) {
    throw new Error("Dev write smoke test requires --confirm-dev-write.");
  }

  if (!options.email || !options.password) {
    throw new Error("Provide Teamship Dev credentials through TEAMSHIP_EMAIL and TEAMSHIP_PASSWORD or --email/--password.");
  }
}

function readTeamshipOrderId(url: URL) {
  const match = url.pathname.match(/\/ship-inventories\/(\d+)/);

  if (!match?.[1]) {
    throw new Error("Unable to read Teamship order ID from --teamship-url.");
  }

  return match[1];
}

function orderMatchesDisplayId(order: unknown, displayId: string) {
  if (!order || typeof order !== "object") {
    return false;
  }

  const record = order as Record<string, unknown>;
  const candidates = [record.display_id, record.order_number, record.id, record.order_id].map((value) => String(value ?? ""));

  return candidates.includes(displayId);
}

function readOrderApiId(order: unknown) {
  if (!order || typeof order !== "object") {
    return null;
  }

  const record = order as Record<string, unknown>;
  const value = record.id ?? record.order_id;

  return value == null ? null : String(value);
}

function buildHeaders(token: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`
  };
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function unwrapArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.data)) {
      return record.data;
    }

    if (record.data && typeof record.data === "object") {
      const nestedData = record.data as Record<string, unknown>;
      for (const nestedValue of Object.values(nestedData)) {
        if (Array.isArray(nestedValue)) {
          return nestedValue;
        }
      }
    }
  }

  return [];
}

function collectObjects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectObjects);
  }

  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(collectObjects)];
}

function itemHasKeys(item: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(item, key));
}

function readPrimitive(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return null;
}

function readItemQuantity(item: Record<string, unknown>) {
  return readPrimitive(item.quantity) ?? readPrimitive(item.inventory_count) ?? readPrimitive(item.ordered);
}

function readStringOption(args: string[], name: string) {
  const index = args.indexOf(name);

  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

function readNestedString(value: unknown, pathParts: string[]) {
  let current = value;

  for (const pathPart of pathParts) {
    if (!current || typeof current !== "object") {
      return null;
    }

    current = (current as Record<string, unknown>)[pathPart];
  }

  return typeof current === "string" ? current : null;
}

function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeComparable(value: unknown) {
  if (typeof value === "number") {
    return String(value);
  }

  return String(value ?? "").trim();
}

function buildMarker() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  const hours = `${now.getHours()}`.padStart(2, "0");
  const minutes = `${now.getMinutes()}`.padStart(2, "0");
  const seconds = `${now.getSeconds()}`.padStart(2, "0");

  return `D${month}${day}${hours}${minutes}${seconds}`;
}

async function writeEvidence(value: unknown) {
  const evidenceDir = path.join(process.cwd(), "tmp", "teamship-dev-api-smoke");
  await mkdir(evidenceDir, { recursive: true });

  const evidencePath = path.join(evidenceDir, `teamship-dev-api-smoke-${Date.now()}.json`);
  await writeFile(evidencePath, `${JSON.stringify(redactEvidence(value), null, 2)}\n`);

  return evidencePath;
}

function redactEvidence(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (key, nestedValue) => {
      if (["password", "token", "authorization"].includes(key.toLowerCase())) {
        return "[REDACTED]";
      }

      return nestedValue;
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
