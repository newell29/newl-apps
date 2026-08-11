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
});
