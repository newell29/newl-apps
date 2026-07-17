import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGarlandTeamshipReview,
  parseGarlandShippingOrderPages,
  parseTeamshipAlertDigest
} from "@/modules/shipment-documents/teamship-review";
import { buildTeamshipPayloadInspection } from "@/modules/shipment-documents/teamship-payload-inspector";
import type { GarlandPdfShippingOrder, TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";
import {
  fetchTeamshipShippingOrdersForReview,
  parseTeamshipShippingOrderUiPage
} from "@/server/integrations/teamship";

const pageFive = `Ship-To Pre-Shipper Print Date
10018968 PS210210 7/10/2026
Pre-ShipperNELLA TORONTO
P I C K L I S T/P R E - S H I P P E R
433 QUEEN ST. E
TORONTO, ON M5A 1T5
Canada
Order Number SR811861 Ship To PO 2028CTCCONVO Frt Terms PPDg
Order Date 7/9/2026 Ship Via UPS CD STD
PLEASE DELIVER TO ARLEIGH NELLA @ 647-308-0048
TAG: SPIRIT OF YORK
Ln Item Number T Site
Location
Lot/Serial
Ref Ship Qty Qty Open UM Due
 Shipped
3 C-CARE-P 891210
CONVOCARE (2) 10 LITER JUGS PRE MIXED - CCC202
1.00 EA 7/13/2026
NEWLS 1.00 (              )
1 C-CLEAN-FORTE 891210
C-CLEAN STRONG CLEANING STRENGTH (2) 10 LT CONT
1.00 EA 7/13/2026
NEWLS 1.00 (              )
7/10/2026 2:18:19 PM1 / 2`;

const pageSix = `Ship-To Pre-Shipper Print Date
10018968 PS210210 7/10/2026
Pre-ShipperNELLA TORONTO
P I C K L I S T/P R E - S H I P P E R
433 QUEEN ST. E
TORONTO, ON M5A 1T5
Canada
Sales Order SR811861 Order Date 7/9/2026 Ship To PO 2028CTCCONVO
Ln Item Number T Site
Location
Lot/Serial
Ref Ship Qty Qty Open UM Due
 Shipped
2 TUBE KIT - MIXED 891210
(1) Red Tube Kit, (1) Green Tube Kit
1.00 EA 7/10/2026
MACKIE 1.00 (              )
7/10/2026 2:18:19 PM2 / 2`;

const pageOne = `Ship-To Pre-Shipper Print Date
00096658 PS210206 7/10/2026
Pre-ShipperJ.R. MAHONEY LTD.
P I C K L I S T/P R E - S H I P P E R
1810 KINGS ROAD
SYDNEY, NS B1L 1C5
Canada
Order Number SR808478 Ship To PO 0000037656 Frt Terms PPADD-CD
Order Date 5/29/2026 Ship Via MIDLAND
MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND
ATTN. RECEIVING
FREIGHT QUOTE 97068
Ln Item Number T Site
Location
Lot/Serial
Ref Ship Qty Qty Open UM Due
 Shipped
1 E1SGHMV6XHU3US 891210
E1S 208/240/60/1-15 AMP
1.00 EA 7/13/2026
NEWLS 2604816191908 1.00 (              )
7/10/2026 2:18:18 PM1 / 1`;

const alertDigest = `Teamship Alert Digest

Shipping Orders — Out of Stock (4)

**Order SR811689**

Item Number\tDescription\tRequested Qty\tSerial Number
**6051XL-S**\t**2 SECT SOLID DOOR REFG SPECIAL OPTIONS**\t**1**\t**2507820100242**
**Order** **SR811861**

Item Number\tDescription\tRequested Qty\tSerial Number
C-CLEAN-FORTE\tC-CLEAN STRONG CLEANING STRENGTH (2) 10 LT CONT\t1\tN/A
**TUBE KIT - MIXED**\t**(1) Red Tube Kit, (1) Green Tube Kit**\t**1**\t**N/A**
C-CARE-P\tCONVOCARE (2) 10 LITER JUGS PRE MIXED - CCC202\t1\tN/A
**Order SR812055**

Item Number\tDescription\tRequested Qty\tSerial Number
[**32Z4178**](https://app.teamshipos.com/view-product/46023)\t**NON-STICK COOKING LINER**\t**4**\t**N/A**
32Z4175\tFULL SIZE COOKING TRAY BLACK\t1\tN/A
CMC1032\tMERRYCHEF OVEN CLEANER 6 BOTTLES/CASE\t1\tN/A
CMC1033\tMERRYCHEF OVEN PROTECTOR 6 BOTTLES/CASE\t1\tN/A
**Order SR811494**`;

describe("Garland Teamship review", () => {
  afterEach(() => {
    delete process.env.TEAMSHIP_EMAIL;
    delete process.env.TEAMSHIP_PASSWORD;
    delete process.env.TEAMSHIP_API_BASE_URL;
    delete process.env.TEAMSHIP_LIST_PAGE_LIMIT;
    delete process.env.TEAMSHIP_MAX_LIST_PAGES;
    vi.restoreAllMocks();
  });

  it("extracts Garland PDF orders and merges multi-page orders by PS/SR", () => {
    const orders = parseGarlandShippingOrderPages([
      { pageNumber: 5, text: pageFive },
      { pageNumber: 6, text: pageSix }
    ]);

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      psNumber: "PS210210",
      srNumber: "SR811861",
      shipToName: "NELLA TORONTO",
      shipToCity: "TORONTO",
      shipToState: "ON",
      shipToPostalCode: "M5A 1T5",
      shipVia: "UPS CD STD",
      pageNumbers: [5, 6]
    });
    expect(orders[0]?.items.map((item) => item.sku)).toEqual(["C-CARE-P", "C-CLEAN-FORTE", "TUBE KIT - MIXED"]);
  });

  it("normalizes multi-line ship-to addresses with the street line first", () => {
    const orders = parseGarlandShippingOrderPages([
      {
        pageNumber: 1,
        text: `Ship-To Pre-Shipper Print Date
11906259 PS210360 7/17/2026
Pre-Shipper
MR SUB - STORE #MRS0615
JANE PARK PLAZA
C-883 JANE STREET
TORONTO, ON M6N 4C4
Canada
P I C K L I S T/P R E - S H I P P E R
Order Number SR812840 Ship To PO 130692 Frt Terms PPDG
Order Date 7/17/2026 Ship Via UPS CD STD
ATTENTION RECEIVING C/O BAHRAM YUSEFI-KORDESTANI - TEL:416-767-0883
Ln Item Number T Site
Location
Lot/Serial
Ref Ship Qty Qty Open UM Due
 Shipped
1 SF335CER 891210
X16 TOP PANINI GRILL PLATE
1.00 EA 7/17/2026`
      }
    ]);

    expect(orders[0]).toMatchObject({
      psNumber: "PS210360",
      srNumber: "SR812840",
      shipToName: "MR SUB - STORE #MRS0615",
      shipToAddress1: "C-883 JANE STREET, JANE PARK PLAZA",
      shipToCity: "TORONTO",
      shipToState: "ON",
      shipToPostalCode: "M6N 4C4",
      shipToCountry: "Canada"
    });
  });

  it("parses Teamship alert digest orders and item details", () => {
    const alerts = parseTeamshipAlertDigest(alertDigest);

    expect(alerts.map((alert) => alert.srNumber)).toEqual(["SR811689", "SR811861", "SR812055", "SR811494"]);
    expect(alerts[1]).toMatchObject({
      srNumber: "SR811861",
      reason: "Out of Stock",
      items: [
        { itemNumber: "C-CLEAN-FORTE", requestedQuantity: "1", serialNumber: "N/A" },
        { itemNumber: "TUBE KIT - MIXED", requestedQuantity: "1", serialNumber: "N/A" },
        { itemNumber: "C-CARE-P", requestedQuantity: "1", serialNumber: "N/A" }
      ]
    });
    expect(alerts[2]?.items[0]).toMatchObject({
      itemNumber: "32Z4178",
      description: "NON-STICK COOKING LINER",
      requestedQuantity: "4",
      serialNumber: "N/A"
    });
    expect(alerts[3]).toMatchObject({ srNumber: "SR811494", items: [] });
  });

  it("marks missing Teamship orders amber when they are in the alert digest", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 5, text: pageFive }]);
    const review = buildGarlandTeamshipReview([pdfOrder!], [], parseTeamshipAlertDigest(alertDigest));

    expect(review.summary).toMatchObject({
      pdfOrderCount: 1,
      teamshipMatchedCount: 0,
      passedCount: 0,
      failedCount: 0,
      missingTeamshipCount: 0,
      pendingTeamshipCount: 1
    });
    expect(review.reviews[0]).toMatchObject({
      status: "PENDING_TEAMSHIP",
      issueCount: 0,
      alert: { srNumber: "SR811861", reason: "Out of Stock" }
    });
    expect(review.reviews[0]?.fields[0]).toMatchObject({
      status: "PENDING",
      label: "Teamship alert"
    });
  });

  it("classifies the 12-order sample as matched or alert-backed pending", () => {
    const pdfOrders: GarlandPdfShippingOrder[] = [
      samplePdfOrder({
        psNumber: "PS210206",
        srNumber: "SR808478",
        pageNumbers: [1],
        shipVia: "MIDLAND",
        shipToName: "J.R. MAHONEY LTD.",
        shipToPo: "0000037656",
        freightTerms: "PPADD-CD",
        itemSkus: ["E1SGHMV6XHU3US"],
        serialNumbers: ["2604816191908"]
      }),
      samplePdfOrder({
        psNumber: "PS210207",
        srNumber: "SR795656",
        pageNumbers: [2],
        shipVia: "SPEEDY",
        shipToName: "CHIPOTLE #5520",
        shipToPo: "6038",
        freightTerms: "PPD&ADDg",
        itemSkus: ["X12DBMV6DFL1CHUS"],
        serialNumbers: ["2512816191817"]
      }),
      samplePdfOrder({
        psNumber: "PS210208",
        srNumber: "SR808173",
        pageNumbers: [3],
        shipVia: "UPS CD STD",
        shipToName: "N WASSERSTROM",
        shipToPo: "OP00033958",
        freightTerms: "COLG",
        itemSkus: ["EFW800-5001"],
        serialNumbers: ["2605891101426"]
      }),
      samplePdfOrder({
        psNumber: "PS210209",
        srNumber: "SR809846",
        pageNumbers: [4],
        shipVia: "SPEEDY",
        shipToName: "CENTRE DE DISTRIBUTION #2 DOYON",
        shipToPo: "148856",
        freightTerms: "PPADD-CD",
        itemSkus: ["G48-8LL-5008"],
        serialNumbers: ["2606891101417"]
      }),
      samplePdfOrder({
        psNumber: "PS210210",
        srNumber: "SR811861",
        pageNumbers: [5, 6],
        shipVia: "UPS CD STD",
        shipToName: "NELLA TORONTO",
        shipToPo: "2028CTCCONVO",
        freightTerms: "PPDg",
        itemSkus: ["C-CARE-P", "C-CLEAN-FORTE", "TUBE KIT - MIXED"],
        serialNumbers: []
      }),
      samplePdfOrder({
        psNumber: "PS210211",
        srNumber: "SR810387",
        pageNumbers: [7],
        shipVia: "P/U",
        shipToName: "BARRIE EQUIPMENT SALES",
        shipToPo: "2026BES8129",
        freightTerms: "PU",
        itemSkus: ["GTGG48-GT48M-5016"],
        serialNumbers: ["2606891100446"]
      }),
      samplePdfOrder({
        psNumber: "PS210212",
        srNumber: "SR811920",
        pageNumbers: [8],
        shipVia: "UPS CD STD",
        shipToName: "STOP REST EQUIP & SUPPL",
        shipToPo: "15378",
        freightTerms: "PPADD-CD",
        itemSkus: ["8030445"],
        serialNumbers: []
      }),
      samplePdfOrder({
        psNumber: "PS210213",
        srNumber: "SR810386",
        pageNumbers: [9],
        shipVia: "SPEEDY",
        shipToName: "LES ENTREPR TZANET INC",
        shipToPo: "84269",
        freightTerms: "PPADD-CD",
        itemSkus: ["GTBG36-NR36-5001"],
        serialNumbers: ["2605891101919", "2606891101462"]
      }),
      samplePdfOrder({
        psNumber: "PS210214",
        srNumber: "SR812055",
        pageNumbers: [10],
        shipVia: "UPS CD STD",
        shipToName: "LES ENTREPR TZANET INC",
        shipToPo: "84542",
        freightTerms: "PPADD-CD",
        itemSkus: ["CMC1032", "CMC1033", "32Z4178", "32Z4175"],
        serialNumbers: []
      }),
      samplePdfOrder({
        psNumber: "PS210215",
        srNumber: "SR811494",
        pageNumbers: [11],
        shipVia: "P/U",
        shipToName: "NELLA CUTLERY",
        shipToPo: "31697",
        freightTerms: "PU",
        itemSkus: ["WB41003AP3AAUL", "C-START-P", "9797-22", "CST20CB-4"],
        serialNumbers: []
      }),
      samplePdfOrder({
        psNumber: "PS210216",
        srNumber: "SR810154",
        pageNumbers: [12],
        shipVia: "SURETRACK STANDARD",
        shipToName: "VANCOUVER AIRPORT HILTON",
        shipToPo: "PO374982",
        freightTerms: "PPADD-CD",
        itemSkus: ["107082", "409355", "24CGP10NEZT"],
        serialNumbers: ["260523051426"]
      }),
      samplePdfOrder({
        psNumber: "PS210217",
        srNumber: "SR809212",
        pageNumbers: [13],
        shipVia: "SURETRACK STANDARD",
        shipToName: "GEANEL RESTAURANT SUPPLIES L",
        shipToPo: "200242",
        freightTerms: "PPADD-CD",
        itemSkus: ["X16SBMV6DFL1CLUS"],
        serialNumbers: ["2604816192633"]
      })
    ];
    const teamshipOrders: TeamshipShippingOrderDetail[] = [
      sampleTeamshipOrder("SR808478", "PS210206", "MIDLAND", "J.R. MAHONEY LTD.", "0000037656", "PPADD-CD", [
        "SKU: E1SGHMV6XHU3US, SN: 2604816191908"
      ]),
      sampleTeamshipOrder("SR795656", "PS210207", "SPEEDY", "CHIPOTLE #5520", "6038", "PPD&ADDg", [
        "SKU: X12DBMV6DFL1CHUS, SN: 2512816191817"
      ]),
      sampleTeamshipOrder("SR808173", "PS210208", "UPS CD STD", "N WASSERSTROM", "OP00033958", "COLG", [
        "SKU: EFW800-5001, SN: 2605891101426"
      ]),
      sampleTeamshipOrder("SR809846", "PS210209", "SPEEDY", "CENTRE DE DISTRIBUTION #2 DOYON", "148856", "PPADD-CD", [
        "SKU: G48-8LL-5008, SN: 2606891101417"
      ]),
      sampleTeamshipOrder("SR810387", "PS210211", "P/U BARRIE EQUIP", "BARRIE EQUIPMENT SALES", "2026BES8129", "PU", [
        "SKU: GTGG48-GT48M-5016, SN: 2606891100446"
      ]),
      sampleTeamshipOrder("SR811920", "PS210212", "UPS CD STD", "STOP REST EQUIP & SUPPL", "15378", "PPADD-CD", [
        "SKU: 8030445, QTY: 4"
      ]),
      sampleTeamshipOrder("SR810386", "PS210213", "SPEEDY", "LES ENTREPR TZANET INC", "84269", "PPADD-CD", [
        "SKU: GTBG36-NR36-5001, SN: 2605891101919, 2606891101462"
      ]),
      sampleTeamshipOrder("SR810154", "PS210216", "SURETRACK STANDARD", "VANCOUVER AIRPORT HILTON", "PO374982", "PPADD-CD", [
        "SKU: 107082, QTY: 1",
        "SKU: 409355, QTY: 1",
        "SKU: 24CGP10NEZT, SN: 260523051426"
      ]),
      sampleTeamshipOrder("SR809212", "PS210217", "SURETRACK STANDARD", "GEANEL RESTAURANT SUPPLIES L", "200242", "PPADD-CD", [
        "SKU: X16SBMV6DFL1CLUS, SN: 2604816192633"
      ])
    ];

    const review = buildGarlandTeamshipReview(pdfOrders, teamshipOrders, parseTeamshipAlertDigest(alertDigest));

    expect(review.summary).toMatchObject({
      pdfOrderCount: 12,
      teamshipMatchedCount: 9,
      passedCount: 9,
      failedCount: 0,
      missingTeamshipCount: 0,
      pendingTeamshipCount: 3
    });
    expect(review.reviews.filter((order) => order.status === "PENDING_TEAMSHIP").map((order) => order.srNumber)).toEqual([
      "SR811861",
      "SR812055",
      "SR811494"
    ]);
  });

  it("extracts ship-to details when PDF.js places Pre-Shipper after the name", () => {
    const orders = parseGarlandShippingOrderPages([
      {
        pageNumber: 1,
        text: `Ship-To Pre-Shipper Print Date
00096658 PS210206 7/10/2026
J.R. MAHONEY LTD. Pre-Shipper
1810 KINGS ROAD
SYDNEY, NS B1L 1C5
Canada
P I C K L I S T/P R E - S H I P P E R
Order Number SR808478 Ship To PO 0000037656 Frt Terms PPADD-CD
Order Date 5/29/2026 Ship Via MIDLAND
Ln Item Number T Ship Qty Qty Open UM
1 E1SGHMV6XHU3US 891210
1.00 EA 7/13/2026
NEWLS 2604816191908 1.00 ( )`
      }
    ]);

    expect(orders[0]).toMatchObject({
      psNumber: "PS210206",
      srNumber: "SR808478",
      shipToName: "J.R. MAHONEY LTD.",
      shipToAddress1: "1810 KINGS ROAD",
      shipToCity: "SYDNEY",
      shipToState: "NS",
      shipToPostalCode: "B1L 1C5",
      shipToCountry: "Canada"
    });
  });

  it("marks reviewed orders green when Teamship detail matches the Garland PDF", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 1, text: pageOne }]);
    const teamshipOrder: TeamshipShippingOrderDetail = {
      id: 123,
      shipment_id: "SR808478",
      record_no: "PS210206",
      carrier: "Midland Transport",
      po_number: "0000037656",
      edi_field_3: "PPADD-CD",
      ship_to_name: "J.R. MAHONEY LTD.",
      ship_to_address_1: "1810 KINGS ROAD",
      ship_to_city: "SYDNEY",
      ship_to_state: "NS",
      ship_to_zip: "B1L 1C5",
      ship_to_country: "CA",
      shipping_instructions: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND ATTN. RECEIVING FREIGHT QUOTE 97068",
      items: [{ sku: "E1SGHMV6XHU3US", inventory_count: 1 }],
      custom_fields: [{ label: "Commodity", value: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" }]
    };

    const review = buildGarlandTeamshipReview([pdfOrder!], [teamshipOrder]);

    expect(review.summary).toMatchObject({
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 1,
      failedCount: 0,
      missingTeamshipCount: 0
    });
    expect(review.reviews[0]?.status).toBe("PASS");
  });

  it("marks discrepancies red with field-level reasons", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 1, text: pageOne }]);
    const teamshipOrder: TeamshipShippingOrderDetail = {
      id: 123,
      shipment_id: "SR808478",
      record_no: "PS210206",
      carrier: "Speedy",
      po_number: "WRONG-PO",
      edi_field_3: "PPADD-CD",
      ship_to_name: "J.R. MAHONEY LTD.",
      ship_to_address_1: "1810 KINGS ROAD",
      ship_to_city: "SYDNEY",
      ship_to_state: "NS",
      ship_to_zip: "B1L 1C5",
      ship_to_country: "CA",
      shipping_instructions: "ATTN. RECEIVING",
      items: [{ sku: "DIFFERENT-SKU", inventory_count: 1 }]
    };

    const review = buildGarlandTeamshipReview([pdfOrder!], [teamshipOrder]);

    expect(review.summary.failedCount).toBe(1);
    expect(review.reviews[0]?.status).toBe("FAIL");
    expect(review.reviews[0]?.fields.filter((field) => field.status === "DISCREPANCY").map((field) => field.key)).toEqual(
      expect.arrayContaining(["po_number", "carrier", "items", "serialNumbers"])
    );
  });

  it("calls out Teamship orders with no uploaded PDF and skips already-reviewed PDF orders", () => {
    const newPdfOrder = samplePdfOrder({
      psNumber: "PS210300",
      srNumber: "SR812300",
      pageNumbers: [1],
      shipVia: "MIDLAND",
      shipToName: "NEW PDF CUSTOMER",
      shipToPo: "PO-NEW",
      freightTerms: "PPADD-CD",
      itemSkus: ["SKU-NEW"],
      serialNumbers: []
    });
    const alreadyReviewedPdfOrder = samplePdfOrder({
      psNumber: "PS210301",
      srNumber: "SR812301",
      pageNumbers: [2],
      shipVia: "SPEEDY",
      shipToName: "ALREADY REVIEWED CUSTOMER",
      shipToPo: "PO-OLD",
      freightTerms: "PPADD-CD",
      itemSkus: ["SKU-OLD"],
      serialNumbers: []
    });
    const teamshipOrders: TeamshipShippingOrderDetail[] = [
      sampleTeamshipOrder("SR812300", "PS210300", "MIDLAND", "NEW PDF CUSTOMER", "PO-NEW", "PPADD-CD", ["SKU: SKU-NEW"]),
      sampleTeamshipOrder("SR812301", "PS210301", "SPEEDY", "ALREADY REVIEWED CUSTOMER", "PO-OLD", "PPADD-CD", ["SKU: SKU-OLD"]),
      sampleTeamshipOrder("SR812302", "PS210302", "SURETRACK STANDARD", "NO PDF CUSTOMER", "PO-NO-PDF", "PPADD-CD", [
        "SKU: SKU-NO-PDF"
      ])
    ];

    const review = buildGarlandTeamshipReview([newPdfOrder], teamshipOrders, [], {
      includeUnmatchedTeamshipOrders: true,
      skippedAlreadyReviewedOrders: [alreadyReviewedPdfOrder]
    });

    expect(review.summary).toMatchObject({
      pdfOrderCount: 1,
      passedCount: 1,
      noPdfCount: 1,
      skippedAlreadyReviewedCount: 1
    });
    expect(review.reviews.map((order) => [order.srNumber, order.status])).toEqual([
      ["SR812300", "PASS"],
      ["SR812302", "NO_PDF"],
      ["SR812301", "SKIPPED_ALREADY_REVIEWED"]
    ]);
  });

  it("compares Teamship UI-style field names and commodity SKU values", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 1, text: pageOne }]);
    const teamshipOrder: TeamshipShippingOrderDetail = {
      id: 30202,
      amazon_shipment_id1: "SR808478",
      carrier_value: "MIDLAND",
      poNumber: "0000037656",
      ship_first_name: "J.R. MAHONEY LTD.",
      ship_address_1: "1810 KINGS ROAD",
      ship_city: "SYDNEY",
      ship_state: "NS",
      ship_zip: "B1L 1C5",
      ship_country: "CA",
      edi_field_2: "PS210206-SR808478",
      edi_field_3: "PPADD-CD",
      edi_field_4: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND ATTN. RECEIVING FREIGHT QUOTE 97068",
      pallets: [
        { quantity: 1, length: 1, width: 1, height: 1, weight: 1, commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" }
      ]
    };

    const review = buildGarlandTeamshipReview([pdfOrder!], [teamshipOrder]);

    expect(review.summary).toMatchObject({
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 1,
      failedCount: 0,
      missingTeamshipCount: 0
    });
    expect(review.reviews[0]?.status).toBe("PASS");
  });

  it("maps Teamship UI/custom labels for freight terms, special instructions, and serials", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 1, text: pageOne }]);
    const teamshipOrder = {
      id: 30202,
      amazon_shipment_id1: "SR808478",
      carrier_value: "MIDLAND",
      poNumber: "0000037656",
      ship_first_name: "J.R. MAHONEY LTD.",
      ship_address_1: "1810 KINGS ROAD",
      ship_city: "SYDNEY",
      ship_state: "NS",
      ship_zip: "B1L 1C5",
      ship_country: "CA",
      edi_field_2: "PS210206-SR808478",
      special_instructions: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND ATTN. RECEIVING FREIGHT QUOTE 97068",
      custom_fields: [
        { label: "Freight Terms Code", value: "PPADD-CD" },
        { label: "Commodity", value: "SKU: E1SGHMV6XHU3US" }
      ],
      order_items: [
        {
          sku: "E1SGHMV6XHU3US",
          product: {
            serial: "2604816191908"
          }
        }
      ]
    } as unknown as TeamshipShippingOrderDetail;

    const review = buildGarlandTeamshipReview([pdfOrder!], [teamshipOrder]);
    const fieldsByKey = new Map(review.reviews[0]?.fields.map((field) => [field.key, field]));

    expect(review.summary).toMatchObject({
      passedCount: 1,
      failedCount: 0
    });
    expect(fieldsByKey.get("freight_terms")).toMatchObject({ status: "MATCH", teamshipValue: "PPADD-CD" });
    expect(fieldsByKey.get("serialNumbers")).toMatchObject({ status: "MATCH", teamshipValue: "2604816191908" });
    expect(fieldsByKey.get("shipping_instructions")).toMatchObject({ status: "MATCH" });
  });

  it("compares and exposes every SKU and serial for multi-line Teamship orders", () => {
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210207",
      srNumber: "SR811861",
      pageNumbers: [1],
      shipVia: "SPEEDY",
      shipToName: "CHIPOTLE #5520",
      shipToPo: "PO-1",
      freightTerms: "PPADD-CD",
      itemSkus: ["C-CLEAN-FORTE", "TUBE KIT - MIXED", "C-CARE-P"],
      serialNumbers: []
    });
    pdfOrder.items[0]!.serialNumbers = ["2501111111111"];
    pdfOrder.items[1]!.serialNumbers = ["2502222222222"];
    pdfOrder.items[2]!.serialNumbers = ["2503333333333"];
    const teamshipOrder = {
      id: 30203,
      amazon_shipment_id1: "SR811861",
      carrier_value: "SPEEDY",
      poNumber: "PO-1",
      ship_first_name: "CHIPOTLE #5520",
      ship_address_1: "MATCHING ADDRESS",
      ship_city: "MILTON",
      ship_state: "ON",
      ship_zip: "L5T 2V5",
      ship_country: "CA",
      edi_field_2: "PS210207-SR811861",
      edi_field_3: "PPADD-CD",
      order_items: [
        {
          sku: "C-CLEAN-FORTE",
          quantity: 1,
          product: { serial: "2501111111111" }
        },
        {
          sku: "TUBE KIT - MIXED",
          quantity: 1,
          serial_number: "2502222222222"
        },
        {
          sku: "C-CARE-P",
          quantity: 1,
          product: { serialNumber: "2503333333333" }
        }
      ]
    } as unknown as TeamshipShippingOrderDetail;

    const review = buildGarlandTeamshipReview([pdfOrder], [teamshipOrder]);
    const fieldsByKey = new Map(review.reviews[0]?.fields.map((field) => [field.key, field]));

    expect(fieldsByKey.get("items")).toMatchObject({ status: "MATCH" });
    expect(fieldsByKey.get("serialNumbers")).toMatchObject({
      status: "MATCH",
      teamshipValue: "2501111111111, 2502222222222, 2503333333333"
    });
    expect(review.reviews[0]?.pdfItems).toHaveLength(3);
    expect(review.reviews[0]?.teamshipItems).toEqual([
      { sku: "C-CLEAN-FORTE", quantity: "1", serialNumbers: ["2501111111111"] },
      { sku: "TUBE KIT - MIXED", quantity: "1", serialNumbers: ["2502222222222"] },
      { sku: "C-CARE-P", quantity: "1", serialNumbers: ["2503333333333"] }
    ]);
  });

  it("inspects fetched Teamship payload paths for expected serial values", () => {
    const inspection = buildTeamshipPayloadInspection({
      srNumber: "SR808478",
      expectedSerials: ["2604816191908"],
      expectedSkus: ["E1SGHMV6XHU3US"],
      teamshipOrder: {
        id: 30202,
        shipment_id: "SR808478",
        items: [
          {
            sku: "E1SGHMV6XHU3US",
            product: {
              serial: "2604816191908"
            }
          }
        ]
      }
    });

    expect(inspection.conclusion).toBe("EXPECTED_SERIAL_FOUND");
    expect(inspection.exactSerialMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.items[0].product.serial",
          matchedValue: "2604816191908",
          reason: "EXPECTED_SERIAL"
        })
      ])
    );
    expect(inspection.skuMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.items[0].sku",
          matchedValue: "E1SGHMV6XHU3US"
        })
      ])
    );
  });

  it("reports when the current Teamship payload has no serial evidence", () => {
    const inspection = buildTeamshipPayloadInspection({
      srNumber: "SR808478",
      expectedSerials: ["2604816191908"],
      expectedSkus: ["E1SGHMV6XHU3US"],
      teamshipOrder: {
        id: 30202,
        shipment_id: "SR808478",
        items: [{ sku: "E1SGHMV6XHU3US" }]
      }
    });

    expect(inspection.conclusion).toBe("NO_SERIAL_EVIDENCE");
    expect(inspection.exactSerialMatches).toEqual([]);
    expect(inspection.serialLikeMatches).toEqual([]);
    expect(inspection.message).toContain("separate Teamship");
  });

  it("adds SKU dimension recommendations from Teamship pallets and Garland reference rows", () => {
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210500",
      srNumber: "SR812500",
      pageNumbers: [1],
      shipVia: "MIDLAND",
      shipToName: "DIM TEST CUSTOMER",
      shipToPo: "PO-DIMS",
      freightTerms: "PPADD-CD",
      itemSkus: ["99560025", "X16SBMV6DFL1CLUS"],
      serialNumbers: []
    });
    const teamshipOrder = sampleTeamshipOrder("SR812500", "PS210500", "MIDLAND", "DIM TEST CUSTOMER", "PO-DIMS", "PPADD-CD", [
      "SKU: X16SBMV6DFL1CLUS, SN: 2604816192633"
    ]);
    teamshipOrder.pallets = [
      {
        quantity: 1,
        length: 35,
        width: 25,
        height: 33,
        weight: 180,
        weight_unit: "lbs",
        commodity: "SKU: X16SBMV6DFL1CLUS, SN: 2604816192633"
      }
    ];

    const review = buildGarlandTeamshipReview([pdfOrder], [teamshipOrder]);

    expect(review.reviews[0]?.productDimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: "99560025",
          source: "GARLAND_REFERENCE",
          lengthIn: 48,
          widthIn: 40,
          heightIn: 16,
          weightLb: 81,
          confidence: "HIGH"
        }),
        expect.objectContaining({
          sku: "X16SBMV6DFL1CLUS",
          source: "TEAMSHIP_PALLET",
          lengthIn: 35,
          widthIn: 25,
          heightIn: 33,
          weightLb: 180,
          confidence: "HIGH"
        })
      ])
    );
  });

  it("adds learned Teamship dimension recommendations ahead of Garland reference rows", () => {
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210502",
      srNumber: "SR812502",
      pageNumbers: [1],
      shipVia: "MIDLAND",
      shipToName: "LEARNED DIM TEST CUSTOMER",
      shipToPo: "PO-LEARNED-DIMS",
      freightTerms: "PPADD-CD",
      itemSkus: ["99560025"],
      serialNumbers: []
    });

    const review = buildGarlandTeamshipReview([pdfOrder], [], [], {
      learnedProductDimensions: [
        {
          sku: "99560025",
          source: "TEAMSHIP_LEARNED",
          productType: null,
          quantity: null,
          lengthIn: 50,
          widthIn: 42,
          heightIn: 18,
          weightLb: 90,
          weightUnit: "lbs",
          confidence: "MEDIUM",
          note: "Learned from 1 saved Teamship pallet observation."
        }
      ]
    });
    const dimensions = review.reviews[0]?.productDimensions ?? [];

    expect(dimensions.map((dimension) => dimension.source)).toEqual(["TEAMSHIP_LEARNED", "GARLAND_REFERENCE"]);
    expect(dimensions[0]).toMatchObject({
      sku: "99560025",
      source: "TEAMSHIP_LEARNED",
      lengthIn: 50,
      widthIn: 42,
      heightIn: 18,
      weightLb: 90
    });
  });

  it("uses the Garland UPS placeholder dimension rule instead of SKU-specific dimensions", () => {
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210501",
      srNumber: "SR812501",
      pageNumbers: [1],
      shipVia: "UPS CD STD",
      shipToName: "UPS DIM TEST CUSTOMER",
      shipToPo: "PO-UPS-DIMS",
      freightTerms: "PPADD-CD",
      itemSkus: ["99560025"],
      serialNumbers: []
    });
    const teamshipOrder = sampleTeamshipOrder(
      "SR812501",
      "PS210501",
      "UPS",
      "UPS DIM TEST CUSTOMER",
      "PO-UPS-DIMS",
      "PPADD-CD",
      ["SKU: 99560025"]
    );
    teamshipOrder.pallets = [
      {
        quantity: 1,
        length: 48,
        width: 40,
        height: 16,
        weight: 81,
        weight_unit: "lbs",
        commodity: "SKU: 99560025"
      }
    ];

    const review = buildGarlandTeamshipReview([pdfOrder], [teamshipOrder]);

    expect(review.reviews[0]?.productDimensions).toEqual([
      expect.objectContaining({
        sku: "99560025",
        source: "UPS_RULE",
        lengthIn: 1,
        widthIn: 1,
        heightIn: 1,
        weightLb: 1,
        confidence: "HIGH"
      })
    ]);
    expect(review.reviews[0]?.productDimensions.map((dimension) => dimension.source)).not.toContain("GARLAND_REFERENCE");
    expect(review.reviews[0]?.productDimensions.map((dimension) => dimension.source)).not.toContain("TEAMSHIP_PALLET");
  });

  it("fetches Teamship details read-only by Garland SR/shipment ID", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        expect(init?.method).toBe("POST");
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        expect(init?.method ?? "GET").toBe("GET");
        return Response.json({
          data: [
            { id: 10, shipment_id: "SR808478", customer: { company: "Garland Canada Distribution" } },
            { id: 11, shipment_id: "SR000000", customer: { company: "Other Customer" } }
          ]
        });
      }

      if (url.endsWith("/v1/ship-inventories/10")) {
        expect(init?.method ?? "GET").toBe("GET");
        return Response.json({
          data: {
            id: 10,
            record_no: "PS210206"
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toMatchObject([
      {
        id: 10,
        shipment_id: "SR808478",
        record_no: "PS210206",
        customer: { company: "Garland Canada Distribution" },
        url: "https://teamship.test/ship-inventories/10"
      }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET" || init?.method === "POST")).toBe(
      true
    );
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes("/v1/ship-inventories") && init?.method)).toBe(
      false
    );
  });

  it("parses Teamship UI page inventory serials from hidden order data", () => {
    const parsed = parseTeamshipShippingOrderUiPage(
      sampleTeamshipUiPageHtml({
        sku: "E1SGHMV6XHU3US",
        serial: "2604816191908",
        quantity: 1,
        commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908"
      })
    );

    expect(parsed.items).toEqual([
      expect.objectContaining({
        sku: "E1SGHMV6XHU3US",
        quantity: "1",
        serial_number: "2604816191908",
        product: {
          sku: "E1SGHMV6XHU3US",
          serial: "2604816191908"
        }
      })
    ]);
    expect(parsed.pallet_dims).toEqual([
      expect.objectContaining({
        quantity: "1",
        length: "1",
        width: "1",
        height: "1",
        weight: "1",
        weight_unit: "lbs",
        commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908"
      })
    ]);
  });

  it("enriches targeted Teamship orders from the UI page when API detail omits serials", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 30202, shipment_id: "SR808478", customer: { company: "Garland Canada Distribution" } }]
        });
      }

      if (url.endsWith("/api/v1/ship-inventories/30202")) {
        return Response.json({
          data: {
            id: 30202,
            shipment_id: "SR808478",
            edi_field_2: "PS210206-SR808478",
            items: [{ sku: "E1SGHMV6XHU3US", quantity: 1 }]
          }
        });
      }

      if (url.endsWith("/login") && (init?.method ?? "GET") === "GET") {
        return new Response('<input type="hidden" name="_token" value="csrf-1">', {
          headers: {
            "set-cookie": "teamship_session=before-login; Path=/"
          }
        });
      }

      if (url.endsWith("/login") && init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: {
            "set-cookie": "teamship_session=after-login; Path=/"
          }
        });
      }

      if (url.endsWith("/ship-inventories/30202")) {
        expect(init?.headers).toMatchObject({
          cookie: "teamship_session=after-login"
        });
        return new Response(
          sampleTeamshipUiPageHtml({
            sku: "E1SGHMV6XHU3US",
            serial: "2604816191908",
            quantity: 1,
            commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908"
          })
        );
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 30202,
      shipment_id: "SR808478",
      url: "https://teamship.test/ship-inventories/30202",
      items: [
        { sku: "E1SGHMV6XHU3US", quantity: 1 },
        {
          sku: "E1SGHMV6XHU3US",
          quantity: "1",
          serial_number: "2604816191908",
          product: {
            sku: "E1SGHMV6XHU3US",
            serial: "2604816191908"
          }
        }
      ],
      pallet_dims: [
        expect.objectContaining({
          commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908"
        })
      ]
    });
  });

  it("uses Teamship API detail serials without falling back to the UI page", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://app.teamshipos.com/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/api/v1/login")) {
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/api/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 30202, shipment_id: "SR808478", customer: { company: "Garland Canada Distribution" } }]
        });
      }

      if (url.endsWith("/api/v1/ship-inventories/30202")) {
        return Response.json({
          data: {
            id: 30202,
            shipment_id: "SR808478",
            edi_field_2: "PS210206-SR808478",
            items: [
              {
                sku: "E1SGHMV6XHU3US",
                quantity: 1,
                inventory_stock: {
                  serial_number: "2604816191908"
                }
              }
            ]
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210206",
      srNumber: "SR808478",
      pageNumbers: [1],
      shipVia: "MIDLAND",
      shipToName: "MATCHING CUSTOMER",
      shipToPo: "PO-1",
      freightTerms: "PPADD-CD",
      itemSkus: ["E1SGHMV6XHU3US"],
      serialNumbers: ["2604816191908"]
    });
    const review = buildGarlandTeamshipReview([pdfOrder], orders);
    const serialReview = review.reviews[0]?.fields.find((field) => field.key === "serialNumbers");

    expect(serialReview).toMatchObject({
      status: "MATCH",
      pdfValue: "2604816191908",
      teamshipValue: expect.stringContaining("2604816191908")
    });
    expect(orders[0]?.url).toBe("https://app.teamshipos.com/ship-inventories/30202");
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "https://app.teamshipos.com/login")).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "https://app.teamshipos.com/ship-inventories/30202")).toBe(
      false
    );
  });

  it("matches PDF serials after Teamship UI enrichment adds inventory serials", () => {
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210206",
      srNumber: "SR808478",
      pageNumbers: [1],
      shipVia: "MIDLAND",
      shipToName: "MATCHING CUSTOMER",
      shipToPo: "PO-1",
      freightTerms: "PPADD-CD",
      itemSkus: ["E1SGHMV6XHU3US"],
      serialNumbers: ["2604816191908"]
    });
    const parsed = parseTeamshipShippingOrderUiPage(
      sampleTeamshipUiPageHtml({
        sku: "E1SGHMV6XHU3US",
        serial: "2604816191908",
        quantity: 1,
        commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908"
      })
    );
    const teamshipOrder: TeamshipShippingOrderDetail = {
      ...sampleTeamshipOrder("SR808478", "PS210206", "MIDLAND", "MATCHING CUSTOMER", "PO-1", "PPADD-CD", []),
      items: parsed.items,
      pallet_dims: parsed.pallet_dims
    };

    const review = buildGarlandTeamshipReview([pdfOrder], [teamshipOrder]);
    const serialReview = review.reviews[0]?.fields.find((field) => field.key === "serialNumbers");

    expect(serialReview).toMatchObject({
      status: "MATCH",
      pdfValue: "2604816191908",
      teamshipValue: expect.stringContaining("2604816191908")
    });
    expect(review.reviews[0]?.teamshipItems).toEqual([
      expect.objectContaining({
        sku: "E1SGHMV6XHU3US",
        serialNumbers: ["2604816191908"]
      })
    ]);
  });

  it("merges Teamship SKU-only rows with matching pallet serial rows for display", () => {
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210206",
      srNumber: "SR808478",
      pageNumbers: [1],
      shipVia: "MIDLAND",
      shipToName: "MATCHING CUSTOMER",
      shipToPo: "PO-1",
      freightTerms: "PPADD-CD",
      itemSkus: ["E1SGHMV6XHU3US"],
      serialNumbers: ["2604816191908"]
    });
    const teamshipOrder: TeamshipShippingOrderDetail = {
      ...sampleTeamshipOrder("SR808478", "PS210206", "MIDLAND", "MATCHING CUSTOMER", "PO-1", "PPADD-CD", []),
      items: [{ sku: "E1SGHMV6XHU3US", quantity: 1 }],
      pallet_dims: [{ quantity: 1, commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" }]
    };

    const review = buildGarlandTeamshipReview([pdfOrder], [teamshipOrder]);

    expect(review.reviews[0]?.teamshipItems).toEqual([
      {
        sku: "E1SGHMV6XHU3US",
        quantity: "1",
        serialNumbers: ["2604816191908"]
      }
    ]);
  });

  it("ignores Teamship quantity-only artifact rows in SKU summaries", () => {
    const pdfOrder = samplePdfOrder({
      psNumber: "PS210206",
      srNumber: "SR808478",
      pageNumbers: [1],
      shipVia: "MIDLAND",
      shipToName: "MATCHING CUSTOMER",
      shipToPo: "PO-1",
      freightTerms: "PPADD-CD",
      itemSkus: ["E1SGHMV6XHU3US"],
      serialNumbers: ["2604816191908"]
    });
    const teamshipOrder: TeamshipShippingOrderDetail = {
      ...sampleTeamshipOrder("SR808478", "PS210206", "MIDLAND", "MATCHING CUSTOMER", "PO-1", "PPADD-CD", []),
      items: [{ sku: "E1SGHMV6XHU3US", quantity: 1 }, { quantity: 1 }],
      pallet_dims: [
        { quantity: 1, commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" },
        { quantity: 1 }
      ]
    };

    const review = buildGarlandTeamshipReview([pdfOrder], [teamshipOrder]);

    expect(review.reviews[0]?.teamshipItems).toEqual([
      {
        sku: "E1SGHMV6XHU3US",
        quantity: "1",
        serialNumbers: ["2604816191908"]
      }
    ]);
  });

  it("pulls Garland daily orders by selected day when no SR filter is provided", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        return Response.json({
          data: [
            {
              id: 10,
              shipment_id: "SR808478",
              created_at_date: "2026-07-10",
              customer: { company: "Garland Canada Distribution" }
            },
            {
              id: 11,
              shipment_id: "SR795656",
              created_at_date: "2026-07-10",
              customer: { company: "Other Customer" }
            },
            {
              id: 12,
              shipment_id: "SR810154",
              created_at_date: "2026-07-09",
              customer: { company: "Garland Canada Distribution" }
            }
          ]
        });
      }

      if (url.endsWith("/v1/ship-inventories/10")) {
        return Response.json({
          data: {
            id: 10,
            record_no: "PS210206"
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      shipmentDate: "2026-07-10",
      srNumbers: [],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 10,
      shipment_id: "SR808478",
      record_no: "PS210206",
      customer: { company: "Garland Canada Distribution" }
    });
  });

  it("uses one-time runtime credentials without requiring Teamship env vars", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "one-time@example.com",
          password: "not-stored"
        });
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 10, shipment_id: "SR808478", customer: { company: "Garland Canada Distribution" } }]
        });
      }

      if (url.endsWith("/v1/ship-inventories/10")) {
        return Response.json({ data: { id: 10, record_no: "PS210206" } });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      credentials: {
        email: "one-time@example.com",
        password: "not-stored"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 10,
      shipment_id: "SR808478",
      record_no: "PS210206"
    });
  });

  it("finds Teamship orders when the shipment ID is returned in UI-style fields", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 30202, amazon_shipment_id1: "SR808478", customer: { company: "Garland Canada Distribution" } }]
        });
      }

      if (url.endsWith("/v1/ship-inventories/30202")) {
        return Response.json({
          data: {
            id: 30202,
            amazon_shipment_id1: "SR808478",
            edi_field_2: "PS210206-SR808478"
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 30202,
      amazon_shipment_id1: "SR808478",
      edi_field_2: "PS210206-SR808478"
    });
  });

  it("continues targeted SR searches beyond the old 12-page scan depth", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_LIST_PAGE_LIMIT = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        const requestUrl = new URL(url);
        const offset = Number.parseInt(requestUrl.searchParams.get("offset") ?? "0", 10);

        return Response.json({
          data: [
            offset === 12
              ? { id: 30202, shipment_id: "SR808478", customer: { company: "Garland Canada Distribution" } }
              : { id: 10000 + offset, shipment_id: `SRMISS${offset}`, customer: { company: "Garland Canada Distribution" } }
          ]
        });
      }

      if (url.endsWith("/v1/ship-inventories/30202")) {
        return Response.json({ data: { id: 30202, shipment_id: "SR808478", record_no: "PS210206" } });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 30202,
      shipment_id: "SR808478",
      record_no: "PS210206"
    });
  });
});

