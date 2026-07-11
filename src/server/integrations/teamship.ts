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
  const token = await loginToTeamship(fetchImpl, resolvedCredentials, apiBaseUrl);
  const targetSrNumbers = new Set(srNumbers.map(normalizeIdentifier).filter(Boolean));
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
      const mergedDetail = mergeTeamshipDetailWithSummary(detail, row);
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

function getTeamshipApiBaseUrl() {
  return (process.env.TEAMSHIP_API_BASE_URL?.trim() || DEFAULT_TEAMSHIP_API_BASE_URL).replace(/\/+$/, "");
}

function resolveTeamshipApiBaseUrl(credentials: TeamshipRuntimeCredentials | null) {
  return (credentials?.apiBaseUrl?.trim() || getTeamshipApiBaseUrl()).replace(/\/+$/, "");
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
