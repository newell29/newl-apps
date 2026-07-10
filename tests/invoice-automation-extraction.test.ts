import { describe, expect, it } from "vitest";

import {
  formatInvoicePostingBlocker,
  getInvoiceApprovalBlockingIssues,
  getInvoicePostingBlockingIssues
} from "@/modules/invoice-automation/approval";
import { buildInvoiceDuplicateKey, INVOICE_DUPLICATE_CHECK_STATUSES } from "@/modules/invoice-automation/duplicates";
import { buildInvoiceAutomationEntityAlias } from "@/modules/invoice-automation/entity-aliases";
import {
  buildInvoiceDraftFromText,
  extractCurrency,
  extractInvoiceAmounts,
  extractShipmentFileNumber,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  matchQuickBooksEntity,
  normalizeInvoiceEntityName,
  splitInvoiceTextIntoDocuments
} from "@/modules/invoice-automation/extraction";
import type { InvoiceAutomationEntityOption } from "@/modules/invoice-automation/types";

const entityOptions: InvoiceAutomationEntityOption[] = [
  {
    id: "qb-customer-cad",
    entityType: "CUSTOMER",
    displayName: "Acme Logistics CAD",
    normalizedName: "acme logistics",
    currency: "CAD"
  },
  {
    id: "qb-alberta-customer-cad",
    entityType: "CUSTOMER",
    displayName: "Alberta Ltd CAD",
    normalizedName: "alberta ltd",
    currency: "CAD"
  },
  {
    id: "qb-ap-logistics-usd",
    entityType: "CUSTOMER",
    displayName: "AP Logistics Sp. Z.O.O. USD",
    normalizedName: "ap logistics sp z o o",
    currency: "USD"
  },
  {
    id: "qb-vendor-usd",
    entityType: "VENDOR",
    displayName: "Fast Trucking USD",
    normalizedName: "fast trucking",
    currency: "USD"
  },
  {
    id: "qb-air-vendor",
    entityType: "VENDOR",
    displayName: "Air Freight Vendor",
    normalizedName: "air freight vendor",
    currency: "USD"
  },
  {
    id: "qb-fast-cad",
    entityType: "VENDOR",
    displayName: "Currency Split Carrier CAD",
    normalizedName: "currency split carrier",
    currency: "CAD"
  },
  {
    id: "qb-fast-usd",
    entityType: "VENDOR",
    displayName: "Currency Split Carrier USD",
    normalizedName: "currency split carrier",
    currency: "USD"
  },
  {
    id: "qb-test-vendor-cad",
    entityType: "VENDOR",
    displayName: "Test Company - DO NOT PROCESS",
    normalizedName: "test company do not process",
    currency: "CAD"
  },
  {
    id: "qb-canadian-logistics-cad",
    entityType: "VENDOR",
    displayName: "Canadian Logistics Express CAD",
    normalizedName: "canadian logistics express",
    currency: "CAD"
  },
  {
    id: "qb-casia-usd",
    entityType: "VENDOR",
    displayName: "Casia Logistics Tech Limited USD",
    normalizedName: "casia logistics tech limited",
    currency: "USD"
  },
  {
    id: "qb-newells-usd",
    entityType: "VENDOR",
    displayName: "Newell's Express Worldwide Logistics USA Inc.",
    normalizedName: "newells express worldwide logistics usa inc",
    currency: "USD"
  }
];

