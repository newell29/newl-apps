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
  orderReferences?: TeamshipOrderReference[];
  credentials?: TeamshipRuntimeCredentials | null;
  fetchImpl?: typeof fetch;
};

type TeamshipOrderReference = {
  srNumber?: string | null;
  psNumber?: string | null;
};

type NormalizedTeamshipOrderReference = {
  key: string;
  srNumber: string;
  psNumber: string;
};

type TeamshipShippingOrderSearchOptions = {
  tenantId?: string | null;
  orderIdentifier: string;
  preferUiPallets?: boolean;
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
  customer_id?: number | string | null;
  user_id?: number | string | null;
  customer_name?: string | null;
  company?: string | null;
  warehouse_id?: number | string | null;
  warehouse_name?: string | null;
  location_id?: number | string | null;
  location_name?: string | null;
  lpn?: string | null;
  lpn_id?: number | string | null;
  lpn_name?: string | null;
  serial?: string | null;
  serial_number?: string | null;
  quantity?: number | string | null;
  available?: number | string | null;
  available_quantity?: number | string | null;
  reserved?: number | string | null;
  reserved_quantity?: number | string | null;
  on_hand?: number | string | null;
  on_hand_quantity?: number | string | null;
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
  orderReferences = [],
  credentials = null,
  fetchImpl = fetch
}: TeamshipFetchOptions): Promise<TeamshipShippingOrderDetail[]> {
  const resolvedCredentials = credentials ?? (await resolveTenantTeamshipCredentials(tenantId ? { tenantId } : null));
  const apiBaseUrl = resolveTeamshipApiBaseUrl(resolvedCredentials);
  const webBaseUrl = resolveTeamshipWebBaseUrl(apiBaseUrl);
  const token = await loginToTeamship(fetchImpl, resolvedCredentials, apiBaseUrl);
  const targetOrderReferences = normalizeTeamshipOrderReferences(orderReferences, srNumbers);
  const shouldEnrichFromUiPage = targetOrderReferences.length > 0;
  const matchedTargetReferenceKeys = new Set<string>();
  let webCookieHeader: string | null | undefined;
  const details = new Map<string, TeamshipShippingOrderDetail>();
  const pageLimit = getTeamshipPageLimit();
  const maxPages = getTeamshipMaxPages();
  const seenPageFingerprints = new Set<string>();
  let offset = 0;
  let scannedRowCount = 0;
  let stopReason: "ALL_MATCHES_FOUND" | "EMPTY_PAGE" | "REPEATED_PAGE" | "MAX_PAGES" = "MAX_PAGES";

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const rows = await listTeamshipShippingOrders({ apiBaseUrl, token, limit: pageLimit, offset, fetchImpl });
    if (rows.length === 0) {
      stopReason = "EMPTY_PAGE";
      break;
    }

    const pageFingerprint = buildTeamshipListPageFingerprint(rows);
    if (seenPageFingerprints.has(pageFingerprint)) {
      stopReason = "REPEATED_PAGE";
      break;
    }
    seenPageFingerprints.add(pageFingerprint);
    scannedRowCount += rows.length;

    for (const row of rows) {
      const matchingTargetReferences = targetOrderReferences.filter(
        (reference) =>
          !matchedTargetReferenceKeys.has(reference.key) &&
          teamshipOrderMatchesReference(row, reference)
      );
      const shouldFetchByReference = matchingTargetReferences.length > 0;
      const shouldFetchByDailyGarland =
        targetOrderReferences.length === 0 &&
        isGarlandOrder(row) &&
        (!shipmentDate || hasMatchingDate(row, shipmentDate));

      if (!shouldFetchByReference && !shouldFetchByDailyGarland) {
        continue;
      }

      const orderId = row.id ?? row.order_id;
      if (!orderId) {
        continue;
      }

      const detail = await getTeamshipShippingOrder({ apiBaseUrl, token, id: String(orderId), fetchImpl });
      let mergedDetail = mergeTeamshipDetailWithSummary(detail, row);
      mergedDetail = {
        ...mergedDetail,
        teamship_internal_id: String(orderId),
        url: buildTeamshipOrderUrl(webBaseUrl, String(orderId))
      };

      const confirmedTargetReferenceCandidates = shouldFetchByReference
        ? matchingTargetReferences.filter((reference) =>
            teamshipOrderMatchesReference(mergedDetail, reference)
          )
        : [];
      const confirmedTargetReferences =
        confirmedTargetReferenceCandidates.length === 1
          ? confirmedTargetReferenceCandidates
          : [];
      if (shouldFetchByReference && confirmedTargetReferences.length === 0) {
        continue;
      }

      if (
        shouldEnrichFromUiPage &&
        (!hasTeamshipSerialEvidence(mergedDetail) || hasIncompleteTeamshipShipToEvidence(mergedDetail))
      ) {
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
      const detailKey =
        confirmedTargetReferences[0]?.key || detailShipmentId || String(orderId);
      details.set(detailKey, mergedDetail);
      for (const reference of confirmedTargetReferences) {
        matchedTargetReferenceKeys.add(reference.key);
      }
    }

    if (
      targetOrderReferences.length > 0 &&
      matchedTargetReferenceKeys.size === targetOrderReferences.length
    ) {
      stopReason = "ALL_MATCHES_FOUND";
      break;
    }

    // Teamship may return fewer rows than the requested limit even when another
    // page exists. Advance by the number actually returned instead of assuming
    // the requested limit was honoured, otherwise exact PS/SR matches can be
    // skipped or the first capped page can be mistaken for the end of the list.
    offset += rows.length;
  }

  if (targetOrderReferences.length > 0 && matchedTargetReferenceKeys.size === 0) {
    console.warn("Teamship targeted order lookup returned no exact matches.", {
      requestedReferenceCount: targetOrderReferences.length,
      requestedPageLimit: pageLimit,
      configuredMaxPages: maxPages,
      scannedPageCount: seenPageFingerprints.size,
      scannedRowCount,
      stopReason
    });
  }

  return Array.from(details.values());
}

