import { describe, expect, it, vi } from "vitest";

import {
  resolveExactPrinterOption,
  resolveTeamshipPrintAppBaseUrl,
  readTeamshipApiPalletCount
} from "@/modules/teamship/print-execution";
import type { ClaimedTeamshipPrintJob } from "@/modules/teamship/print-jobs";

describe("Teamship print execution safeguards", () => {
  it("opens the documented shipping-order detail host when no override is configured", () => {
    expect(resolveTeamshipPrintAppBaseUrl(undefined).origin).toBe("https://members.fulfillit.io");
    expect(resolveTeamshipPrintAppBaseUrl("  https://members.fulfillit.io  ").origin)
      .toBe("https://members.fulfillit.io");
  });

  it("rechecks the approved order's pallet count through the Teamship API", async () => {
    const job: ClaimedTeamshipPrintJob = {
      id: "print-job-1",
      shippingOrderNumber: "30666",
      teamshipOrderId: "30666",
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem",
      approvedPalletCount: 2,
      documentPlan: { pickingListCopies: 1, bolCopies: 1, outboundLabelCopies: 2 },
      printerPlan: {
        pickingList: { transport: "CUPS", queue: "_192_168_1_28", displayName: "192.168.1.28" },
        bol: { transport: "TEAMSHIP", exactName: "Office printer" },
        outboundLabels: { transport: "TEAMSHIP", exactName: "BIXOLON SRP-770III" }
      },
      credentials: { email: "employee@example.com", password: "test-password", apiBaseUrl: null }
    };
    const findOrders = vi.fn(async () => [{
      id: "30666",
      pallet_dims: [{ quantity: 1 }, { quantity: 1 }]
    }]);

    await expect(readTeamshipApiPalletCount(job, findOrders)).resolves.toBe(2);
    expect(findOrders).toHaveBeenCalledWith({
      orderIdentifier: "30666",
      credentials: job.credentials
    });
  });

  it("fails closed when the Teamship API does not return one exact approved order", async () => {
    const job = {
      shippingOrderNumber: "30666",
      teamshipOrderId: "30666",
      credentials: { email: "employee@example.com", password: "test-password", apiBaseUrl: null }
    } as ClaimedTeamshipPrintJob;

    await expect(readTeamshipApiPalletCount(job, vi.fn(async () => [])))
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
