import { describe, expect, it } from "vitest";
import {
  buildQuickBooksCustomerAlias,
  classifyProfitAndLossLine,
  extractFileNumber,
  getShipmentTypeFromFileNumber,
  groupQuickBooksLinesByFile,
  isFileNumberRequiredForLine,
  parseQuickBooksProfitAndLossRow,
  summarizeUnmatchedQuickBooksLines
} from "@/modules/customer-cashflow/quickbooks";

describe("QuickBooks cashflow parsing", () => {
  it("extracts Newl file numbers from P&L descriptions", () => {
    expect(extractFileNumber("AI532N2")).toBe("AI532N2");
    expect(extractFileNumber("vendor charge for OI1765N97 container")).toBe("OI1765N97");
    expect(extractFileNumber("TR-102N276")).toBe("TR102N276");
    expect(extractFileNumber("no file here")).toBeNull();
  });

  it("decodes shipment type prefixes", () => {
    expect(getShipmentTypeFromFileNumber("OI1765N97")).toBe("OI");
    expect(getShipmentTypeFromFileNumber("OE1765N71")).toBe("OE");
    expect(getShipmentTypeFromFileNumber("TR102N276")).toBe("TR");
    expect(getShipmentTypeFromFileNumber("AI532N2")).toBe("AI");
  });

  it("classifies income as customer revenue and COGS as vendor cost", () => {
    expect(classifyProfitAndLossLine("Income", "4001 Air Freight")).toBe("CUSTOMER_REVENUE");
    expect(classifyProfitAndLossLine("Cost of Goods Sold", "5020 Ocean Freight Rate")).toBe("VENDOR_COST");
    expect(classifyProfitAndLossLine("Expenses", "5158 PayCargo Fee")).toBe("OTHER");
  });

  it("preserves QuickBooks customer labels as aliases while normalizing currency variants", () => {
    const cadAlias = buildQuickBooksCustomerAlias({
      name: "GAL CANADA ELEVATOR PARTS",
      sourceCustomerId: "qb-cad"
    });
    const usdAlias = buildQuickBooksCustomerAlias({
      name: "GAL CANADA ELEVATOR PARTS USD",
      sourceCustomerId: "qb-usd"
    });

    expect(cadAlias).toMatchObject({
      sourceSystem: "QUICKBOOKS",
      sourceCustomerName: "GAL CANADA ELEVATOR PARTS",
      normalizedSourceName: "gal-canada-elevator-parts",
      sourceCurrency: null,
      sourceLabel: "GAL CANADA ELEVATOR PARTS"
    });
    expect(usdAlias).toMatchObject({
      sourceCustomerName: "GAL CANADA ELEVATOR PARTS USD",
      normalizedSourceName: "gal-canada-elevator-parts",
      sourceCurrency: "USD",
      sourceLabel: "GAL CANADA ELEVATOR PARTS USD"
    });
  });

  it("normalizes QuickBooks P&L rows for import", () => {
    const parsed = parseQuickBooksProfitAndLossRow({
      transactionDate: "01/01/2025",
      transactionType: "Invoice",
      transactionNumber: "4722",
      name: "DOW CHEMICAL CANADA ULC",
      description: "AI532N2",
      splitAccountName: "Accounts Receivable",
      accountName: "4001 Air Freight",
      parentSection: "Income",
      amount: 1200
    });

    expect(parsed).toMatchObject({
      legalEntity: "NEWL_WORLDWIDE",
      businessLine: "AIR",
      fileNumber: "AI532N2",
      shipmentType: "AI",
      lineKind: "CUSTOMER_REVENUE",
      transactionType: "Invoice",
      transactionNumber: "4722",
      amount: 1200
    });
  });

  it("does not require file numbers for Newl USA Charlotte warehousing lines", () => {
    const parsed = parseQuickBooksProfitAndLossRow(
      {
        transactionType: "Invoice",
        transactionNumber: "WH-100",
        name: "Charlotte warehouse customer",
        description: "Monthly storage and handling",
        accountName: "4004 Warehouse",
        parentSection: "Income",
        amount: 8500
      },
      {
        legalEntity: "NEWL_USA",
        defaultBusinessLine: "WAREHOUSING"
      }
    );

    expect(parsed).toMatchObject({
      legalEntity: "NEWL_USA",
      businessLine: "WAREHOUSING",
      fileNumber: null,
      lineKind: "CUSTOMER_REVENUE"
    });
    expect(isFileNumberRequiredForLine(parsed)).toBe(false);
  });

  it("allows Newl Worldwide third-party warehousing to be aggregate when no file exists", () => {
    const parsed = parseQuickBooksProfitAndLossRow({
      transactionType: "Bill",
      transactionNumber: "3PL-100",
      name: "Third Party Warehouse",
      description: "Warehouse storage for Canadian customer",
      accountName: "5014 Warehouse Rate",
      parentSection: "Cost of Goods Sold",
      amount: 1200,
      legalEntity: "NEWL_WORLDWIDE"
    });

    expect(parsed).toMatchObject({
      legalEntity: "NEWL_WORLDWIDE",
      businessLine: "WAREHOUSING",
      fileNumber: null,
      lineKind: "VENDOR_COST"
    });
    expect(isFileNumberRequiredForLine(parsed)).toBe(false);
  });

  it("still flags ocean, air, and trucking accounting lines with no file number", () => {
    const parsed = parseQuickBooksProfitAndLossRow({
      transactionType: "Bill",
      transactionNumber: "MISSING-FILE",
      name: "Ocean Carrier",
      description: "Ocean freight charge missing file reference",
      accountName: "5020 Ocean Freight Rate",
      parentSection: "Cost of Goods Sold",
      amount: 3200
    });
    const summary = summarizeUnmatchedQuickBooksLines([parsed]);

    expect(parsed.businessLine).toBe("OCEAN");
    expect(isFileNumberRequiredForLine(parsed)).toBe(true);
    expect(summary).toEqual({
      fileNumberRequired: 1,
      warehouseAggregateLines: 0
    });
  });

  it("infers business line from file prefixes", () => {
    expect(parseQuickBooksProfitAndLossRow({ description: "OI1765N97", parentSection: "Income" }).businessLine).toBe("OCEAN");
    expect(parseQuickBooksProfitAndLossRow({ description: "OE1765N71", parentSection: "Income" }).businessLine).toBe("OCEAN");
    expect(parseQuickBooksProfitAndLossRow({ description: "AI532N2", parentSection: "Income" }).businessLine).toBe("AIR");
    expect(parseQuickBooksProfitAndLossRow({ description: "AE180N5", parentSection: "Income" }).businessLine).toBe("AIR");
    expect(parseQuickBooksProfitAndLossRow({ description: "TR102N276", parentSection: "Income" }).businessLine).toBe("TRUCKING");
  });

  it("flags files that have vendor cost without a customer invoice line", () => {
    const grouped = groupQuickBooksLinesByFile([
      parseQuickBooksProfitAndLossRow({
        parentSection: "Cost of Goods Sold",
        accountName: "5020 Ocean Freight Rate",
        transactionType: "Bill",
        transactionNumber: "IN0000013440",
        name: "KENDREW DISTRIBUTION SERVICES LIMITED",
        description: "OI1765N97",
        amount: 2054.9
      }),
      parseQuickBooksProfitAndLossRow({
        parentSection: "Income",
        accountName: "4002 Ocean Freight",
        transactionType: "Invoice",
        transactionNumber: "9001",
        name: "Customer",
        description: "OE1765N71",
        amount: 5000
      })
    ]);

    expect(grouped).toContainEqual(
      expect.objectContaining({
        fileNumber: "OI1765N97",
        hasVendorCost: true,
        hasCustomerInvoice: false,
        vendorCostWithoutCustomerInvoice: true
      })
    );
    expect(grouped).toContainEqual(
      expect.objectContaining({
        fileNumber: "OE1765N71",
        hasCustomerInvoice: true,
        vendorCostWithoutCustomerInvoice: false
      })
    );
  });
});
