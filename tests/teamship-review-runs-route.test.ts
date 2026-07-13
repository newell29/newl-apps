import { describe, expect, it, vi } from "vitest";

import type { GarlandTeamshipReviewResponse, TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";

const saveTeamshipReviewRunMock = vi.hoisted(() => vi.fn());
const getTeamshipReviewHistoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    role: "OPERATIONS",
    tenantSlug: "newl",
    tenantName: "Newl"
  }))
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: vi.fn(async () => undefined),
  requireMutationAccess: vi.fn(async () => undefined)
}));

vi.mock("@/modules/shipment-documents/teamship-review-history", () => ({
  getTeamshipReviewHistory: getTeamshipReviewHistoryMock,
  saveTeamshipReviewRun: saveTeamshipReviewRunMock
}));

import { POST } from "@/app/api/shipment-documents/teamship-review/runs/route";

describe("Teamship review runs route", () => {
  it("saves a Teamship-only queue before Garland PDFs arrive", async () => {
    getTeamshipReviewHistoryMock.mockResolvedValue({
      runs: [],
      totalCount: 0,
      search: "",
      dateFrom: "2026-07-12",
      dateTo: "2026-07-12",
      allDates: false
    });

    const response = await POST(
      new Request("https://newl.test/api/shipment-documents/teamship-review/runs", {
        method: "POST",
        body: JSON.stringify({
          documentLabel: "July 12 Teamship queue",
          shipmentDate: "2026-07-12",
          teamshipOrders: [sampleTeamshipOrder()]
        })
      })
    );

    expect(response.status).toBe(201);
    expect(saveTeamshipReviewRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentLabel: "July 12 Teamship queue",
        sourcePdfFileName: null,
        review: expect.objectContaining({
          summary: expect.objectContaining({
            pdfOrderCount: 0,
            noPdfCount: 1
          }),
          reviews: [
            expect.objectContaining({
              srNumber: "SR808478",
              status: "NO_PDF",
              teamshipOrderId: "30202"
            })
          ]
        } satisfies Partial<GarlandTeamshipReviewResponse>)
      })
    );
  });
});

function sampleTeamshipOrder(): TeamshipShippingOrderDetail {
  return {
    id: "30202",
    shipment_id: "SR808478",
    record_no: "PS210206",
    carrier_value: "MIDLAND",
    poNumber: "0000037656",
    ship_to_name: "J.R. MAHONEY LTD.",
    ship_to_city: "SYDNEY",
    ship_to_state: "NS",
    url: "https://app.teamshipos.com/ship-inventories/30202"
  };
}
