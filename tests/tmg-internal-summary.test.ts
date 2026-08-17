import { describe, expect, it } from "vitest";

import { buildTmgInternalSummaryMessages } from "@/modules/shipment-documents/tmg-internal-summary";

describe("TMG internal summary", () => {
  it("summarizes created orders and warehouse-only instructions without delivery notes", () => {
    const messages = buildTmgInternalSummaryMessages({
      recipients: ["csr@example.com", "warehouse@example.com", "CSR@example.com"],
      receivedAt: "2026-08-18T14:00:00.000Z",
      sourceSubject: "TMG synthetic shipment",
      orders: [{
        teamshipOrderNumber: "612345",
        customerReference: "US19999",
        shipToName: "Synthetic Recipient",
        shipToCity: "Example City",
        shipToState: "NY",
        items: [{ sku: "TMG-EXAMPLE-1", quantity: 2 }],
        proNumber: "010-1234567",
        documentUploadStatus: "UPLOADED",
        warehouseInstructions: "5 layers shrink wrap"
      }]
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]!.body).toContain("Warehouse instructions: 5 layers shrink wrap");
    expect(messages[0]!.body).toContain("Delivery notes from the packing slip were intentionally excluded");
    expect(messages[0]!.body).not.toContain("Appointment required");
  });
});
