import type {
  TeamshipShippingOrderDetail,
  TeamshipShippingOrderSummary
} from "@/modules/shipment-documents/teamship-review-types";
import { getTenantTeamshipSettings, resolveTenantTeamshipCredentials } from "@/server/integrations/teamship-settings";

const DEFAULT_TEAMSHIP_API_BASE_URL = "https://app.teamshipos.com/api";
const DEFAULT_PAGE_LIMIT = 500;
const DEFAULT_MAX_PAGES = 30;

type TeamshipFetchOptions = {
  tenantId?: string | null;
  shipmentDate?: string | null;
  srNumbers?: string[];
  credentials?: TeamshipRuntimeCredentials | null;
  fetchImpl?: typeof fetch;
};

export type TeamshipRuntimeCredentials = {
  email: string;
  password: string;
  apiBaseUrl?: string | null;
};

type TeamshipLoginResponse = {
  data?: {
    token?: string;
  };
  token?: string;
};

type TeamshipListResponse = {
  data?: TeamshipShippingOrderSummary[];
};

type TeamshipDetailResponse = {
  data?: TeamshipShippingOrderDetail;
};

export type TeamshipShippingProductSearchRow = {
  id?: number | string | null;
  product_id?: number | string | null;
  inventory_stock_id?: number | string | null;
  stock_id?: number | string | null;
  inventory_id?: number | string | null;
  sku?: string | null;
  product_sku?: string | null;
  name?: string | null;
  title?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  available?: number | string | null;
  available_quantity?: number | string | null;
  is_quarantine?: boolean | number | string | null;
  is_quarantine_stock?: boolean | number | string | null;
  custom_attributes?: Array<{
    id?: number | string | null;
    name?: string | null;
    value?: string | number | boolean | null;
    type?: string | null;
  }> | null;
  customAttributes?: TeamshipShippingProductSearchRow["custom_attributes"];
};

type TeamshipProductSearchResponse = {
  data?: TeamshipShippingProductSearchRow[];
  products?: TeamshipShippingProductSearchRow[];
};

export async function isTeamshipConfigured(tenantId?: string | null) {
  const status = await getTeamshipConfigurationStatus(tenantId);
  return status.configured;
}

export async function getTeamshipConfigurationStatus(tenantId?: string | null) {
  const tenantSettings = tenantId ? await getTenantTeamshipSettings({ tenantId }) : null;
  const envConfigured = Boolean(getTeamshipEmail() && getTeamshipPassword());
  const tenantConfigured = Boolean(
    tenantSettings?.status === "ACTIVE" && tenantSettings.email && tenantSettings.passwordConfigured
  );

  return {
    configured: tenantConfigured || envConfigured,
    source: tenantConfigured ? "settings" : envConfigured ? "environment" : "missing",
    apiBaseUrl: tenantSettings?.apiBaseUrl ?? getTeamshipApiBaseUrl(),
    missing:
      tenantConfigured || envConfigured
        ? []
        : [
            tenantSettings?.email || getTeamshipEmail() ? null : "Teamship email",
            tenantSettings?.passwordConfigured || getTeamshipPassword() ? null : "Teamship password"
          ].filter(Boolean) as string[]
  };
}

