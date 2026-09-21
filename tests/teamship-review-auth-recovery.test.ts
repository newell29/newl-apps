import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";

const credentials = {
  email: "reviewer@example.com",
  password: "synthetic-password",
  apiBaseUrl: "https://teamship.test/api"
};
const rows = [0, 1, 2].map((index) => ({
  id: 41 + index,
  record_no: `PS${123456 + index}`,
  shipment_id: `SR${812345 + index}`,
  ship_city: "SYNTHETIC CITY",
  ship_state: "ON",
  ship_zip: "A1A 1A1",
  items: [{ sku: "SYNTHETIC-SKU", serial_number: "SYNTHETIC-SERIAL" }]
}));
const orderReferences = rows.map((row) => ({ psNumber: row.record_no, srNumber: row.shipment_id }));

function mockTeamship(options: {
  source?: "active" | "legacy" | "archive";
  failedOrderIndex?: number;
  permanentReadStatus?: number;
  rejectRefresh?: boolean;
  rejectInitialLogin?: boolean;
  expireListToken?: boolean;
} = {}) {
  let loginCount = 0;
  let legacyListCount = 0;
  const detailReads: Array<{ id: number; token: string | null }> = [];
  const listTokens: Array<string | null> = [];
  const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const token = new Headers(init?.headers).get("authorization");
    if (url.pathname === "/api/v1/login" && method === "POST") {
      loginCount += 1;
      if (options.rejectInitialLogin || (options.rejectRefresh && loginCount > 1)) {
        return Response.json({ message: "Unauthorized" }, { status: 401 });
      }
      return Response.json({ data: { token: `synthetic-token-${loginCount}` } });
    }
    if (url.pathname === "/login" && method === "GET") {
      return new Response('<input name="_token" value="synthetic-csrf">', {
        headers: { "set-cookie": "session=synthetic; Path=/" }
      });
    }
    if (url.pathname === "/login" && method === "POST") {
      return new Response("", { status: 302, headers: { "set-cookie": "session=synthetic-authenticated; Path=/" } });
    }
    if (url.pathname === "/ship-inventories" && method === "GET") {
      return new Response('<meta name="csrf-token" content="synthetic-authenticated-csrf">');
    }
    if (url.pathname === "/api/ship-inventories/dashboard" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      if (options.source === "legacy") return Response.json({}, { status: 503 });
      const statusSearch = options.source === "archive" ? "shipped" : "requested";
      return Response.json({ result: body.statusSearch === statusSearch && body.skip === 0 ? rows : [] });
    }
    if (url.pathname === "/api/v1/ship-inventories" && method === "GET") {
      legacyListCount += 1;
      listTokens.push(token);
      if (options.expireListToken && token === "Bearer synthetic-token-1") {
        return Response.json({}, { status: 401 });
      }
      return Response.json({ data: url.searchParams.get("offset") === "0" ? rows : [] });
    }
    const detail = url.pathname.match(/^\/api\/v1\/ship-inventories\/(\d+)$/);
    if (detail && method === "GET") {
      const id = Number(detail[1]);
      detailReads.push({ id, token });
      if (id === rows[options.failedOrderIndex ?? 1].id && !options.expireListToken) {
        if (options.permanentReadStatus || token === "Bearer synthetic-token-1") {
          return Response.json({}, { status: options.permanentReadStatus ?? 401 });
        }
      }
      return Response.json({ data: rows.find((row) => row.id === id) });
    }
    // Any shipment write or unexpected request fails the test.
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  return {
    fetchImpl: fetchMock as unknown as typeof fetch,
    detailReads,
    listTokens,
    loginCount: () => loginCount,
    legacyListCount: () => legacyListCount
  };
}

