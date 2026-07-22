import { afterEach, describe, expect, it, vi } from "vitest";

import { findTeamshipShippingOrders } from "@/server/integrations/teamship";

describe("Teamship shipping-order search identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves the internal API/page ID separately from the employee-facing order number", async () => {
    vi.stubEnv("TEAMSHIP_MAX_LIST_PAGES", "1");
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        return Response.json({ data: { token: "test-token" } });
      }
      if (url.includes("/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 31064, order_number: "30666", pallet_dims: [{ quantity: 2 }] }]
        });
      }
      if (url.endsWith("/v1/ship-inventories/31064")) {
        return Response.json({ data: { id: 31064, pallets: [{ quantity: 1 }] } });
      }
      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await findTeamshipShippingOrders({
      orderIdentifier: "30666",
      credentials: {
        email: "employee@example.com",
        password: "not-a-live-password",
        apiBaseUrl: "https://members.fulfillit.io/api"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toEqual([expect.objectContaining({
      id: 31064,
      order_number: "30666",
      teamship_internal_id: "31064",
      url: "https://members.fulfillit.io/ship-inventories/31064",
      pallets: [{ quantity: 1 }],
      pallet_dims: [{ quantity: 1 }]
    })]);
  });
});
