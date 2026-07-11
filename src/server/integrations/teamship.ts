import type {
  TeamshipShippingOrderDetail,
  TeamshipShippingOrderSummary
} from "@/modules/shipment-documents/teamship-review-types";

const DEFAULT_TEAMSHIP_API_BASE_URL = "https://app.teamshipos.com/api";
const DEFAULT_PAGE_LIMIT = 500;
const DEFAULT_MAX_PAGES = 12;

type TeamshipFetchOptions = {
  shipmentDate?: string | null;
  srNumbers?: string[];
  fetchImpl?: typeof fetch;
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

export function isTeamshipConfigured() {
  return Boolean(getTeamshipEmail() && getTeamshipPassword());
}

export function getTeamshipConfigurationStatus() {
  return {
    configured: isTeamshipConfigured(),
    apiBaseUrl: getTeamshipApiBaseUrl(),
    missing: [getTeamshipEmail() ? null : "TEAMSHIP_EMAIL", getTeamshipPassword() ? null : "TEAMSHIP_PASSWORD"].filter(
      Boolean
    ) as string[]
  };
}

export async function fetchTeamshipShippingOrdersForReview({
  shipmentDate,
  srNumbers = [],
  fetchImpl = fetch
}: TeamshipFetchOptions): Promise<TeamshipShippingOrderDetail[]> {
  const token = await loginToTeamship(fetchImpl);
  const targetSrNumbers = new Set(srNumbers.map(normalizeIdentifier).filter(Boolean));
  const details = new Map<string, TeamshipShippingOrderDetail>();
  const pageLimit = getTeamshipPageLimit();
  const maxPages = getTeamshipMaxPages();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const offset = pageIndex * pageLimit;
    const rows = await listTeamshipShippingOrders({ token, limit: pageLimit, offset, fetchImpl });

    for (const row of rows) {
      const shipmentId = normalizeIdentifier(row.shipment_id);
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

      const detail = await getTeamshipShippingOrder({ token, id: String(orderId), fetchImpl });
      const detailShipmentId = normalizeIdentifier(detail.shipment_id ?? row.shipment_id);
      details.set(detailShipmentId || String(orderId), detail);
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

async function loginToTeamship(fetchImpl: typeof fetch) {
  const email = getTeamshipEmail();
  const password = getTeamshipPassword();

  if (!email || !password) {
    throw new Error("Teamship credentials are not configured. Add TEAMSHIP_EMAIL and TEAMSHIP_PASSWORD.");
  }

  const response = await fetchImpl(`${getTeamshipApiBaseUrl()}/v1/login`, {
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
  token,
  limit,
  offset,
  fetchImpl
}: {
  token: string;
  limit: number;
  offset: number;
  fetchImpl: typeof fetch;
}) {
  const url = new URL(`${getTeamshipApiBaseUrl()}/v1/ship-inventories`);
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
  token,
  id,
  fetchImpl
}: {
  token: string;
  id: string;
  fetchImpl: typeof fetch;
}) {
  const response = await fetchImpl(`${getTeamshipApiBaseUrl()}/v1/ship-inventories/${encodeURIComponent(id)}`, {
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

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