export async function fetchTeamshipShippingOrdersForReview({
  tenantId,
  shipmentDate,
  srNumbers = [],
  credentials = null,
  fetchImpl = fetch
}: TeamshipFetchOptions): Promise<TeamshipShippingOrderDetail[]> {
  const resolvedCredentials = credentials ?? (await resolveTenantTeamshipCredentials(tenantId ? { tenantId } : null));
  const apiBaseUrl = resolveTeamshipApiBaseUrl(resolvedCredentials);
  const webBaseUrl = resolveTeamshipWebBaseUrl(apiBaseUrl);
  const token = await loginToTeamship(fetchImpl, resolvedCredentials, apiBaseUrl);
  const targetSrNumbers = new Set(srNumbers.map(normalizeIdentifier).filter(Boolean));
  const shouldEnrichFromUiPage = targetSrNumbers.size > 0;
  let webCookieHeader: string | null | undefined;
  const details = new Map<string, TeamshipShippingOrderDetail>();
  const pageLimit = getTeamshipPageLimit();
  const maxPages = getTeamshipMaxPages();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const offset = pageIndex * pageLimit;
    const rows = await listTeamshipShippingOrders({ apiBaseUrl, token, limit: pageLimit, offset, fetchImpl });

    for (const row of rows) {
      const shipmentId = normalizeTeamshipShipmentId(row);
      const shouldFetchBySr = targetSrNumbers.size > 0 && targetSrNumbers.has(shipmentId);
      const shouldFetchByDailyGarland =
        targetSrNumbers.size === 0 && isGarlandOrder(row) && (!shipmentDate || hasMatchingDate(row, shipmentDate));

      if (!shouldFetchBySr && !shouldFetchByDailyGarland) {
        continue;
      }

      const orderId = row.id ?? row.order_id;
      if (!orderId) {
        continue;
      }

      const detail = await getTeamshipShippingOrder({ apiBaseUrl, token, id: String(orderId), fetchImpl });
      let mergedDetail = mergeTeamshipDetailWithSummary(detail, row);

      if (shouldEnrichFromUiPage) {
        if (webCookieHeader === undefined) {
          webCookieHeader = await loginToTeamshipWeb(fetchImpl, resolvedCredentials, webBaseUrl).catch(() => null);
        }

        if (webCookieHeader) {
          const uiDetail = await getTeamshipShippingOrderUiDetail({
            webBaseUrl,
            webCookieHeader,
            id: String(orderId),
            fetchImpl
          }).catch(() => null);

          if (uiDetail) {
            mergedDetail = mergeTeamshipUiDetail(mergedDetail, uiDetail);
          }
        }
      }

      const detailShipmentId = normalizeTeamshipShipmentId(mergedDetail);
      details.set(detailShipmentId || String(orderId), mergedDetail);
    }

    if (targetSrNumbers.size > 0 && Array.from(targetSrNumbers).every((srNumber) => details.has(srNumber))) {
      break;
    }

    if (rows.length < pageLimit) {
      break;
    }
  }

  return Array.from(details.values());
}

