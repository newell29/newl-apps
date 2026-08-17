import { IntegrationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  assertInternalRecipients,
  parseTmgOrderIntakeSettings
} from "@/modules/shipment-documents/tmg-settings";

describe("TMG order intake settings", () => {
  it("parses a complete tenant profile without exposing secrets", () => {
    const settings = parseTmgOrderIntakeSettings({
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        enabled: true,
        mailboxAddress: "warehouse@example.com",
        allowedSenderAddresses: ["orders@customer.example"],
        requiredRecipientAddresses: ["csr@example.com"],
        additionalInternalRecipientDomains: ["warehouse.example"],
        subjectPrefix: "TMG synthetic shipment",
        internalSummaryRecipients: ["csr@example.com", "warehouse@warehouse.example"],
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
    expect(settings.additionalInternalRecipientDomains).toEqual(["warehouse.example"]);
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

  it("permits only the mailbox domain and explicitly approved additional internal domains", () => {
    expect(() => assertInternalRecipients(
      "csr@example.com",
      ["warehouse.example"],
      ["csr@example.com", "operations@warehouse.example"],
      "summary recipients"
    )).not.toThrow();

    expect(() => assertInternalRecipients(
      "csr@example.com",
      ["warehouse.example"],
      ["outside@customer.example"],
      "summary recipients"
    )).toThrow("explicitly approved additional internal domain");
  });

  it("fails closed when stored summary recipients use an unapproved domain", () => {
    const settings = parseTmgOrderIntakeSettings({
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        enabled: true,
        mailboxAddress: "warehouse@example.com",
        allowedSenderAddresses: ["orders@customer.example"],
        requiredRecipientAddresses: ["csr@example.com"],
        subjectPrefix: "TMG synthetic shipment",
        internalSummaryRecipients: ["outside@customer.example"],
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

    expect(settings.configured).toBe(false);
    expect(settings.configurationIssues).toContain(
      "TMG summary recipients must use the mailbox domain or an explicitly approved additional internal domain."
    );
  });
});