describe("Garland Teamship review authentication recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["active", "legacy", "archive"] as const)(
    "renews a rejected detail token in the %s lookup and retains earlier evidence",
    async (source) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const mock = mockTeamship({ source });
      const result = await fetchTeamshipShippingOrdersForReview({
        tenantId: "synthetic-tenant",
        credentials,
        orderReferences,
        includeCompletedArchive: source === "archive",
        fetchImpl: mock.fetchImpl
      });
      expect(result.map((row) => row.record_no)).toEqual(rows.map((row) => row.record_no));
      expect(mock.loginCount()).toBe(2);
      expect(mock.detailReads).toEqual([
        { id: 41, token: "Bearer synthetic-token-1" },
        { id: 42, token: "Bearer synthetic-token-1" },
        { id: 42, token: "Bearer synthetic-token-2" },
        { id: 43, token: "Bearer synthetic-token-2" }
      ]);
      expect(mock.legacyListCount()).toBe(source === "legacy" ? 1 : 0);
    }
  );

  it("renews a rejected fallback-list token and uses it for subsequent detail reads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mock = mockTeamship({ source: "legacy", expireListToken: true });
    const result = await fetchTeamshipShippingOrdersForReview({ credentials, orderReferences, fetchImpl: mock.fetchImpl });
    expect(result).toHaveLength(3);
    expect(mock.loginCount()).toBe(2);
    expect(mock.listTokens).toEqual(["Bearer synthetic-token-1", "Bearer synthetic-token-2"]);
    expect(mock.detailReads).toEqual(rows.map((row) => ({ id: row.id, token: "Bearer synthetic-token-2" })));
  });

  it.each([0, 1])("stops after a second 401 with %i earlier matches instead of returning missing or partial results", async (failedOrderIndex) => {
    const mock = mockTeamship({ failedOrderIndex, permanentReadStatus: 401 });
    await expect(fetchTeamshipShippingOrdersForReview({ credentials, orderReferences, fetchImpl: mock.fetchImpl }))
      .rejects.toThrow("Teamship API read remained unauthorized after one authentication refresh.");
    expect(mock.loginCount()).toBe(2);
    expect(mock.detailReads.filter((read) => read.id === rows[failedOrderIndex].id)).toHaveLength(2);
    expect(mock.legacyListCount()).toBe(0);
  });

  it("does not hide a completed-archive authentication failure as a missing order", async () => {
    const mock = mockTeamship({ source: "archive", permanentReadStatus: 401 });
    await expect(fetchTeamshipShippingOrdersForReview({ credentials, orderReferences, includeCompletedArchive: true, fetchImpl: mock.fetchImpl }))
      .rejects.toThrow("Teamship API read remained unauthorized after one authentication refresh.");
    expect(mock.loginCount()).toBe(2);
    expect(mock.legacyListCount()).toBe(0);
  });

  it("stops immediately on a forbidden read without renewing or falling back", async () => {
    const mock = mockTeamship({ permanentReadStatus: 403 });
    await expect(fetchTeamshipShippingOrdersForReview({ credentials, orderReferences, fetchImpl: mock.fetchImpl }))
      .rejects.toThrow("Teamship API read was forbidden (403).");
    expect(mock.loginCount()).toBe(1);
    expect(mock.legacyListCount()).toBe(0);
  });

  it("stops when the authentication refresh is rejected", async () => {
    const mock = mockTeamship({ rejectRefresh: true });
    await expect(fetchTeamshipShippingOrdersForReview({ credentials, orderReferences, fetchImpl: mock.fetchImpl }))
      .rejects.toThrow("Teamship login failed with status 401");
    expect(mock.loginCount()).toBe(2);
    expect(mock.legacyListCount()).toBe(0);
  });

  it("does not retry rejected initial login credentials", async () => {
    const mock = mockTeamship({ rejectInitialLogin: true });
    await expect(fetchTeamshipShippingOrdersForReview({ credentials, orderReferences, fetchImpl: mock.fetchImpl }))
      .rejects.toThrow("Teamship login failed with status 401");
    expect(mock.loginCount()).toBe(1);
    expect(mock.detailReads).toHaveLength(0);
  });
});
