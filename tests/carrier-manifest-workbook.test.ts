import { describe, expect, it } from "vitest";

import { buildCarrierManifestWorkbookHtml } from "@/modules/shipment-documents/carrier-manifest-workbook";

const manifestRows = [
  {
    carrier: "SURETRACK" as const,
    pageNumber: 2,
    srNumber: "806507",
    psNumber: "PS210245",
    cityProvince: "CALGARY, AB",
    skids: 13,
    confidence: "HIGH" as const,
    notes: null
  }
];

describe("Garland carrier manifest workbook", () => {
  it("sets Excel and CSS print layout to one landscape letter page", () => {
    const html = buildCarrierManifestWorkbookHtml({
      carrierLabel: "Suretrack",
      documentLabel: "July 14, 2026",
      shipmentDate: "2026-07-14",
      rows: manifestRows,
      rowCount: 16,
      palletCount: 13
    });

    expect(html).toContain('<x:Layout x:Orientation="Landscape"/>');
    expect(html).toContain("<x:FitWidth>1</x:FitWidth>");
    expect(html).toContain("<x:FitHeight>1</x:FitHeight>");
    expect(html).toContain("<x:PaperSizeIndex>1</x:PaperSizeIndex>");
    expect(html).toContain("@page{size:letter landscape;margin:0.3in;mso-page-orientation:landscape;}");
    expect(html).toContain("box-sizing:border-box");
  });

  it("keeps the manifest readable with fixed columns, styled rows, and a signature area", () => {
    const html = buildCarrierManifestWorkbookHtml({
      carrierLabel: "Suretrack",
      documentLabel: "July 14, 2026",
      shipmentDate: "2026-07-14",
      rows: manifestRows,
      rowCount: 16,
      palletCount: 13
    });

    expect(html.match(/class="manifest-row/g)).toHaveLength(16);
    expect(html).toContain('<col class="sr-col"/>');
    expect(html).toContain("font-size:11pt");
    expect(html).toContain("Driver signature");
    expect(html).toContain("Manifest date");
    expect(html).toContain('<td class="skids">13</td>');
  });

  it("preserves identifiers as text and escapes labels safely", () => {
    const html = buildCarrierManifestWorkbookHtml({
      carrierLabel: "Suretrack & Sons",
      documentLabel: "<July>",
      shipmentDate: "2026-07-14",
      rows: manifestRows,
      rowCount: 1,
      palletCount: 13
    });

    expect(html).toContain("Suretrack &amp; Sons Manifest &lt;July&gt;");
    expect(html).toContain('mso-number-format:"\\@"');
    expect(html).toContain(">806507</td>");
    expect(html).toContain(">210245</td>");
  });
});
