import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";

type TeamshipDashboardRequestBody = {
  requiresCounts: boolean;
  search: Array<{
    fields: string[];
    operator: string;
    key: string;
    ignoreCase: boolean;
  }>;
  skip: number;
  take: number;
  statusSearch: string;
};

function readTeamshipDashboardRequestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as TeamshipDashboardRequestBody;
}

describe("targeted Teamship pagination", () => {
  afterEach(() => {
    delete process.env.TEAMSHIP_EMAIL;
    delete process.env.TEAMSHIP_PASSWORD;
    delete process.env.TEAMSHIP_API_BASE_URL;
    delete process.env.TEAMSHIP_LIST_PAGE_LIMIT;
    delete process.env.TEAMSHIP_MAX_LIST_PAGES;
    delete process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES;
    vi.restoreAllMocks();
  });

  it("extends only exact PS/SR lookups beyond the ordinary daily-list page ceiling", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_LIST_PAGE_LIMIT = "2";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "2";
    process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES = "3";

    const requestedOffsets: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        const offset = new URL(url).searchParams.get("offset") ?? "";
        requestedOffsets.push(offset);
        return Response.json({
          data:
            offset === "4"
              ? [{ id: 14, record_no: "PS123456", shipment_id: "SR812345" }]
              : [
                  { id: `${offset}-1`, record_no: "PS123450" },
                  { id: `${offset}-2`, record_no: "PS123451" }
                ]
        });
      }

      if (url.endsWith("/v1/ship-inventories/14")) {
        return Response.json({
          data: { id: 14, record_no: "PS123456", shipment_id: "SR812345" }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [{ srNumber: "SR812345", psNumber: "PS123456" }],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(requestedOffsets).toEqual(["0", "2", "4"]);
    expect(orders).toEqual([
      expect.objectContaining({ shipment_id: "SR812345", record_no: "PS123456" })
    ]);
  });

  it("falls back to the signed-in completed-order archive for an exact missing PS/SR lookup", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_LIST_PAGE_LIMIT = "2";
    process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES = "2";

    const archiveOffsets: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        return Response.json({ data: [] });
      }

      if (url.endsWith("/login") && (init?.method ?? "GET") === "GET") {
        return new Response('<input type="hidden" name="_token" value="csrf-synthetic">', {
          headers: { "set-cookie": "teamship_session=before-login; Path=/" }
        });
      }

      if (url.endsWith("/login") && init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { "set-cookie": "teamship_session=after-login; Path=/" }
        });
      }

      if (url.endsWith("/api/ship-inventories/dashboard")) {
        const requestBody = readTeamshipDashboardRequestBody(init);
        if (requestBody.statusSearch === "requested") {
          return Response.json({ result: [], count: 0 });
        }
        archiveOffsets.push(String(requestBody.skip));
        expect(init?.method).toBe("POST");
        expect(requestBody.statusSearch).toBe("shipped");
        expect(requestBody.take).toBe(2);
        expect(requestBody.search).toEqual([
          {
            fields: [],
            operator: "contains",
            key: "Garland Canada Distribution",
            ignoreCase: true
          }
        ]);
        expect(init?.headers).toMatchObject({
          accept: "application/json",
          "content-type": "application/json",
          cookie: "teamship_session=after-login",
          "x-csrf-token": "csrf-synthetic"
        });

        return Response.json({
          result:
            requestBody.skip === 2
              ? [{ id: 42, record_no: "PS123456", shipment_id: "SR812345", status: "Complete" }]
              : [
                  { id: 40, record_no: "PS123450", shipment_id: "SR812340" },
                  { id: 41, record_no: "PS123451", shipment_id: "SR812341" }
                ],
          count: 3
        });
      }

      if (url.endsWith("/api/v1/ship-inventories/42")) {
        return Response.json({
          data: {
            id: 42,
            record_no: "PS123456",
            shipment_id: "SR812345",
            ship_city: "SYNTHETIC CITY",
            ship_state: "ON",
            ship_zip: "A1A 1A1",
            items: [{ sku: "SYNTHETIC-SKU", serial_number: "9900000000012" }]
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [{ srNumber: "SR812345", psNumber: "PS123456" }],
      includeCompletedArchive: true,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(archiveOffsets).toEqual(["0", "2"]);
    expect(orders).toEqual([
      expect.objectContaining({
        teamship_internal_id: "42",
        shipment_id: "SR812345",
        record_no: "PS123456",
        status: "Complete"
      })
    ]);
  });

  it("uses Teamship's server-side active Garland search instead of scanning the full active API", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_LIST_PAGE_LIMIT = "500";
    process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES = "100";

    const dashboardStatuses: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.endsWith("/login") && (init?.method ?? "GET") === "GET") {
        return new Response('<input type="hidden" name="_token" value="csrf-synthetic">', {
          headers: { "set-cookie": "teamship_session=before-login; Path=/" }
        });
      }

      if (url.endsWith("/login") && init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { "set-cookie": "teamship_session=after-login; Path=/" }
        });
      }

      if (url.endsWith("/api/ship-inventories/dashboard")) {
        const requestBody = readTeamshipDashboardRequestBody(init);
        dashboardStatuses.push(requestBody.statusSearch);
        expect(init?.method).toBe("POST");
        expect(requestBody).toMatchObject({
          requiresCounts: true,
          skip: 0,
          take: 100,
          statusSearch: "requested"
        });
        expect(requestBody.search).toEqual([
          {
            fields: [],
            operator: "contains",
            key: "Garland Canada Distribution",
            ignoreCase: true
          }
        ]);
        return Response.json({
          result: [{ id: 61, record_no: "PS123456", shipment_id: "SR812345", status: "Open" }],
          count: 1
        });
      }

      if (url.endsWith("/api/v1/ship-inventories/61")) {
        return Response.json({
          data: {
            id: 61,
            record_no: "PS123456",
            shipment_id: "SR812345",
            ship_city: "SYNTHETIC CITY",
            ship_state: "ON",
            ship_zip: "A1A 1A1",
            items: [{ sku: "SYNTHETIC-SKU", serial_number: "9900000000012" }]
          }
        });
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        throw new Error("The full active API must not be scanned after the dashboard search succeeds.");
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [{ srNumber: "SR812345", psNumber: "PS123456" }],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(dashboardStatuses).toEqual(["requested"]);
    expect(orders).toEqual([
      expect.objectContaining({ shipment_id: "SR812345", record_no: "PS123456" })
    ]);
  });

  it("caps the legacy targeted active API fallback at exactly 1,000 rows", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_LIST_PAGE_LIMIT = "400";
    process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES = "100";

    const requestedPages: Array<{ limit: string; offset: string }> = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.endsWith("/login")) {
        throw new Error("Synthetic dashboard outage");
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        const requestUrl = new URL(url);
        const limit = requestUrl.searchParams.get("limit") ?? "";
        const offset = requestUrl.searchParams.get("offset") ?? "";
        requestedPages.push({ limit, offset });
        return Response.json({
          data: Array.from({ length: Number(limit) }, (_, index) => ({
            id: `synthetic-${offset}-${index}`,
            record_no: "PS123450",
            shipment_id: "SR812340"
          }))
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [{ srNumber: "SR812345", psNumber: "PS123456" }],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(requestedPages).toEqual([
      { limit: "400", offset: "0" },
      { limit: "400", offset: "400" },
      { limit: "200", offset: "800" }
    ]);
    expect(orders).toEqual([]);
  });

  it("preserves a partial exact result when the completed-order archive lookup fails", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 51, record_no: "PS123456", shipment_id: "SR812345" }]
        });
      }

      if (url.endsWith("/api/v1/ship-inventories/51")) {
        return Response.json({
          data: {
            id: 51,
            record_no: "PS123456",
            shipment_id: "SR812345",
            ship_city: "SYNTHETIC CITY",
            ship_state: "ON",
            ship_zip: "A1A 1A1",
            items: [{ sku: "SYNTHETIC-SKU", serial_number: "9900000000012" }]
          }
        });
      }

      if (url.endsWith("/login") && (init?.method ?? "GET") === "GET") {
        return new Response('<input type="hidden" name="_token" value="csrf-synthetic">', {
          headers: { "set-cookie": "teamship_session=before-login; Path=/" }
        });
      }

      if (url.endsWith("/login") && init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { "set-cookie": "teamship_session=after-login; Path=/" }
        });
      }

      if (url.endsWith("/api/ship-inventories/dashboard")) {
        return Response.json({ message: "temporary archive failure" }, { status: 503 });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [
        { srNumber: "SR812345", psNumber: "PS123456" },
        { srNumber: "SR812346", psNumber: "PS123457" }
      ],
      includeCompletedArchive: true,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toEqual([
      expect.objectContaining({ shipment_id: "SR812345", record_no: "PS123456" })
    ]);
  });

  it("returns no false matches when both active and completed Teamship sources are empty", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        return Response.json({ data: [] });
      }

      if (url.endsWith("/login") && (init?.method ?? "GET") === "GET") {
        return new Response('<input type="hidden" name="_token" value="csrf-synthetic">', {
          headers: { "set-cookie": "teamship_session=before-login; Path=/" }
        });
      }

      if (url.endsWith("/login") && init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { "set-cookie": "teamship_session=after-login; Path=/" }
        });
      }

      if (url.endsWith("/api/ship-inventories/dashboard")) {
        return Response.json({ result: [], count: 0 });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [{ srNumber: "SR812345", psNumber: "PS123456" }],
      includeCompletedArchive: true,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toEqual([]);
  });

  it("does not consult completed Teamship orders during the ordinary automatic review", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_TARGETED_MAX_LIST_PAGES = "1";

    const dashboardStatuses: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.endsWith("/login") && (init?.method ?? "GET") === "GET") {
        return new Response('<input type="hidden" name="_token" value="csrf-synthetic">', {
          headers: { "set-cookie": "teamship_session=before-login; Path=/" }
        });
      }

      if (url.endsWith("/login") && init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { "set-cookie": "teamship_session=after-login; Path=/" }
        });
      }

      if (url.endsWith("/api/ship-inventories/dashboard")) {
        const requestBody = readTeamshipDashboardRequestBody(init);
        dashboardStatuses.push(requestBody.statusSearch);
        return Response.json({ result: [], count: 0 });
      }

      throw new Error(`Unexpected ordinary-review request: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [{ srNumber: "SR812345", psNumber: "PS123456" }],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toEqual([]);
    expect(dashboardStatuses).toEqual(["requested"]);
  });
});
