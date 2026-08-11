import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";

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

      if (url.includes("/api/ship-inventories/dashboard?")) {
        const requestUrl = new URL(url);
        archiveOffsets.push(requestUrl.searchParams.get("skip") ?? "");
        expect(requestUrl.searchParams.get("statusSearch")).toBe("shipped");
        expect(requestUrl.searchParams.get("take")).toBe("2");
        expect(JSON.parse(requestUrl.searchParams.get("search") ?? "[]")).toEqual([
          {
            fields: [],
            operator: "contains",
            key: "Garland Canada Distribution",
            ignoreCase: true
          }
        ]);
        expect(init?.headers).toMatchObject({
          cookie: "teamship_session=after-login",
          "x-csrf-token": "csrf-synthetic"
        });

        return Response.json({
          result:
            requestUrl.searchParams.get("skip") === "2"
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

      if (url.includes("/api/ship-inventories/dashboard?")) {
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

      if (url.includes("/api/ship-inventories/dashboard?")) {
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

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "synthetic-token" } });
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        return Response.json({ data: [] });
      }

      throw new Error(`Ordinary review must not consult the completed archive: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      orderReferences: [{ srNumber: "SR812345", psNumber: "PS123456" }],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
