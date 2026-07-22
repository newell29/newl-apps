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

  it("uses the signed-in Teamship page when exact API detail omits pallets", async () => {
    vi.stubEnv("TEAMSHIP_MAX_LIST_PAGES", "1");
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "test-token" } });
      }
      if (url.includes("/api/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 31064, order_number: "30666", pallet_dims: [{ quantity: 2 }] }]
        });
      }
      if (url.endsWith("/api/v1/ship-inventories/31064")) {
        return Response.json({ data: { id: 31064 } });
      }
      if (url.endsWith("/login") && (init?.method ?? "GET") === "GET") {
        return new Response('<input type="hidden" name="_token" value="csrf-1">', {
          headers: { "set-cookie": "teamship_session=before-login; Path=/" }
        });
      }
      if (url.endsWith("/login") && init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { "set-cookie": "teamship_session=after-login; Path=/" }
        });
      }
      if (url.endsWith("/ship-inventories/31064")) {
        expect(init?.headers).toMatchObject({ cookie: "teamship_session=after-login" });
        return new Response(`
          <input type="hidden" id="pallets_count" value="1">
          <input id="pallet_1" value="1">
          <input id="pallet_1_length" value="48">
          <input id="pallet_1_width" value="40">
          <input id="pallet_1_height" value="40">
          <input id="pallet_1_weight" value="250">
        `);
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
      pallets: [expect.objectContaining({ quantity: "1" })],
      pallet_dims: [expect.objectContaining({ quantity: "1" })]
    })]);
  });

  it("does not reuse stale summary pallets when authoritative detail is unavailable", async () => {
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
        return Response.json({ data: { id: 31064 } });
      }
      throw new Error(`Teamship UI unavailable: ${url}`);
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
      pallets: [],
      pallet_dims: []
    })]);
  });
});
