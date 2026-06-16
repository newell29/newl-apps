import type { LtlFreightPiece } from "@/modules/ltl-rate-portal/types";

export const LTL_INTERACTIVE_LANE_LIMIT = 100;

export const LTL_TEMPLATE_HEADERS = [
  "customerReference",
  "originCity",
  "originState",
  "originZipcode",
  "originCountry",
  "destinationCity",
  "destinationState",
  "destinationZipcode",
  "destinationCountry",
  "pickupDate",
  "uom",
  "accessorialCodes",
  "piece1Qty",
  "piece1Weight",
  "piece1WeightType",
  "piece1Length",
  "piece1Width",
  "piece1Height",
  "piece1DimType",
  "piece1Class",
  "piece1Hazmat",
  "piece1UN",
  "piece1NMFC",
  "piece1Stack",
  "piece1StackAmount",
  "piece1Commodity"
] as const;

export const LTL_SAMPLE_CSV = `${LTL_TEMPLATE_HEADERS.join(",")}
RFQ-1001,,,28273,US,,,77001,US,2026-06-20,US,LFTG|APPT,1,1200,each,,,,PLT,125,false,,,true,2,Floor loaded paper
RFQ-1002,,,M5H2N2,CA,,,60601,US,2026-06-21,US,RESD,,450,each,,,,PLT,92.5,false,,,false,,Retail fixtures
`;

export const LTL_FREIGHT_CLASS_OPTIONS = [
  "50",
  "55",
  "60",
  "65",
  "70",
  "77.5",
  "85",
  "92.5",
  "100",
  "110",
  "125",
  "150",
  "175",
  "200",
  "250",
  "300",
  "400",
  "500"
] as const satisfies readonly LtlFreightPiece["freightClass"][];

export const LTL_DIM_TYPE_OPTIONS = ["CTN", "PLT", "CRT", "CON", "CYL", "DRM", "ENV", "BOX", "BDL"] as const;

export const LTL_ACCESSORIAL_LEGEND = [
  { code: "APPT", label: "Appointment delivery or pickup" },
  { code: "RESD", label: "Residential delivery" },
  { code: "LFTG", label: "Liftgate service" },
  { code: "HAZ", label: "Hazmat shipment" },
  { code: "INSIDE", label: "Inside pickup or delivery" }
] as const;