function samplePdfOrder({
  psNumber,
  srNumber,
  pageNumbers,
  shipVia,
  shipToName,
  shipToPo,
  freightTerms,
  itemSkus,
  serialNumbers
}: {
  psNumber: string;
  srNumber: string;
  pageNumbers: number[];
  shipVia: string;
  shipToName: string;
  shipToPo: string;
  freightTerms: string;
  itemSkus: string[];
  serialNumbers: string[];
}): GarlandPdfShippingOrder {
  return {
    pageNumbers,
    psNumber,
    srNumber,
    shipToCode: null,
    shipToName,
    shipToAddress1: "MATCHING ADDRESS",
    shipToCity: "MATCHING CITY",
    shipToState: "ON",
    shipToPostalCode: "L5T 2V5",
    shipToCountry: "Canada",
    shipToPo,
    freightTerms,
    orderDate: null,
    shipVia,
    instructions: "",
    items: itemSkus.map((sku, index) => ({
      lineNumber: index + 1,
      sku,
      description: "",
      quantity: null,
      dueShipDate: null,
      serialNumbers: index === 0 ? serialNumbers : []
    })),
    rawText: ""
  };
}

function sampleTeamshipOrder(
  srNumber: string,
  psNumber: string,
  carrier: string,
  shipToName: string,
  poNumber: string,
  freightTerms: string,
  commodities: string[]
): TeamshipShippingOrderDetail {
  return {
    amazon_shipment_id1: srNumber,
    carrier_value: carrier,
    poNumber,
    ship_first_name: shipToName,
    ship_address_1: "MATCHING ADDRESS",
    ship_city: "MATCHING CITY",
    ship_state: "ON",
    ship_zip: "L5T 2V5",
    ship_country: "CA",
    edi_field_2: `${psNumber}-${srNumber}`,
    edi_field_3: freightTerms,
    pallets: commodities.map((commodity) => ({ commodity }))
  };
}

function sampleTeamshipUiPageHtml({
  sku,
  serial,
  quantity,
  commodity
}: {
  sku: string;
  serial: string;
  quantity: number;
  commodity: string;
}) {
  const inventories = [
    {
      reserved_quantity: quantity,
      customAttribut: [
        { id: 7, name: "Serial", value: serial, type: "string", options: "READY > ASSIGNED" }
      ],
      pivot: { quantity },
      item: {
        sku: {
          code: sku
        }
      }
    }
  ];
  const escapedInventories = JSON.stringify(inventories).replace(/"/g, "&quot;");

  return `
    <meta name="csrf-token" content="csrf-page">
    <input type="hidden" id="warehouse_id_" value="102">
    <input type="hidden" id="inventories_all" value='${escapedInventories}'>
    <input type="hidden" id="pallets_count" value="1">
    <input id="pallet_1" value="1">
    <input id="pallet_1_length" value="1">
    <input id="pallet_1_width" value="1">
    <input id="pallet_1_height" value="1">
    <input id="pallet_1_weight" value="1">
    <input id="pallet_1_weight_unit" value="lbs">
    <input id="pallet_1_commodity" value="${commodity}">
  `;
}
