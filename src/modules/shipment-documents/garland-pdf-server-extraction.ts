import { createHash } from "node:crypto";

import { parseGarlandShippingOrderPages } from "@/modules/shipment-documents/teamship-review";
import { extractPdfTextPagesFromBytes } from "@/server/pdf-text";

export async function extractGarlandShippingOrdersFromPdfBytes(fileBytes: Uint8Array) {
  const { pageCount, pages } = await extractPdfTextPagesFromBytes(fileBytes);

  const orders = parseGarlandShippingOrderPages(pages);

  return {
    contentHash: createHash("sha256").update(fileBytes).digest("hex"),
    pageCount,
    pages,
    orders,
    psNumbers: [...new Set(orders.map((order) => order.psNumber).filter(Boolean))],
    srNumbers: [...new Set(orders.map((order) => order.srNumber).filter(Boolean))]
  };
}
