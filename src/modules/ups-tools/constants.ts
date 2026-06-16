import type { UpsServiceName } from "@/modules/ups-tools/types";

export const UPS_SERVICE_OPTIONS: UpsServiceName[] = [
  "Ground",
  "2nd Day Air",
  "Next Day Air",
  "Next Day Air Saver",
  "3 Day Select"
];

export const UPS_SERVICE_CODE_MAP: Record<UpsServiceName, { US: string; CA: string }> = {
  Ground: { US: "03", CA: "11" },
  "2nd Day Air": { US: "02", CA: "02" },
  "Next Day Air": { US: "01", CA: "01" },
  "Next Day Air Saver": { US: "13", CA: "13" },
  "3 Day Select": { US: "12", CA: "12" }
};

export const POPULAR_US_DESTINATIONS = [
  { state: "CA", postalCode: "90001" },
  { state: "TX", postalCode: "77001" },
  { state: "FL", postalCode: "33101" },
  { state: "NY", postalCode: "10001" },
  { state: "PA", postalCode: "19101" },
  { state: "IL", postalCode: "60601" },
  { state: "OH", postalCode: "44101" },
  { state: "GA", postalCode: "30301" },
  { state: "NC", postalCode: "27501" },
  { state: "MI", postalCode: "48201" }
] as const;

export const POPULAR_CA_DESTINATIONS = [
  { state: "ON", postalCode: "M5H2N2" },
  { state: "QC", postalCode: "H3B2Y5" },
  { state: "BC", postalCode: "V6B1T8" },
  { state: "AB", postalCode: "T5J3N5" },
  { state: "MB", postalCode: "R3C4T3" },
  { state: "SK", postalCode: "S4P3X5" },
  { state: "NS", postalCode: "B3J2K9" },
  { state: "NB", postalCode: "E3B1X5" },
  { state: "NL", postalCode: "A1C4X1" },
  { state: "PE", postalCode: "C1A7M4" }
] as const;
