import type { UpsInputRow } from "@/modules/ups-tools/types";

const SHIPMENT_REFERENCE_HEADERS = new Set([
  "customerordernumber",
  "customerorder",
  "ordernumber",
  "orderid",
  "shipmentid",
  "shipmentnumber",
  "shipmentreference",
  "reference"
]);

export function getShipmentReference(row: UpsInputRow): string {
  for (const [key, value] of Object.entries(row)) {
    if (!value) {
      continue;
    }

    if (SHIPMENT_REFERENCE_HEADERS.has(normalizeHeaderKey(key))) {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return "";
}

function normalizeHeaderKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
