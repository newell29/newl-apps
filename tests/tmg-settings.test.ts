import { IntegrationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { parseTmgOrderIntakeSettings } from "@/modules/shipment-documents/tmg-settings";

describe("TMG order intake settings", () => {
  it("parses a complete tenant profile without exposing secrets", () => {
    const settings = parseTmgOrderIntakeSettings({
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        enabled: true,
        mailboxAddress: "warehouse@example.com",
        allowedSenderAddresses: ["orders@customer.example"],
        requiredRecipientAddresses: ["csr@example.com"],
        subjectPrefix: "TMG synthetic shipment",
        internalSummaryRecipients: ["csr@example.com", "warehouse@example.com"],
        teamship: {
          customerId: "1001",
          customerName: "Synthetic TMG Customer",
          warehouseId: "2001",
          warehouseName: "Synthetic Warehouse",
          inventoryUserId: "1001",
          inventoryLocationId: "3001",
          carrierName: "Synthetic LTL"
        }
      }
    });

    expect(settings).toMatchObject({ enabled: true, configured: true, configurationIssues: [] });
    expect(settings).not.toHaveProperty("password");
  });

  it("fails closed when sender, summary, or Teamship scope is missing", () => {
    const settings = parseTmgOrderIntakeSettings({
      status: IntegrationStatus.ACTIVE,
      publicConfig: { enabled: true, mailboxAddress: "warehouse@example.com" }
    });

    expect(settings.configured).toBe(false);
    expect(settings.configurationIssues).toHaveLength(5);
  });
});
