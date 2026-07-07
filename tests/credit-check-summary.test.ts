import { describe, expect, it } from "vitest";

import { summarizeCreditCheckFields } from "@/modules/credit-checks/summary";

describe("summarizeCreditCheckFields", () => {
  it("maps account setup fields into credit check summary fields", () => {
    const summary = summarizeCreditCheckFields({
      legalCompanyName: "Acme Distribution Ltd.",
      operatingName: "Acme",
      mainPhone: "905-555-0100",
      primaryContactName: "Jordan Lee",
      primaryContactEmail: "jordan@example.com",
      accountsPayableEmail: "ap@example.com",
      requestedCreditLimit: "$25,000",
      services: ["Warehousing", "Ground distribution"],
      tradeReferenceOneName: "Supplier A",
      tradeReferenceOneEmail: "credit@supplier.example"
    });

    expect(summary).toMatchObject({
      legalCompanyName: "Acme Distribution Ltd.",
      operatingName: "Acme",
      company: "Acme Distribution Ltd.",
      mainPhone: "905-555-0100",
      primaryContactName: "Jordan Lee",
      primaryContactEmail: "jordan@example.com",
      accountsPayableEmail: "ap@example.com",
      requestedCreditLimit: "$25,000",
      services: ["Warehousing", "Ground distribution"]
    });
    expect(summary.tradeReferences).toMatchObject({
      tradeReferenceOneName: "Supplier A",
      tradeReferenceOneEmail: "credit@supplier.example"
    });
  });
});
