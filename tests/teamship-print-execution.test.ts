import { describe, expect, it, vi } from "vitest";

import {
  assertTeamshipApiOrderIdentity,
  assertTeamshipPrintPageUrl,
  resolveExactPrinterOption,
  resolveTeamshipPrintAppBaseUrl
} from "@/modules/teamship/print-execution";
import type { ClaimedTeamshipPrintJob } from "@/modules/teamship/print-jobs";

describe("Teamship print execution safeguards", () => {
  it("opens the documented shipping-order detail host when no override is configured", () => {
    expect(resolveTeamshipPrintAppBaseUrl(undefined).origin).toBe("https://members.fulfillit.io");
    expect(resolveTeamshipPrintAppBaseUrl("  https://members.fulfillit.io  ").origin)
      .toBe("https://members.fulfillit.io");
  });

  it("uses the Teamship API only for approved order identity, not its stale pallet count", async () => {
    const job: ClaimedTeamshipPrintJob = {
      id: "print-job-1",
      shippingOrderNumber: "30666",
      teamshipOrderId: "31064",
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem",
      approvedPalletCount: 1,
      documentPlan: { pickingListCopies: 1, bolCopies: 1, outboundLabelCopies: 1 },
      printerPlan: {
        pickingList: { transport: "CUPS", queue: "_192_168_1_28", displayName: "192.168.1.28" },
        bol: { transport: "TEAMSHIP", exactName: "Office printer" },
        outboundLabels: { transport: "TEAMSHIP", exactName: "BIXOLON SRP-770III" }
      },
      credentials: { email: "employee@example.com", password: "test-password", apiBaseUrl: null }
    };
    const findOrders = vi.fn(async () => [{
      id: "30666",
      teamship_internal_id: "31064",
      url: "https://members.fulfillit.io/ship-inventories/31064",
      customer: { company: "Garland Canada Distribution" },
      warehouse_name: "Annagem",
      pallet_dims: [{ quantity: 1 }, { quantity: 1 }]
    }]);

    await expect(assertTeamshipApiOrderIdentity(job, findOrders)).resolves.toBeUndefined();
    expect(findOrders).toHaveBeenCalledWith({
      orderIdentifier: "30666",
      credentials: job.credentials
    });
  });

  it("accepts the exact internal page URL without relying on body innerText", () => {
    const target = new URL("https://members.fulfillit.io/ship-inventories/31064");
    expect(() => assertTeamshipPrintPageUrl(
      "https://members.fulfillit.io/ship-inventories/31064",
      target,
      "31064"
    )).not.toThrow();
    expect(() => assertTeamshipPrintPageUrl(
      "https://members.fulfillit.io/ship-inventories/31065",
      target,
      "31064"
    )).toThrow(/approved shipping order/i);
    expect(() => assertTeamshipPrintPageUrl(
      "https://members.fulfillit.io/ship-inventories/310640",
      target,
      "31064"
    )).toThrow(/approved shipping order/i);
  });

  it("fails closed when the internal ID matches but the display order does not", async () => {
    const job = {
      shippingOrderNumber: "30666",
      teamshipOrderId: "31064",
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem",
      credentials: { email: "employee@example.com", password: "test-password", apiBaseUrl: null }
    } as ClaimedTeamshipPrintJob;
    const findOrders = vi.fn(async () => [{
      id: "99999",
      teamship_internal_id: "31064",
      url: "https://members.fulfillit.io/ship-inventories/31064",
      customer: { company: "Garland Canada Distribution" },
      warehouse_name: "Annagem",
      pallet_dims: [{ quantity: 2 }]
    }]);

    await expect(assertTeamshipApiOrderIdentity(job, findOrders))
      .rejects.toThrow(/exactly one approved shipping order/i);
  });

  it("fails closed when the approved API customer or warehouse changes", async () => {
    const job = {
      shippingOrderNumber: "30666",
      teamshipOrderId: "31064",
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem",
      credentials: { email: "employee@example.com", password: "test-password", apiBaseUrl: null }
    } as ClaimedTeamshipPrintJob;
    const findOrders = vi.fn(async () => [{
      id: "30666",
      teamship_internal_id: "31064",
      url: "https://members.fulfillit.io/ship-inventories/31064",
      customer: { company: "Another Customer" },
      warehouse_name: "Annagem",
      pallet_dims: [{ quantity: 2 }]
    }]);

    await expect(assertTeamshipApiOrderIdentity(job, findOrders))
      .rejects.toThrow(/customer does not match/i);

    const wrongWarehouse = vi.fn(async () => [{
      id: "30666",
      teamship_internal_id: "31064",
      url: "https://members.fulfillit.io/ship-inventories/31064",
      customer: { company: "Garland Canada Distribution" },
      warehouse_name: "Another Warehouse",
      pallet_dims: [{ quantity: 2 }]
    }]);
    await expect(assertTeamshipApiOrderIdentity(job, wrongWarehouse))
      .rejects.toThrow(/warehouse does not match/i);
  });

  it("fails closed when the Teamship API does not return one exact approved order", async () => {
    const job = {
      shippingOrderNumber: "30666",
      teamshipOrderId: "31064",
      credentials: { email: "employee@example.com", password: "test-password", apiBaseUrl: null }
    } as ClaimedTeamshipPrintJob;

    await expect(assertTeamshipApiOrderIdentity(job, vi.fn(async () => [])))
      .rejects.toThrow(/exactly one approved shipping order/i);
  });

  it("selects only the corrected exact BIXOLON printer and returns its current page value", () => {
    expect(resolveExactPrinterOption([[
      { label: "BIXOLON SRP-770III - BPL-Z", value: "old-printer-id" },
      { label: "BIXOLON SRP-770III", value: "current-printer-id" }
    ]], "BIXOLON SRP-770III")).toEqual({
      selectIndex: 0,
      value: "current-printer-id"
    });
  });

  it("fails closed when the exact printer is absent or duplicated", () => {
    expect(() => resolveExactPrinterOption([[
      { label: "BIXOLON SRP-770III - BPL-Z", value: "wrong" }
    ]], "BIXOLON SRP-770III")).toThrow(/not available/i);
    expect(() => resolveExactPrinterOption([
      [{ label: "BIXOLON SRP-770III", value: "one" }],
      [{ label: "BIXOLON SRP-770III", value: "two" }]
    ], "BIXOLON SRP-770III")).toThrow(/more than one visible control/i);
  });
});