describe("invoice automation extraction", () => {
  it("extracts shipment file numbers from OCR text and uploaded file names", () => {
    expect(extractShipmentFileNumber("Shipment file: OE-12345")).toBe("OE12345");
    expect(extractShipmentFileNumber("", "vendor-invoice_TR98765.pdf")).toBe("TR98765");
    expect(extractShipmentFileNumber("NS TR2911T12", "TR2911N12 - Western Canada 1.pdf")).toBe("TR2911N12");
    expect(extractShipmentFileNumber("", "AE1190N10_PERU CONTAINER LINE E.I.R.L_revised.pdf")).toBe("AE1190N10");
  });

  it("maps service prefixes to profitability business lines and QB posting defaults", () => {
    expect(getBusinessLineFromInvoiceFileNumber("OE12345")).toBe("OCEAN");
    expect(getBusinessLineFromInvoiceFileNumber("AE12345")).toBe("AIR");
    expect(getBusinessLineFromInvoiceFileNumber("DR12345")).toBe("TRUCKING");
    expect(getDefaultProductOrAccount("CUSTOMER", "OI12345")).toBe("Ocean Freight");
    expect(getDefaultProductOrAccount("VENDOR", "TR12345")).toBe("5015 Trucking Rate");
    expect(getDefaultProductOrAccount("CUSTOMER", "DR12345")).toBe("Trucking");
    expect(getDefaultProductOrAccount("VENDOR", "DR12345")).toBe("5015 Trucking Rate");
  });

  it("extracts subtotal, tax, and total amounts", () => {
    expect(
      extractInvoiceAmounts(`
        Subtotal: $1,000.00
        HST: $130.00
        Total Amount: CAD $1,130.00
      `)
    ).toEqual({
      subtotalAmount: 1000,
      taxAmount: 130,
      totalAmount: 1130
    });
  });

  it("extracts Canadian provincial tax lines and derives totals", () => {
    expect(
      extractInvoiceAmounts(
        `
          Subtotal CAD 800.00
          GST British Columbia 5% CAD 40.00
          PST British Columbia 7% CAD 56.00
          Total CAD 896.00
        `,
        "CAD"
      )
    ).toEqual({
      subtotalAmount: 800,
      taxAmount: 96,
      totalAmount: 896
    });

    expect(
      extractInvoiceAmounts(
        `
          Subtotal CAD 410.00
          GST Alberta 5% CAD 20.50
          Total CAD 430.50
        `,
        "CAD"
      )
    ).toEqual({
      subtotalAmount: 410,
      taxAmount: 20.5,
      totalAmount: 430.5
    });
  });

  it("keeps non-Canadian VAT out of tax and includes it in cost", () => {
    expect(
      extractInvoiceAmounts(
        `
          Subtotal GBP 600.00
          VAT United Kingdom 20% GBP 120.00
          Total GBP 720.00
        `,
        "GBP"
      )
    ).toEqual({
      subtotalAmount: 720,
      taxAmount: 0,
      totalAmount: 720
    });
  });

  it("normalizes common vendor invoice date and currency formats", () => {
    const casia = buildInvoiceDraftFromText({
      clientId: "casia-date",
      fileName: "Approved Invoice Casia OI348N1002 DN-CNG26040761.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "INVOICE DATE： 2026/04/30 19:27:14\nSAY TOTAL AMOUNT USD 595.77\nOI348N1002"
    });

    expect(casia.invoiceDate).toBe("2026-04-30");
    expect(casia.dueDate).toBe("2026-05-30");

    const landAir = buildInvoiceDraftFromText({
      clientId: "land-air-date",
      fileName: "Approved Invoice Land Air Express AI1001N2 54714134-3.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "Invoice Number Invoice Date\n127353 20-Nov-25\nPlease Pay this Amount : $499.44\nAI1001N2"
    });

    expect(landAir.invoiceDate).toBe("2025-11-20");
    expect(landAir.dueDate).toBe("2025-12-20");

    const western = buildInvoiceDraftFromText({
      clientId: "western-currency",
      fileName: "TR2911N12 - Western Canada 1.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "P a r t 1 of 1 1259568587\nNS TR2911T12\n1 PREPAID TOTALS 130 400.89\nPayable in Canadian dol"
    });

    expect(western.currency).toBe("CAD");
  });

  it("recognizes non-USD foreign invoice currencies", () => {
    expect(extractCurrency("Invoice total EUR 1,250.00")).toBe("EUR");
    expect(extractCurrency("Amount due £950.00")).toBe("GBP");
    expect(extractCurrency("Currency: MXN Total 2100.00")).toBe("MXN");
  });

  it("uses the final amount on prepaid totals freight bills", () => {
    expect(extractInvoiceAmounts("1 PREPAID TOTALS 200 139.77\nPREPAID\n139.77")).toMatchObject({
      totalAmount: 139.77
    });
  });

  it("splits multi-invoice freight bill attachments into separate invoice texts", () => {
    const segments = splitInvoiceTextIntoDocuments(`
      P a r t 1 of 3 1254395251
      CN- 0035414
      7 SKIDS FURNITURE
      ---------------------------- Tear Here ----------------------------
      P a r t 2 of 3 1254395251
      APPOINTMENT SET UP CHARGE 30.00
      ---------------------------- Tear Here ----------------------------
      P a r t 3 of 3 1254395251
      7 PREPAID TOTALS 3,714 1241.21
      ---------------------------- Tear Here ----------------------------
      P a r t 1 of 2 1254812888
      CN-TR144N36
      1 SKID PLUMBING PARTS
      ---------------------------- Tear Here ----------------------------
      P a r t 2 of 2 1254812888
      1 PREPAID TOTALS 200 139.77
    `);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toContain("1254395251");
    expect(segments[0]).toContain("1241.21");
    expect(segments[1]).toContain("1254812888");
    expect(segments[1]).toContain("TR144N36");
  });

  it("does not carry the first shipment file number across adjacent freight bill invoices", () => {
    const segments = splitInvoiceTextIntoDocuments(`
      P a r t 1 of 2 1254812892
      NS TR238N25
      APPOINTMENT SET UP CHARGE 30.00
      ---------------------------- Tear Here ----------------------------
      P a r t 2 of 2 1254812892
      NS TR238N25
      2 PREPAID TOTALS 220 123.73
      P a r t 1 of 2 1254812893
      NS TR238N24
      CUBE WEIGHT 355 22.33 79.27
      ---------------------------- Tear Here ----------------------------
      P a r t 2 of 2 1254812893
      NS TR238N24
      1 PREPAID TOTALS 280 133.36
      P a r t 1 of 2 1254812901
      NS TR238N29
      5 SKIDS MERCHANDISE 3,647 18.53 675.79
      ---------------------------- Tear Here ----------------------------
      P a r t 2 of 2 1254812901
      NS TR238N29
      5 PREPAID TOTALS 3,647 881.23
    `);

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => extractShipmentFileNumber(segment))).toEqual([
      "TR238N25",
      "TR238N24",
      "TR238N29"
    ]);
  });

  it("splits bundled vendor invoice pages by distinct invoice number", () => {
    const segments = splitInvoiceTextIntoDocuments(`
      Test Company - DO NOT PROCESS
      VENDOR BILL
      Invoice Number: TEST-V-BUNDLE-009A
      Invoice Date: 2026-07-10
      Currency: CAD
      Shipment File Number: TR919N26
      Subtotal CAD 275.00
      HST Ontario 13% CAD 35.75
      Total CAD 310.75

      Test Company - DO NOT PROCESS
      VENDOR BILL
      Invoice Number: TEST-V-BUNDLE-009B
      Invoice Date: 2026-07-10
      Currency: CAD
      Shipment File Number: DR920N26
      Subtotal CAD 325.00
      GST Alberta 5% CAD 16.25
      Total CAD 341.25
    `);

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => extractInvoiceAmounts(segment, "CAD"))).toEqual([
      { subtotalAmount: 275, taxAmount: 35.75, totalAmount: 310.75 },
      { subtotalAmount: 325, taxAmount: 16.25, totalAmount: 341.25 }
    ]);
    expect(segments.map((segment) => extractShipmentFileNumber(segment))).toEqual(["TR919N26", "DR920N26"]);
  });

  it("matches OCR text to QuickBooks customer and vendor options", () => {
    expect(matchQuickBooksEntity("Bill To: Acme Logistics", "CUSTOMER", entityOptions)?.option.id).toBe(
      "qb-customer-cad"
    );
    expect(matchQuickBooksEntity("Vendor: Fast Trucking", "VENDOR", entityOptions)?.option.id).toBe("qb-vendor-usd");
  });

  it("does not auto-populate low-confidence or currency-mismatched QuickBooks customer matches", () => {
    expect(matchQuickBooksEntity("Bill To: Alberta Ltd\nCurrency: EUR", "CUSTOMER", entityOptions, "EUR")).toBeNull();
    expect(matchQuickBooksEntity("Bill To: Logistics Sp. Z.O.O.\nCurrency: USD", "CUSTOMER", entityOptions, "USD")).toBeNull();

    const draft = buildInvoiceDraftFromText({
      clientId: "low-confidence-customer",
      fileName: "customer-eur-zero-tax-test-co-variant.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "CUSTOMER",
      entityOptions,
      text: `
        Invoice Number: TEST-C-EUR-004
        Invoice Date: 2026-07-10
        Bill To: Alberta Ltd
        File Number: OE914N26
        Currency: EUR
        Subtotal EUR 900.00
        Total EUR 900.00
      `
    });

    expect(draft.entityNameRaw).toBe("Alberta Ltd");
    expect(draft.quickBooksEntityId).toBeNull();
    expect(draft.quickBooksMatchConfidence).toBeNull();
    expect(draft.issueCodes).toContain("MISSING_QB_MATCH");
  });

  it("does not match QuickBooks entities on province names alone", () => {
    expect(
      matchQuickBooksEntity(
        `
          Test Company - DO NOT PROCESS
          HST Ontario 13% CAD 35.75
          Total CAD 310.75
        `,
        "VENDOR",
        [
          {
            id: "qb-an-ontario",
            entityType: "VENDOR",
            displayName: "AN Ontario CAD",
            normalizedName: "an ontario",
            currency: "CAD"
          }
        ],
        "CAD"
      )
    ).toBeNull();
  });

  it("matches bundled vendor invoices to the extracted header vendor before body company names", () => {
    const draft = buildInvoiceDraftFromText({
      clientId: "bundle-company-match",
      fileName: "vendor-multi-invoice-bundle-two-file-numbers.pdf - invoice 1",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions,
      text: `
        Test Company - DO NOT PROCESS
        VENDOR BILL
        Invoice Number: TEST-V-BUNDLE-009A
        Invoice Date: 2026-07-10
        Currency: CAD
        Shipment File Number: TR919N26
        Ship via: Canadian Logistics Express
        Subtotal CAD 275.00
        HST Ontario 13% CAD 35.75
        Total CAD 310.75
      `
    });

    expect(draft.entityNameRaw).toBe("Test Company - DO NOT PROCESS");
    expect(draft.quickBooksEntityId).toBe("qb-test-vendor-cad");
  });

  it("leaves a bundled vendor unmatched instead of matching an unrelated body company", () => {
    const draft = buildInvoiceDraftFromText({
      clientId: "bundle-company-no-match",
      fileName: "vendor-multi-invoice-bundle-two-file-numbers.pdf - invoice 1",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [
        {
          id: "qb-canadian-logistics-cad",
          entityType: "VENDOR",
          displayName: "Canadian Logistics Express CAD",
          normalizedName: "canadian logistics express",
          currency: "CAD"
        }
      ],
      text: `
        Test Company - DO NOT PROCESS
        VENDOR BILL
        Invoice Number: TEST-V-BUNDLE-009A
        Invoice Date: 2026-07-10
        Currency: CAD
        Shipment File Number: TR919N26
        Ship via: Canadian Logistics Express
        Subtotal CAD 275.00
        HST Ontario 13% CAD 35.75
        Total CAD 310.75
      `
    });

    expect(draft.entityNameRaw).toBe("Test Company - DO NOT PROCESS");
    expect(draft.quickBooksEntityId).toBeNull();
    expect(draft.issueCodes).toContain("MISSING_QB_MATCH");
  });

  it("normalizes camel-case OCR customer names before QuickBooks matching", () => {
    expect(normalizeInvoiceEntityName("AvariaHealth and BeautyCorp")).toBe("avaria health and beauty corp");
    expect(
      matchQuickBooksEntity(
        "Bill To: AvariaHealth and BeautyCorp",
        "CUSTOMER",
        [
          {
            id: "qb-avaria-usd",
            entityType: "CUSTOMER",
            displayName: "Avaria Health and Beauty Corp - USD",
            normalizedName: normalizeInvoiceEntityName("Avaria Health and Beauty Corp - USD"),
            currency: "USD"
          }
        ],
        "USD"
      )?.option.id
    ).toBe("qb-avaria-usd");
  });

  it("prefers the QuickBooks vendor profile that matches the invoice currency", () => {
    expect(
      matchQuickBooksEntity("Vendor: Currency Split Carrier\nCurrency: USD", "VENDOR", entityOptions, "USD")?.option.id
    ).toBe("qb-fast-usd");
    expect(
      matchQuickBooksEntity("Vendor: Currency Split Carrier\nCurrency: CAD", "VENDOR", entityOptions, "CAD")?.option.id
    ).toBe("qb-fast-cad");
  });

  it("does not match generic service words to a QuickBooks vendor", () => {
    expect(
      matchQuickBooksEntity("Freight bills assigned to RTS Financial for OE3124N2", "VENDOR", entityOptions)
    ).toBeNull();
  });

  it("uses learned customer and vendor aliases as future QuickBooks matches", () => {
    const learnedAlias = buildInvoiceAutomationEntityAlias({
      tenantId: "tenant-1",
      invoiceType: "VENDOR",
      aliasRawName: "WCE Freight Bills",
      quickBooksEntityId: "qb-western-cad",
      quickBooksEntityDisplayName: "Western Canada Express CAD",
      currency: "CAD",
      userId: "user-1"
    });

    expect(learnedAlias).toMatchObject({
      normalizedAlias: "wce freight bills",
      quickBooksEntityId: "qb-western-cad",
      quickBooksEntityDisplayName: "Western Canada Express CAD"
    });

    const optionsWithAlias: InvoiceAutomationEntityOption[] = [
      ...entityOptions,
      {
        id: learnedAlias!.quickBooksEntityId,
        entityType: learnedAlias!.invoiceType,
        displayName: learnedAlias!.quickBooksEntityDisplayName,
        normalizedName: learnedAlias!.normalizedAlias,
        currency: learnedAlias!.currency
      }
    ];

    expect(
      matchQuickBooksEntity("Vendor: WCE Freight Bills\nCurrency CAD\nTR238N25", "VENDOR", optionsWithAlias, "CAD")
        ?.option.id
    ).toBe("qb-western-cad");
  });

  it("does not learn aliases that are identical to the selected QuickBooks name or unsafe OCR junk", () => {
    expect(
      buildInvoiceAutomationEntityAlias({
        tenantId: "tenant-1",
        invoiceType: "CUSTOMER",
        aliasRawName: "Acme Logistics CAD",
        quickBooksEntityId: "qb-customer-cad",
        quickBooksEntityDisplayName: "Acme Logistics CAD",
        currency: "CAD",
        userId: "user-1"
      })
    ).toBeNull();

    expect(
      buildInvoiceAutomationEntityAlias({
        tenantId: "tenant-1",
        invoiceType: "VENDOR",
        aliasRawName: "Total",
        quickBooksEntityId: "qb-vendor-cad",
        quickBooksEntityDisplayName: "Real Vendor CAD",
        currency: "CAD",
        userId: "user-1"
      })
    ).toBeNull();
  });

  it("uses vendor and invoice tokens from filename-heavy vendor PDFs", () => {
    const casia = buildInvoiceDraftFromText({
      clientId: "casia",
      fileName: "Approved Invoice Casia OI348N1002 DN-CNG26040761.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: `
        CASIA LOGISTICS TECH LIMITED
        INVOICE
        INVOICE NO: FCLCNG26040676-D1
        INVOICE DATE: 2026/04/30
        SAY TOTAL AMOUNT USD 595.77
        OI348N1002
      `
    });

    expect(casia.entityNameRaw).toBe("CASIA LOGISTICS TECH LIMITED");
    expect(casia.invoiceNumber).toBe("FCLCNG26040676-D1");

    const landAir = buildInvoiceDraftFromText({
      clientId: "land-air",
      fileName: "Approved Invoice Land Air Express AI1001N2 54714134-3.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: `
        INVOICE
        Land Air Express (Canada) Ltd.
        Invoice Number Invoice Date
        127353 20-Nov-25
        Please Pay this Amount : $499.44
        Invoice Amount Approved CAD 499.44
        AI1001N2
      `
    });

    expect(landAir.entityNameRaw).toBe("Land Air Express (Canada) Ltd.");
    expect(landAir.invoiceNumber).toBe("127353");

    const oneCourier = buildInvoiceDraftFromText({
      clientId: "one-courier",
      fileName: "Inv_891623158_from_Newells_Express___Warehousing_Ltd._2309009_27244.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "Bill To: Newells Express\nOE3476N2\nTotal: $84.70"
    });
    expect(oneCourier.invoiceNumber).toBe("891623158");

    const terminalTransfer = buildInvoiceDraftFromText({
      clientId: "terminal-transfer",
      fileName: "Invoice 6968 -TR1765N264 - NEWELL EXPRESS WORLDWIDE LOGISTICS LTD_132626.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "TR1765N264\nTotal: $300.00"
    });
    expect(terminalTransfer.invoiceNumber).toBe("6968");

    const scottFreight = buildInvoiceDraftFromText({
      clientId: "scott-freight",
      fileName: "Amount Approved Scott Freight AI3102N4 invoice NEW1001-44.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "SCOTT FREIGHT SERVICES LTD.\nInvoice Number 5200\nAI3102N4\nTotal CAD 100.00"
    });
    expect(scottFreight.invoiceNumber).toBe("NEW1001-44");

    const casiaBillOfLadingStyle = buildInvoiceDraftFromText({
      clientId: "casia-oney",
      fileName: "Approved Invoice Casia OI348N1024 ONEYTA6PU4170800.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "CASIA LOGISTICS TECH LIMITED\nSAY TOTAL AMOUNT USD 45.00\nOI348N1024"
    });
    expect(casiaBillOfLadingStyle.invoiceNumber).toBe("ONEYTA6PU4170800");

    const truckLine = buildInvoiceDraftFromText({
      clientId: "truck-line",
      fileName: "Amount Approved 777 Truck Line AI3102N4 Invoice No. 6652 & Pod-1.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "NEWELL’S EXPRESS WORLDWIDE LOGISTICS LTD.\nAI3102N4\nTotal 150.00"
    });
    expect(truckLine.entityNameRaw).toBe("777 Truck Line");
    expect(truckLine.invoiceNumber).toBe("6652");

    const canadianLogistics = buildInvoiceDraftFromText({
      clientId: "canadian-logistics",
      fileName: "Approved Invoice CANADIAN LOGISTICS EXPRESS OI3106N13 Invoice for PB17519 1.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions,
      text: `
        DATE 2026-06-29 INVOICE INVOICE 17519 Page: 1/2
        Bill To 6390 KESTREL ROAD NEWELL'S EXPRESS WORLDWIDE LOGISTICS
        Remit To CANADIAN LOGISTICS EXPRESS
        P.O. No. OI3106N13 | Q3106N15
        TOTAL 2 000,00
      `
    });
    expect(canadianLogistics.entityNameRaw).toBe("Canadian Logistics Express CAD");
    expect(canadianLogistics.quickBooksEntityId).toBe("qb-canadian-logistics-cad");
    expect(canadianLogistics.invoiceNumber).toBe("17519");

    const casiaTypoFileName = buildInvoiceDraftFromText({
      clientId: "casia-typo",
      fileName: "Approved Invoic Casia OI348N1246 DN-CNG26060138.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions,
      text: `
        SHIPMENT INFORMATION CASIA LOGISTICS TECH LIMITED Container No ONEU3252580
        NEWELL'S EXPRESS WORLDWIDE LOGISTICS USA INC. INVOICE
        INVOICE NO: CNG26060138
        OI348N1246
        SAY TOTAL AMOUNT USD 337.50
      `
    });
    expect(casiaTypoFileName.entityNameRaw).toBe("Casia Logistics Tech Limited USD");
    expect(casiaTypoFileName.quickBooksEntityId).toBe("qb-casia-usd");
  });

  it("extracts common production vendor invoice number and date formats", () => {
    const hapag = buildInvoiceDraftFromText({
      clientId: "hapag",
      fileName: "Approved Invoice Hapag OI348N800 INVP0301_964708257.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "I N V O I C E NO.: 2126345243 DEC. 30, 2025\nTOTAL 2,872.23 USD\nOI348N800"
    });
    expect(hapag.invoiceNumber).toBe("2126345243");
    expect(hapag.invoiceDate).toBe("2025-12-30");

    const lotus = buildInvoiceDraftFromText({
      clientId: "lotus",
      fileName: "OI433N31_Lotus.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "DATE\n31 Oct, 2025\nCUST REF NO. INVOICE NO.\nLotus Terminals Ltd OI433N31 LOTUS-24746\nCAD Total $6,747.18"
    });
    expect(lotus.invoiceNumber).toBe("LOTUS-24746");
    expect(lotus.invoiceDate).toBe("2025-10-31");

    const dts = buildInvoiceDraftFromText({
      clientId: "dts",
      fileName: "Approved Invoice DTS Advance Customs DR2477N14 TAX INVOICE - B00025152.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "TAX INVOICE B00025152\nNEWELL'S EXPRESS WORLDWIDE LOGISTICS LTD. INVOICE DATE 18-Nov-25\nTOTAL CAD 56.50\nDR2477N14"
    });
    expect(dts.invoiceNumber).toBe("B00025152");
    expect(dts.invoiceDate).toBe("2025-11-18");

    const naagamas = buildInvoiceDraftFromText({
      clientId: "naagamas",
      fileName: "AI2740N10_Naagamas.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "DATE\n02 May, 2026\nCUST REF NO. INVOICE NO.\n2301619 Onatario inc O/A Naagamas AI2740N10 67141\nCAD Total $300.00"
    });
    expect(naagamas.invoiceNumber).toBe("67141");
    expect(naagamas.invoiceDate).toBe("2026-05-02");

    const cass = buildInvoiceDraftFromText({
      clientId: "cass",
      fileName: "6010085-0003_202519_Cargo Sales Report1.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "IATA CARGO ACCOUNTS SETTLEMENT SYSTEM - CANADA CARGO SALES INVOICE/ADJUSTMENT INVOICE NR : CA-014-132420\nINVOICE DATE : 24-OCT-25\nCURRENCY : CAD\nAE2883N1\nTotal Payable 589.26"
    });
    expect(cass.invoiceNumber).toBe("CA-014-132420");
    expect(cass.invoiceDate).toBe("2025-10-24");

    const minimax = buildInvoiceDraftFromText({
      clientId: "minimax",
      fileName: "AE138N24_Minimax.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      pdfBase64: "",
      invoiceType: "VENDOR",
      entityOptions: [],
      text: "I n vo ic e / F a c tu re 3002271\nDa te 09/29/25\nAE138N24\nT O TA L 125.74 CAD"
    });
    expect(minimax.invoiceNumber).toBe("3002271");
    expect(minimax.invoiceDate).toBe("2025-09-29");
  });

  it("builds stable duplicate keys for customer and vendor invoice numbers", () => {
    expect(
      buildInvoiceDuplicateKey({
        invoiceType: "VENDOR",
        invoiceNumber: " INV-1001 ",
        quickBooksEntityId: "QB-VENDOR-1",
        quickBooksEntityDisplayName: "Fast Trucking USD",
        entityNameRaw: "Fast Trucking"
      })
    ).toBe("qb:qbvendor1|invoice:inv1001");

    expect(
      buildInvoiceDuplicateKey({
        invoiceType: "VENDOR",
        invoiceNumber: "INV 1001",
        quickBooksEntityId: null,
        quickBooksEntityDisplayName: null,
        entityNameRaw: "Fast Trucking CAD"
      })
    ).toBe("name:fasttrucking|invoice:inv1001");

    expect(
      buildInvoiceDuplicateKey({
        invoiceType: "CUSTOMER",
        invoiceNumber: "INV-1001",
        quickBooksEntityId: "QB-CUSTOMER-1",
        quickBooksEntityDisplayName: "Acme Logistics CAD",
        entityNameRaw: "Acme Logistics"
      })
    ).toBe("qb:qbcustomer1|invoice:inv1001");

    expect(
      buildInvoiceDuplicateKey({
        invoiceType: "CUSTOMER",
        invoiceNumber: "INV-1001",
        quickBooksEntityId: null,
        quickBooksEntityDisplayName: null,
        entityNameRaw: null
      })
    ).toBeNull();
  });

  it("checks uploaded invoice duplicates against posted invoices too", () => {
    expect(INVOICE_DUPLICATE_CHECK_STATUSES).toContain("POSTED");
    expect(INVOICE_DUPLICATE_CHECK_STATUSES).not.toContain("REJECTED");
  });

  it("blocks approval when customer or vendor invoice required fields are missing", () => {
    expect(
      getInvoiceApprovalBlockingIssues({
        invoiceType: "VENDOR",
        fileName: "bad-vendor.pdf",
        shipmentFileNumber: "TR12345",
        invoiceNumber: "V-100",
        invoiceDate: "2026-07-08",
        entityNameRaw: "Fast Trucking",
        quickBooksEntityId: null,
        currency: "CAD",
        totalAmount: 100,
        productOrAccountName: "5015 Trucking Rate"
      })
    ).toContain("missing QuickBooks match");

    expect(
      getInvoiceApprovalBlockingIssues({
        invoiceType: "CUSTOMER",
        fileName: "bad-customer.pdf",
        shipmentFileNumber: null,
        invoiceNumber: "C-100",
        invoiceDate: "2026-07-08",
        entityNameRaw: "Acme Logistics",
        quickBooksEntityId: "qb-customer-cad",
        currency: "CAD",
        totalAmount: null,
        productOrAccountName: "Ocean Freight"
      })
    ).toEqual(["missing file number", "missing total amount"]);
  });

  it("blocks QuickBooks posting when required invoice fields are missing", () => {
    const invoice = {
      invoiceType: "VENDOR" as const,
      fileName: "missing-posting-fields.pdf",
      shipmentFileNumber: "TR12345",
      invoiceNumber: "V-101",
      invoiceDate: "2026-07-08",
      entityNameRaw: "Fast Trucking",
      quickBooksEntityId: "qb-vendor-usd",
      currency: null,
      totalAmount: 100,
      productOrAccountName: null
    };
    const issues = getInvoicePostingBlockingIssues(invoice);

    expect(issues).toEqual(["missing currency", "missing expense account"]);
    expect(formatInvoicePostingBlocker(invoice, issues)).toBe(
      "V-101 cannot be posted to QuickBooks because it has missing currency, missing expense account."
    );
  });

  it("builds a customer invoice draft with editable review fields", () => {
    const draft = buildInvoiceDraftFromText({
      clientId: "local-1",
      fileName: "customer-OE12345.pdf",
      contentType: "application/pdf",
      sizeBytes: 256,
      pdfBase64: "JVBERi0x",
      invoiceType: "CUSTOMER",
      entityOptions,
      text: `
        Invoice Number: INV-1001
        Invoice Date: 2026-07-01
        Due Date: 2026-07-31
        Bill To: Acme Logistics CAD
        File Number: OE12345
        Currency: CAD
        Subtotal: $2,000.00
        HST: $260.00
        Amount Due: $2,260.00
      `
    });

    expect(draft).toMatchObject({
      shipmentFileNumber: "OE12345",
      businessLine: "OCEAN",
      entityNameRaw: "Acme Logistics CAD",
      quickBooksEntityId: "qb-customer-cad",
      invoiceNumber: "INV-1001",
      invoiceDate: "2026-07-01",
      dueDate: "2026-07-31",
      currency: "CAD",
      subtotalAmount: 2000,
      taxAmount: 260,
      totalAmount: 2260,
      productOrAccountName: "Ocean Freight",
      issueCodes: []
    });
  });

  it("respects due on receipt customer invoice terms instead of defaulting to net 30", () => {
    const draft = buildInvoiceDraftFromText({
      clientId: "customer-due-on-receipt",
      fileName: "customer-AE1614N12-7499.pdf",
      contentType: "application/pdf",
      sizeBytes: 256,
      pdfBase64: "JVBERi0x",
      invoiceType: "CUSTOMER",
      entityOptions,
      text: `
        INVOICE#: 7499
        Booking Number: AE1614N12
        Customer Name: Eastern Services W.L.L
        Invoice Date Due Date Payment Terms
        2026-07-03 Due on Receipt 0
        Service Air Freight
        Currency: USD
        Subtotal: USD 750.00
        Total: USD 750.00
      `
    });

    expect(draft).toMatchObject({
      shipmentFileNumber: "AE1614N12",
      businessLine: "AIR",
      invoiceNumber: "7499",
      invoiceDate: "2026-07-03",
      dueDate: "2026-07-03",
      currency: "USD",
      subtotalAmount: 750,
      totalAmount: 750,
      productOrAccountName: "Air Freight"
    });
  });

  it("extracts factored trucking invoices to the actual carrier and defaults missing due dates to net 30", () => {
    const draft = buildInvoiceDraftFromText({
      clientId: "local-2",
      fileName: "373 cargo inc OE3124N2.pdf",
      contentType: "application/pdf",
      sizeBytes: 256,
      pdfBase64: "JVBERi0x",
      invoiceType: "VENDOR",
      entityOptions,
      text: `
        BILL TO:
        NEWELLS EXPRESS WORLDWIDE LOGISTICS LTD

        ALL BILLS PRESENTED ON THIS INVOICE HAVE BEEN
        SOLD & ASSIGNED TO AND ARE PAYABLE TO:
        RTS Financial Service, Inc.

        373 CARGO INCORPORATED
        INVOICE
        INV DATE INV # PO # INV AMOUNT
        6/18/2026 ONUR512 OE3124N2 2,500.00

        Invoice # ONUR512
        Invoice Date 6/18/2026
        Reference(Load or W/O) OE3124N2
        Assigned For:
        373 CARGO INCORPORATED
        RATES AND CHARGES
        (USD) Total Rate $2,500.00
      `
    });

    expect(draft).toMatchObject({
      shipmentFileNumber: "OE3124N2",
      businessLine: "OCEAN",
      entityNameRaw: "373 CARGO INCORPORATED",
      quickBooksEntityId: null,
      invoiceNumber: "ONUR512",
      invoiceDate: "2026-06-18",
      dueDate: "2026-07-18",
      currency: "USD",
      totalAmount: 2500,
      productOrAccountName: "5020 Ocean Freight Rate"
    });
    expect(draft.issueCodes).toContain("MISSING_QB_MATCH");
  });
});