function buildTeamshipListPageFingerprint(rows: TeamshipShippingOrderSummary[]) {
  return rows
    .map((row, index) => {
      const rowId = row.id ?? row.order_id;
      if (rowId !== null && rowId !== undefined && String(rowId).trim()) {
        return `ID:${String(rowId).trim()}`;
      }

      return [
        `ROW:${index}`,
        normalizeTeamshipPsNumber(row),
        normalizeTeamshipShipmentId(row),
        String(row.created_at ?? "")
      ].join(":");
    })
    .join("|");
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

export async function findTeamshipShippingOrders({
  tenantId,
  orderIdentifier,
  preferUiPallets = false,
  credentials = null,
  fetchImpl = fetch
}: TeamshipShippingOrderSearchOptions): Promise<TeamshipShippingOrderDetail[]> {
  const resolvedCredentials = credentials ?? (await resolveTenantTeamshipCredentials(tenantId ? { tenantId } : null));
  const apiBaseUrl = resolveTeamshipApiBaseUrl(resolvedCredentials);
  const webBaseUrl = resolveTeamshipWebBaseUrl(apiBaseUrl);
  const token = await loginToTeamship(fetchImpl, resolvedCredentials, apiBaseUrl);
  const normalizedTarget = normalizeIdentifier(orderIdentifier);
  const matches: TeamshipShippingOrderDetail[] = [];
  const pageLimit = getTeamshipPageLimit();
  const maxPages = getTeamshipMaxPages();
  let webCookieHeader: string | null | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const rows = await listTeamshipShippingOrders({
      apiBaseUrl,
      token,
      limit: pageLimit,
      offset: pageIndex * pageLimit,
      fetchImpl
    });

    for (const row of rows) {
      if (!teamshipOrderIdentifiers(row).includes(normalizedTarget)) {
        continue;
      }

      const id = row.id ?? row.order_id;
      if (!id) {
        continue;
      }

      const detail = await getTeamshipShippingOrder({ apiBaseUrl, token, id: String(id), fetchImpl });
      const merged = mergeTeamshipDetailWithSummary(detail, row);
      const apiPallets = readAuthoritativeTeamshipPallets(detail);
      let uiPallets: ReturnType<typeof readAuthoritativeTeamshipPallets> = undefined;

      if (preferUiPallets || !apiPallets) {
        if (webCookieHeader === undefined) {
          webCookieHeader = await loginToTeamshipWeb(fetchImpl, resolvedCredentials, webBaseUrl).catch(() => null);
        }

        if (webCookieHeader) {
          const uiDetail = await getTeamshipShippingOrderUiDetail({
            webBaseUrl,
            webCookieHeader,
            id: String(id),
            fetchImpl
          }).catch(() => null);
          uiPallets = readAuthoritativeTeamshipPallets(uiDetail);
        }
      }

      const authoritativePallets = preferUiPallets
        ? uiPallets ?? apiPallets
        : apiPallets ?? uiPallets;

      matches.push({
        ...merged,
        // Never retain a list-summary pallet count when neither the exact API
        // detail nor the signed-in Teamship page confirms it.
        pallets: authoritativePallets ?? [],
        pallet_dims: authoritativePallets ?? [],
        teamship_internal_id: String(id),
        url: buildTeamshipOrderUrl(webBaseUrl, String(id))
      });
    }

    if (rows.length < pageLimit) {
      break;
    }
  }

  return matches;
}

