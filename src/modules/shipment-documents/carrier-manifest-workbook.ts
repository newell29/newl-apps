import type { GarlandCarrierManifestRow } from "@/modules/shipment-documents/carrier-manifest-types";

export function buildCarrierManifestWorkbookHtml({
  carrierLabel,
  documentLabel,
  shipmentDate,
  rows,
  rowCount,
  palletCount
}: {
  carrierLabel: string;
  documentLabel: string;
  shipmentDate: string;
  rows: GarlandCarrierManifestRow[];
  rowCount: number;
  palletCount: number;
}) {
  const bodyRows = Array.from({ length: rowCount }, (_, index) => {
    const row = rows[index];
    const stripeClass = index % 2 === 1 ? " alternate" : "";

    return [
      `<tr class="manifest-row${stripeClass}">`,
      `<td class="row-number">${index + 1}</td>`,
      `<td class="identifier sr-value">${escapeHtml(row?.srNumber ?? "")}</td>`,
      `<td class="identifier ps-value">${escapeHtml(row?.psNumber.replace(/^PS/i, "") ?? "")}</td>`,
      `<td class="destination">${escapeHtml(row?.cityProvince ?? "")}</td>`,
      `<td class="skids">${row?.skids ?? ""}</td>`,
      "</tr>"
    ].join("");
  }).join("");
  const title = escapeHtml(`${carrierLabel} Manifest ${documentLabel}`);
  const safeShipmentDate = escapeHtml(shipmentDate);

  return [
    "<!doctype html>",
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">',
    "<head>",
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />',
    '<meta name="ProgId" content="Excel.Sheet" />',
    '<meta name="Generator" content="Newl Apps" />',
    "<!--[if gte mso 9]><xml>",
    "<x:ExcelWorkbook>",
    "<x:ExcelWorksheets>",
    "<x:ExcelWorksheet>",
    "<x:Name>Carrier Manifest</x:Name>",
    "<x:WorksheetOptions>",
    '<x:PageSetup><x:Layout x:Orientation="Landscape"/><x:Header x:Margin="0.15"/><x:Footer x:Margin="0.15"/><x:PageMargins x:Bottom="0.3" x:Left="0.3" x:Right="0.3" x:Top="0.3"/></x:PageSetup>',
    "<x:FitToPage/>",
    "<x:Print>",
    "<x:FitWidth>1</x:FitWidth>",
    "<x:FitHeight>1</x:FitHeight>",
    "<x:PaperSizeIndex>1</x:PaperSizeIndex>",
    "<x:HorizontalResolution>600</x:HorizontalResolution>",
    "<x:VerticalResolution>600</x:VerticalResolution>",
    "<x:ValidPrinterInfo/>",
    "</x:Print>",
    "<x:Selected/>",
    "<x:DoNotDisplayGridlines/>",
    "<x:Zoom>100</x:Zoom>",
    "</x:WorksheetOptions>",
    "</x:ExcelWorksheet>",
    "</x:ExcelWorksheets>",
    "</x:ExcelWorkbook>",
    "</xml><![endif]-->",
    "<style>",
    "@page{size:letter landscape;margin:0.3in;mso-page-orientation:landscape;}",
    "html,body{margin:0;padding:0;background:#fff;color:#172033;font-family:Aptos,Calibri,Arial,sans-serif;}",
    "table{border-collapse:collapse;table-layout:fixed;width:10.35in;page-break-inside:avoid;mso-displayed-decimal-separator:\".\";mso-displayed-thousand-separator:\",\";}",
    "col.row-number-col{width:0.42in;}col.sr-col{width:4.02in;}col.ps-col{width:1.42in;}col.city-col{width:3.55in;}col.skids-col{width:0.94in;}",
    "td,th{box-sizing:border-box;border:0.75pt solid #64748b;padding:4pt 7pt;font-size:11pt;line-height:1.1;vertical-align:middle;white-space:nowrap;}",
    ".title{height:34pt;border-color:#0f2747;background:#0f2747;color:#fff;font-size:18pt;font-weight:700;text-align:left;padding-left:12pt;letter-spacing:0.15pt;}",
    ".column-header th{height:27pt;border-color:#334155;background:#dbe7f5;color:#0f2747;font-size:11pt;font-weight:700;text-align:left;}",
    ".column-header .row-number,.column-header .skids{text-align:center;}",
    ".manifest-row td{height:24pt;border-color:#94a3b8;}",
    ".manifest-row.alternate td{background:#f5f8fc;}",
    ".row-number{color:#475569;text-align:center;}",
    ".identifier{mso-number-format:\"\\@\";text-align:left;}",
    ".destination{text-align:left;}",
    ".skids{text-align:center;font-weight:700;}",
    ".summary td{height:28pt;border-color:#334155;background:#dbe7f5;color:#0f2747;font-size:11.5pt;font-weight:700;}",
    ".summary-label{text-align:right;padding-right:10pt;}",
    ".signature td{height:48pt;border-color:#334155;background:#fff;font-size:10.5pt;vertical-align:top;padding-top:8pt;}",
    ".signature-label{font-weight:700;}",
    ".signature-line{display:inline-block;width:2.8in;border-bottom:0.75pt solid #334155;margin-left:8pt;}",
    ".date-label{text-align:right;font-weight:700;}",
    ".date-value{text-align:center;font-weight:600;}",
    "</style>",
    "</head>",
    "<body>",
    "<table>",
    '<colgroup><col class="row-number-col"/><col class="sr-col"/><col class="ps-col"/><col class="city-col"/><col class="skids-col"/></colgroup>',
    `<tr><td class="title" colspan="5">${title}</td></tr>`,
    '<tr class="column-header"><th class="row-number">#</th><th>SR #</th><th>PS #</th><th>City / Province</th><th class="skids">Pallets</th></tr>',
    bodyRows,
    `<tr class="summary"><td class="summary-label" colspan="4">Total pallets</td><td class="skids">${palletCount}</td></tr>`,
    `<tr class="signature"><td class="signature-label" colspan="3">Driver signature <span class="signature-line">&nbsp;</span></td><td class="date-label">Manifest date</td><td class="date-value">${safeShipmentDate}</td></tr>`,
    "</table>",
    "</body>",
    "</html>"
  ].join("");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