export async function searchTeamshipProductsForShipping({
  tenantId,
  userId,
  locationId,
  search,
  credentials = null,
  fetchImpl = fetch
}: {
  tenantId?: string | null;
  userId: number | string;
  locationId: number | string;
  search: string;
  credentials?: TeamshipRuntimeCredentials | null;
  fetchImpl?: typeof fetch;
}): Promise<TeamshipShippingProductSearchRow[]> {
  const resolvedCredentials = credentials ?? (await resolveTenantTeamshipCredentials(tenantId ? { tenantId } : null));
  const apiBaseUrl = resolveTeamshipApiBaseUrl(resolvedCredentials);
  const token = await loginToTeamship(fetchImpl, resolvedCredentials, apiBaseUrl);
  const response = await fetchImpl(`${apiBaseUrl}/v1/ship-inventories/search-products`, {
    method: "POST",
    headers: buildTeamshipHeaders(token),
    body: JSON.stringify({
      user_id: userId,
      location_id: locationId,
      search
    }),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as TeamshipProductSearchResponse | null;

  if (!response.ok || !json) {
    throw new Error(`Unable to search Teamship inventory for ${search}. Teamship returned status ${response.status}.`);
  }

  if (Array.isArray(json.data)) {
    return json.data;
  }

  if (Array.isArray(json.products)) {
    return json.products;
  }

  return [];
}

function mergeTeamshipDetailWithSummary(
  detail: TeamshipShippingOrderDetail,
  summary: TeamshipShippingOrderSummary
): TeamshipShippingOrderDetail {
  return {
    ...summary,
    ...detail,
    id: detail.id ?? summary.id,
    order_id: detail.order_id ?? summary.order_id,
    shipment_id: detail.shipment_id ?? summary.shipment_id,
    customer: detail.customer ?? summary.customer,
    company: detail.company ?? summary.company,
    user_company: detail.user_company ?? summary.user_company,
    customer_name: detail.customer_name ?? summary.customer_name,
    carrier: detail.carrier ?? summary.carrier,
    ship_method: detail.ship_method ?? summary.ship_method,
    shipping_carrier: detail.shipping_carrier ?? summary.shipping_carrier,
    method: detail.method ?? summary.method,
    carrier_name: detail.carrier_name ?? summary.carrier_name,
    po_number: detail.po_number ?? summary.po_number,
    pickup_eta: detail.pickup_eta ?? summary.pickup_eta,
    shipment_date: detail.shipment_date ?? summary.shipment_date,
    url: detail.url ?? summary.url
  };
}

export function parseTeamshipShippingOrderUiPage(html: string): Partial<TeamshipShippingOrderDetail> {
  const inventories = parseJsonArray(readHtmlFormValueById(html, "inventories_all"));
  const items = inventories
    .map(readTeamshipUiInventoryItem)
    .filter((item): item is NonNullable<ReturnType<typeof readTeamshipUiInventoryItem>> => Boolean(item));
  const pallets = readTeamshipUiPallets(html);

  return {
    items,
    pallet_dims: pallets
  };
}

async function loginToTeamship(fetchImpl: typeof fetch, credentials: TeamshipRuntimeCredentials | null, apiBaseUrl: string) {
  const email = credentials?.email.trim() || getTeamshipEmail();
  const password = credentials?.password.trim() || getTeamshipPassword();

  if (!email || !password) {
    throw new Error("Teamship credentials are not configured. Add Teamship credentials in Settings.");
  }

  const response = await fetchImpl(`${apiBaseUrl}/v1/login`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as TeamshipLoginResponse | null;

  if (!response.ok || !json) {
    throw new Error(`Teamship login failed with status ${response.status}.`);
  }

  const token = json.data?.token ?? json.token;

  if (!token) {
    throw new Error("Teamship login succeeded but did not return an API token.");
  }

  return token;
}

async function listTeamshipShippingOrders({
  apiBaseUrl,
  token,
  limit,
  offset,
  fetchImpl
}: {
  apiBaseUrl: string;
  token: string;
  limit: number;
  offset: number;
  fetchImpl: typeof fetch;
}) {
  const url = new URL(`${apiBaseUrl}/v1/ship-inventories`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("order_by", "created_at");
  url.searchParams.set("order", "DESC");

  const response = await fetchImpl(url, {
    headers: buildTeamshipHeaders(token),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as TeamshipListResponse | null;

  if (!response.ok || !json || !Array.isArray(json.data)) {
    throw new Error(`Unable to list Teamship shipping orders. Teamship returned status ${response.status}.`);
  }

  return json.data;
}

async function getTeamshipShippingOrder({
  apiBaseUrl,
  token,
  id,
  fetchImpl
}: {
  apiBaseUrl: string;
  token: string;
  id: string;
  fetchImpl: typeof fetch;
}) {
  const response = await fetchImpl(`${apiBaseUrl}/v1/ship-inventories/${encodeURIComponent(id)}`, {
    headers: buildTeamshipHeaders(token),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as TeamshipDetailResponse | null;

  if (!response.ok || !json?.data) {
    throw new Error(`Unable to load Teamship shipping order ${id}. Teamship returned status ${response.status}.`);
  }

  return json.data;
}

function buildTeamshipHeaders(token: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`
  };
}

async function loginToTeamshipWeb(
  fetchImpl: typeof fetch,
  credentials: TeamshipRuntimeCredentials | null,
  webBaseUrl: string
) {
  const email = credentials?.email.trim() || getTeamshipEmail();
  const password = credentials?.password.trim() || getTeamshipPassword();

  if (!email || !password) {
    throw new Error("Teamship credentials are not configured. Add Teamship credentials in Settings.");
  }

  const cookieJar = new Map<string, string>();
  const loginPageResponse = await fetchImpl(`${webBaseUrl}/login`, {
    headers: {
      accept: "text/html"
    },
    cache: "no-store"
  });
  mergeSetCookies(cookieJar, readSetCookies(loginPageResponse.headers));
  const loginPageHtml = await loginPageResponse.text().catch(() => "");
  const csrfToken = readHtmlFormValueByName(loginPageHtml, "_token") ?? readMetaContentByName(loginPageHtml, "csrf-token");
  const body = new URLSearchParams({
    email,
    password
  });

  if (csrfToken) {
    body.set("_token", csrfToken);
  }

  const loginResponse = await fetchImpl(`${webBaseUrl}/login`, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      cookie: serializeCookies(cookieJar)
    },
    body,
    cache: "no-store",
    redirect: "manual"
  });
  mergeSetCookies(cookieJar, readSetCookies(loginResponse.headers));

  const cookieHeader = serializeCookies(cookieJar);
  if (!cookieHeader) {
    throw new Error(`Teamship web login did not return a session cookie. Teamship returned status ${loginResponse.status}.`);
  }

  return cookieHeader;
}

async function getTeamshipShippingOrderUiDetail({
  webBaseUrl,
  webCookieHeader,
  id,
  fetchImpl
}: {
  webBaseUrl: string;
  webCookieHeader: string;
  id: string;
  fetchImpl: typeof fetch;
}) {
  const response = await fetchImpl(`${webBaseUrl}/ship-inventories/${encodeURIComponent(id)}`, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      cookie: webCookieHeader
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Unable to load Teamship UI shipping order ${id}. Teamship returned status ${response.status}.`);
  }

  const html = await response.text();
  const parsed = parseTeamshipShippingOrderUiPage(html);

  return {
    ...parsed,
    url: `${webBaseUrl}/ship-inventories/${encodeURIComponent(id)}`
  };
}

function mergeTeamshipUiDetail(
  detail: TeamshipShippingOrderDetail,
  uiDetail: Partial<TeamshipShippingOrderDetail>
): TeamshipShippingOrderDetail {
  return {
    ...detail,
    items: mergeArrayValues(detail.items, uiDetail.items),
    pallet_dims: mergeArrayValues(detail.pallet_dims, uiDetail.pallet_dims),
    url: uiDetail.url ?? detail.url
  };
}

function mergeArrayValues<T>(left: T[] | undefined, right: T[] | undefined) {
  return [...(left ?? []), ...(right ?? [])];
}

function getTeamshipApiBaseUrl() {
  return (process.env.TEAMSHIP_API_BASE_URL?.trim() || DEFAULT_TEAMSHIP_API_BASE_URL).replace(/\/+$/, "");
}

function resolveTeamshipApiBaseUrl(credentials: TeamshipRuntimeCredentials | null) {
  return (credentials?.apiBaseUrl?.trim() || getTeamshipApiBaseUrl()).replace(/\/+$/, "");
}

function resolveTeamshipWebBaseUrl(apiBaseUrl: string) {
  try {
    return new URL(apiBaseUrl).origin.replace(/\/+$/, "");
  } catch {
    return apiBaseUrl.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
  }
}

function getTeamshipEmail() {
  return process.env.TEAMSHIP_EMAIL?.trim() || null;
}

function getTeamshipPassword() {
  return process.env.TEAMSHIP_PASSWORD?.trim() || null;
}

function getTeamshipPageLimit() {
  const parsed = Number.parseInt(process.env.TEAMSHIP_LIST_PAGE_LIMIT ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }

  return Math.min(parsed, DEFAULT_PAGE_LIMIT);
}

function getTeamshipMaxPages() {
  const parsed = Number.parseInt(process.env.TEAMSHIP_MAX_LIST_PAGES ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_PAGES;
  }

  return parsed;
}

function isGarlandOrder(order: TeamshipShippingOrderSummary) {
  const companyText = [
    order.customer?.company,
    order.customer?.name,
    order.company,
    order.user_company,
    order.customer_name
  ]
    .filter(Boolean)
    .join(" ");

  return normalizeText(companyText).includes("GARLAND CANADA DISTRIBUTION");
}

function hasMatchingDate(order: TeamshipShippingOrderSummary, shipmentDate: string) {
  const dates = [
    order.shipment_date,
    order.pickup_eta,
    order.created_at_date,
    order.imported_date,
    order.order_created_at_date,
    order.created_at?.slice(0, 10),
    order.imported_at?.slice(0, 10)
  ]
    .filter(Boolean)
    .map((value) => String(value).slice(0, 10));

  return dates.includes(shipmentDate);
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeTeamshipShipmentId(order: TeamshipShippingOrderSummary) {
  return normalizeIdentifier(order.shipment_id ?? order.amazon_shipment_id1 ?? order.edi_field_1);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTeamshipUiInventoryItem(record: unknown) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const inventory = record as Record<string, unknown>;
  const sku = firstString([
    readNestedValue(inventory, ["item", "sku", "code"]),
    readNestedValue(inventory, ["item", "sku_code"]),
    readNestedValue(inventory, ["item", "code"]),
    readNestedValue(inventory, ["item", "sku"]),
    inventory.sku,
    inventory.sku_code
  ]);
  const serial = readCustomAttributeValue(inventory, "serial") ?? firstString([inventory.serial, inventory.serial_number, inventory.serialNumber]);
  const quantity = firstString([
    readNestedValue(inventory, ["pivot", "quantity"]),
    inventory.quantity,
    inventory.reserved_quantity,
    inventory.on_hand
  ]);

  if (!sku && !serial && !quantity) {
    return null;
  }

  return {
    sku,
    quantity,
    serial_number: serial,
    product: {
      sku,
      serial
    }
  };
}

function readTeamshipUiPallets(html: string) {
  const count = Number.parseInt(readHtmlFormValueById(html, "pallets_count") ?? "", 10);
  const maxCount = Number.isFinite(count) && count > 0 ? count : 10;
  const pallets: TeamshipShippingOrderDetail["pallet_dims"] = [];

  for (let index = 1; index <= maxCount; index += 1) {
    const pallet = {
      quantity: readHtmlFormValueById(html, `pallet_${index}`),
      length: readHtmlFormValueById(html, `pallet_${index}_length`),
      width: readHtmlFormValueById(html, `pallet_${index}_width`),
      height: readHtmlFormValueById(html, `pallet_${index}_height`),
      weight: readHtmlFormValueById(html, `pallet_${index}_weight`),
      weight_unit: readHtmlFormValueById(html, `pallet_${index}_weight_unit`) ?? "lbs",
      commodity: readHtmlFormValueById(html, `pallet_${index}_commodity`)
    };

    if (Object.values(pallet).some((value) => value && String(value).trim())) {
      pallets.push(pallet);
    }
  }

  return pallets;
}

function parseJsonArray(value: string | null) {
  if (!value) {
    return [];
  }

  const parsed = safeJsonParse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readCustomAttributeValue(record: Record<string, unknown>, name: string) {
  const attributes = [
    record.customAttribut,
    record.customAttribute,
    record.custom_attributes,
    record.customAttributes,
    readNestedValue(record, ["item", "customAttribut"]),
    readNestedValue(record, ["item", "customAttribute"]),
    readNestedValue(record, ["item", "custom_attributes"]),
    readNestedValue(record, ["item", "customAttributes"])
  ];
  const normalizedName = normalizeText(name);

  for (const attributeGroup of attributes) {
    if (!Array.isArray(attributeGroup)) {
      continue;
    }

    for (const attribute of attributeGroup) {
      if (!attribute || typeof attribute !== "object") {
        continue;
      }

      const attributeRecord = attribute as Record<string, unknown>;
      const attributeName = normalizeText(firstString([attributeRecord.name, attributeRecord.label, attributeRecord.key]));

      if (attributeName === normalizedName) {
        return firstString([attributeRecord.value, attributeRecord.attribute_value, attributeRecord.attributeValue]);
      }
    }
  }

  return null;
}

function readNestedValue(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function readHtmlFormValueById(html: string, id: string) {
  return readHtmlFormValue(html, "id", id);
}

function readHtmlFormValueByName(html: string, name: string) {
  return readHtmlFormValue(html, "name", name);
}

function readHtmlFormValue(html: string, attributeName: "id" | "name", expectedValue: string) {
  let position = 0;

  while (position < html.length) {
    const inputIndex = indexOfIgnoreCase(html, "<input", position);
    const textareaIndex = indexOfIgnoreCase(html, "<textarea", position);
    const startIndex = minNonNegative(inputIndex, textareaIndex);

    if (startIndex < 0) {
      break;
    }

    const tag = readHtmlOpeningTag(html, startIndex);

    if (!tag) {
      position = startIndex + 1;
      continue;
    }

    position = tag.endIndex;

    if (readHtmlAttribute(tag.markup, attributeName) !== expectedValue) {
      continue;
    }

    if (tag.name === "textarea") {
      const closeIndex = indexOfIgnoreCase(html, "</textarea>", tag.endIndex);
      return decodeHtmlEntities(closeIndex >= 0 ? html.slice(tag.endIndex, closeIndex) : "");
    }

    return readHtmlAttribute(tag.markup, "value");
  }

  return null;
}

function readHtmlOpeningTag(html: string, startIndex: number) {
  const nameMatch = html.slice(startIndex, startIndex + 20).match(/^<([a-z0-9-]+)/i);

  if (!nameMatch?.[1]) {
    return null;
  }

  let quote: string | null = null;

  for (let index = startIndex + 1; index < html.length; index += 1) {
    const char = html[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") {
      return {
        name: nameMatch[1].toLowerCase(),
        markup: html.slice(startIndex, index + 1),
        endIndex: index + 1
      };
    }
  }

  return null;
}

function indexOfIgnoreCase(value: string, search: string, fromIndex: number) {
  return value.toLowerCase().indexOf(search.toLowerCase(), fromIndex);
}

function minNonNegative(left: number, right: number) {
  if (left < 0) {
    return right;
  }

  if (right < 0) {
    return left;
  }

  return Math.min(left, right);
}

function readMetaContentByName(html: string, expectedName: string) {
  const metaPattern = /<meta\b[^>]*>/gi;

  for (const match of html.matchAll(metaPattern)) {
    const tag = match[0] ?? "";
    const name = readHtmlAttribute(tag, "name") ?? readHtmlAttribute(tag, "property");

    if (name === expectedName) {
      return readHtmlAttribute(tag, "content");
    }
  }

  return null;
}

function readHtmlAttribute(tag: string, attributeName: string) {
  const attributePattern = new RegExp(`\\s${escapeRegExp(attributeName)}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(attributePattern);
  return decodeHtmlEntities(match?.[2] ?? match?.[3] ?? match?.[4] ?? "");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSetCookies(headers: Headers) {
  const headersWithSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headersWithSetCookie.getSetCookie?.();

  if (setCookies?.length) {
    return setCookies;
  }

  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

function splitSetCookieHeader(value: string) {
  return value
    .split(/,(?=\s*[^;,]+=)/g)
    .map((cookie) => cookie.trim())
    .filter(Boolean);
}

function mergeSetCookies(cookieJar: Map<string, string>, setCookies: string[]) {
  for (const setCookie of setCookies) {
    const [nameValue] = setCookie.split(";");
    const separatorIndex = nameValue?.indexOf("=") ?? -1;

    if (!nameValue || separatorIndex <= 0) {
      continue;
    }

    const name = nameValue.slice(0, separatorIndex).trim();
    const value = nameValue.slice(separatorIndex + 1).trim();

    if (name && value) {
      cookieJar.set(name, value);
    }
  }
}

function serializeCookies(cookieJar: Map<string, string>) {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