function readAuthoritativeTeamshipPallets(detail: Partial<TeamshipShippingOrderDetail> | null) {
  if (!detail) return undefined;
  return [detail.pallets, detail.pallet_dims]
    .find((rows): rows is NonNullable<TeamshipShippingOrderDetail["pallet_dims"]> => Array.isArray(rows) && rows.length > 0);
}

function teamshipOrderIdentifiers(order: TeamshipShippingOrderDetail) {
  return [
    order.id,
    order.order_id,
    order.display_id,
    order.order_number,
    order.shipment_id,
    order.record_no
  ].flatMap((value) => {
    const normalized = normalizeIdentifier(value);
    return normalized ? [normalized] : [];
  });
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

function hasTeamshipSerialEvidence(value: unknown) {
  const visited = new Set<object>();

  const visit = (current: unknown, key = ""): boolean => {
    if (current === null || current === undefined) {
      return false;
    }

    if (typeof current === "string" || typeof current === "number") {
      const text = String(current).trim();

      if (!text || /^(?:n\/?a|none|null|blank|not available)$/i.test(text)) {
        return false;
      }

      return isSerialEvidenceKey(key) || /\b(?:serial|serial\s*number|sn)\s*[:#-]?\s*[A-Z0-9][A-Z0-9-]{5,}\b/i.test(text);
    }

    if (Array.isArray(current)) {
      return current.some((item) => visit(item, key));
    }

    if (typeof current === "object") {
      if (visited.has(current)) {
        return false;
      }

      visited.add(current);

      return Object.entries(current).some(([childKey, childValue]) => {
        if (isSensitiveTeamshipKey(childKey)) {
          return false;
        }

        return visit(childValue, childKey);
      });
    }

    return false;
  };

  return visit(value);
}

function hasIncompleteTeamshipShipToEvidence(order: TeamshipShippingOrderDetail) {
  const city = firstString([order.ship_to_city, order.ship_city]);
  const state = firstString([order.ship_to_state, order.ship_state]);
  const postalCode = firstString([order.ship_to_zip, order.ship_zip]);

  return !(city && state && postalCode);
}

function isSerialEvidenceKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();

  return normalized.includes("serial") || normalized === "sn";
}

function isSensitiveTeamshipKey(key: string) {
  const normalized = key.toLowerCase();

  return normalized.includes("password") || normalized.includes("token") || normalized.includes("secret");
}

export function parseTeamshipShippingOrderUiPage(html: string): Partial<TeamshipShippingOrderDetail> {
  const inventories = parseJsonArray(readHtmlFormValueById(html, "inventories_all"));
  const items = inventories
    .map(readTeamshipUiInventoryItem)
    .filter((item): item is NonNullable<ReturnType<typeof readTeamshipUiInventoryItem>> => Boolean(item));
  const pallets = readTeamshipUiPallets(html);
  const shipCity = readTeamshipUiFormValue(html, "ship_city");
  const shipState = readTeamshipUiFormValue(html, "ship_state");
  const shipZip = readTeamshipUiFormValue(html, "ship_zip");

  return {
    items,
    pallet_dims: pallets,
    ship_to_city: shipCity,
    ship_city: shipCity,
    ship_to_state: shipState,
    ship_state: shipState,
    ship_to_zip: shipZip,
    ship_zip: shipZip
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
    url: buildTeamshipOrderUrl(webBaseUrl, id)
  };
}

function buildTeamshipOrderUrl(webBaseUrl: string, id: string) {
  return `${webBaseUrl}/ship-inventories/${encodeURIComponent(id)}`;
}

function mergeTeamshipUiDetail(
  detail: TeamshipShippingOrderDetail,
  uiDetail: Partial<TeamshipShippingOrderDetail>
): TeamshipShippingOrderDetail {
  return {
    ...detail,
    ship_to_city: uiDetail.ship_to_city ?? detail.ship_to_city,
    ship_city: uiDetail.ship_city ?? detail.ship_city,
    ship_to_state: uiDetail.ship_to_state ?? detail.ship_to_state,
    ship_state: uiDetail.ship_state ?? detail.ship_state,
    ship_to_zip: uiDetail.ship_to_zip ?? detail.ship_to_zip,
    ship_zip: uiDetail.ship_zip ?? detail.ship_zip,
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
  const configuredWebBaseUrl = process.env.TEAMSHIP_APP_BASE_URL?.trim();
  if (configuredWebBaseUrl) {
    return configuredWebBaseUrl.replace(/\/+$/, "");
  }

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

function normalizeTeamshipPsNumber(order: TeamshipShippingOrderSummary) {
  const candidates = [order.record_no, order.edi_field_2, order.order_number, order.display_id];

  for (const candidate of candidates) {
    const match = String(candidate ?? "").match(/\bPS\d{6}\b/i);
    if (match?.[0]) {
      return normalizeIdentifier(match[0]);
    }
  }

  return "";
}

function normalizeTeamshipOrderReferences(
  orderReferences: TeamshipOrderReference[],
  legacySrNumbers: string[]
) {
  const references =
    orderReferences.length > 0
      ? orderReferences
      : legacySrNumbers.map((srNumber) => ({ srNumber, psNumber: null }));
  const normalized = new Map<string, NormalizedTeamshipOrderReference>();

  for (const reference of references) {
    const srNumber = normalizeIdentifier(reference.srNumber);
    const psNumber = normalizeExactTeamshipPsNumber(reference.psNumber);
    if (!srNumber && !psNumber) {
      continue;
    }

    const key = psNumber ? `PS:${psNumber}` : `SR:${srNumber}`;
    if (!normalized.has(key)) {
      normalized.set(key, { key, srNumber, psNumber });
    }
  }

  return Array.from(normalized.values());
}

function normalizeExactTeamshipPsNumber(value: unknown) {
  const match = String(value ?? "").trim().match(/^PS\d{6}$/i);
  return match?.[0] ? normalizeIdentifier(match[0]) : "";
}

function teamshipOrderMatchesReference(
  order: TeamshipShippingOrderSummary,
  reference: NormalizedTeamshipOrderReference
) {
  const orderPsNumber = normalizeTeamshipPsNumber(order);
  if (reference.psNumber && orderPsNumber) {
    return reference.psNumber === orderPsNumber;
  }

  const orderSrNumber = normalizeTeamshipShipmentId(order);
  return Boolean(reference.srNumber && orderSrNumber === reference.srNumber);
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
    const quantity = readHtmlFormValueById(html, `pallet_${index}`);
    const length = readHtmlFormValueById(html, `pallet_${index}_length`);
    const width = readHtmlFormValueById(html, `pallet_${index}_width`);
    const height = readHtmlFormValueById(html, `pallet_${index}_height`);
    const weight = readHtmlFormValueById(html, `pallet_${index}_weight`);
    const weightUnit = readHtmlFormValueById(html, `pallet_${index}_weight_unit`);
    const commodity = readHtmlFormValueById(html, `pallet_${index}_commodity`);
    const normalizedWeightUnit = String(weightUnit ?? "").trim().toLowerCase();
    const meaningfulWeightUnit = normalizedWeightUnit
      && !["lb", "lbs", "pound", "pounds"].includes(normalizedWeightUnit)
      ? weightUnit
      : null;
    const observedValues = [quantity, length, width, height, weight, meaningfulWeightUnit, commodity];

    if (!observedValues.some((value) => value && String(value).trim())) {
      continue;
    }

    const pallet = {
      quantity,
      length,
      width,
      height,
      weight,
      weight_unit: weightUnit ?? "lbs",
      commodity
    };

    pallets.push(pallet);
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

function readTeamshipUiFormValue(html: string, field: string) {
  return readHtmlFormValueByName(html, field) ?? readHtmlFormValueById(html, field);
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
