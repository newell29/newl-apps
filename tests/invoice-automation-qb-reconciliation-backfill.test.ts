import { describe, expect, it } from "vitest";
import { extractShipmentFileNumbersFromQuickBooksTransaction } from "@/modules/invoice-automation/quickbooks-reconciliation-backfill";

describe("invoice automation QuickBooks reconciliation backfill", () => {
  it("extracts shipment file numbers from QuickBooks memo and line descriptions", () => {
    expect(
      extractShipmentFileNumbersFromQuickBooksTransaction({
        PrivateNote: "OI3106N13",
        Line: [
          {
            Description: "Freight charges for OI3106N13"
          }
        ]
      })
    ).toEqual(["OI3106N13"]);
  });

  it("deduplicates the same shipment number across memo and line descriptions", () => {
    expect(
      extractShipmentFileNumbersFromQuickBooksTransaction({
        CustomerMemo: {
          value: "TR1765N282"
        },
        Line: [
          {
            Description: "TR1765N282"
          }
        ]
      })
    ).toEqual(["TR1765N282"]);
  });

  it("detects multiple shipment numbers so the backfill can skip transaction-level false matches", () => {
    expect(
      extractShipmentFileNumbersFromQuickBooksTransaction({
        PrivateNote: "IATA monthly CASS statement",
        Line: [
          {
            Description: "AE1614N12 freight"
          },
          {
            Description: "AI918N26 freight"
          }
        ]
      })
    ).toEqual(["AE1614N12", "AI918N26"]);
  });
});
