import { generateOpenAiJsonCompletion } from "@/server/integrations/openai";

export type ShipmentInquiryCustomerType = "customer" | "agent";

export type ParsedShipmentInquiry = {
  customer: string;
  customertype: ShipmentInquiryCustomerType | "";
  mode: string;
  origin: string;
  destination: string;
  incoterms: string;
  service: string;
  direction: string;
  shipmentType: string;
  urgency: string;
  requestedTiming: string;
  originPostalCode: string;
  originCountry: string;
  destinationPostalCode: string;
  destinationCountry: string;
  pickupDate: string;
  freightClass: string;
  nmfc: string;
  unNumber: string;
  accessorials: string[];
  containerQuantity: string;
  containerSize: string;
  equipmentType: string;
  containerWeight: string;
  weightUnit: "LBS" | "KG" | "";
  dimensionsUnit: "CM" | "INCH" | "";
  floorLoaded: boolean;
  commodity: string;
  items: Array<{
    quantity: string;
    packagingType: string;
    length: string;
    width: string;
    height: string;
    weight: string;
    weightType: "each" | "total" | "";
    freightClass: string;
    nmfc: string;
    unNumber: string;
  }>;
  insurance: boolean;
  customs: boolean;
  dangerousGoods: boolean;
  readyDate: string;
};

export async function parseShipmentInquiryWithOpenAI(emailBody: string): Promise<ParsedShipmentInquiry> {
  const raw = stripJsonFence(
    await generateOpenAiJsonCompletion({
      schemaName: "shipment_inquiry_outlook_intake",
      schema: buildParsedShipmentInquiryJsonSchema(),
      errorLabel: "Outlook shipment inquiry parsing",
      system: "You are a logistics operations agent for a freight forwarding company. Return only valid JSON matching the supplied schema.",
      user: [
        "Analyze freight inquiry emails like a forwarding coordinator would.",
        "Use the email body, quoted text, original forwarded sender details, signature block, company footer, and pasted attachment text to infer the shipment request.",
        "Extract every data point needed to create a TMS quote.",
        "Return only a clean, parseable JSON string.",
        "Use empty strings for unknown string fields, false for unknown booleans, and an empty array when no item dimensions are listed.",
        "The customer field must be the company requesting the quote. Never return a website URL, bare domain, hostname, email address, Newl, Teamship, or an internal receiver name.",
        "Do not convert a bare domain into a cleaned company name. Use a domain only as evidence. If a real company name cannot be established, use an empty string.",
        "Populate customertype as customer or agent only. Customer means the company is requesting freight for its own shipment. Agent means an overseas or forwarding partner is arranging shipment for another company.",
        "Normalize mode to: air, ocean, ground, trucking, rail, drayage, warehousing, or nearest available mode.",
        "Populate shipmentType with LCL/FCL for ocean and LTL/FTL for trucking or ground.",
        "Preserve full original origin and destination text from the inquiry.",
        "For LTL/trucking/ground, extract originPostalCode, originCountry, destinationPostalCode, destinationCountry, pickupDate, freightClass, NMFC, UN number, item dimensions, weight, units, and accessorial wording when explicitly stated.",
        "Put accessorial wording as customer-stated phrases in accessorials. Do not convert accessorial wording to 7L codes.",
        "For item piece count, use the item key quantity only. Do not output item keys named numberPieces, pieces, count, noOfPieces, or number.",
        "Normalize weightUnit to LBS or KG only. Normalize dimensionsUnit to INCH or CM only.",
        "Always include exactly these keys:",
        JSON.stringify(emptyParsedShipmentInquiry()),
        "",
        "Email body:",
        emailBody
      ].join("\n")
    })
  );

  return normalizeParsedShipmentInquiry(JSON.parse(raw));
}

export function normalizeParsedShipmentInquiry(value: unknown): ParsedShipmentInquiry {
  const record = isRecord(value) ? value : {};
  return {
    customer: readString(record.customer),
    customertype: normalizeCustomerType(record.customertype),
    mode: readString(record.mode),
    origin: readString(record.origin),
    destination: readString(record.destination),
    incoterms: readString(record.incoterms),
    service: readString(record.service),
    direction: readString(record.direction),
    shipmentType: readString(record.shipmentType),
    urgency: readString(record.urgency),
    requestedTiming: readString(record.requestedTiming),
    originPostalCode: readString(record.originPostalCode),
    originCountry: readString(record.originCountry),
    destinationPostalCode: readString(record.destinationPostalCode),
    destinationCountry: readString(record.destinationCountry),
    pickupDate: readString(record.pickupDate),
    freightClass: readString(record.freightClass),
    nmfc: readString(record.nmfc),
    unNumber: readString(record.unNumber),
    accessorials: Array.isArray(record.accessorials) ? record.accessorials.map(readString).filter(Boolean) : [],
    containerQuantity: readString(record.containerQuantity),
    containerSize: readString(record.containerSize),
    equipmentType: readString(record.equipmentType),
    containerWeight: readString(record.containerWeight),
    weightUnit: normalizeUnit(record.weightUnit, ["LBS", "KG"]),
    dimensionsUnit: normalizeUnit(record.dimensionsUnit, ["CM", "INCH"]),
    floorLoaded: record.floorLoaded === true,
    commodity: readString(record.commodity),
    items: Array.isArray(record.items) ? record.items.map(normalizeItem) : [],
    insurance: record.insurance === true,
    customs: record.customs === true,
    dangerousGoods: record.dangerousGoods === true,
    readyDate: readString(record.readyDate)
  };
}

export function isLtlParsedInquiry(inquiry: Pick<ParsedShipmentInquiry, "mode" | "shipmentType">): boolean {
  const mode = inquiry.mode.trim().toLowerCase();
  const tmsMode = mode === "ground" ? "trucking" : mode;
  return tmsMode === "trucking" && inquiry.shipmentType.trim().toUpperCase() === "LTL";
}

function emptyParsedShipmentInquiry(): ParsedShipmentInquiry {
  return {
    customer: "",
    customertype: "",
    mode: "",
    origin: "",
    destination: "",
    incoterms: "",
    service: "",
    direction: "",
    shipmentType: "",
    urgency: "",
    requestedTiming: "",
    originPostalCode: "",
    originCountry: "",
    destinationPostalCode: "",
    destinationCountry: "",
    pickupDate: "",
    freightClass: "",
    nmfc: "",
    unNumber: "",
    accessorials: [],
    containerQuantity: "",
    containerSize: "",
    equipmentType: "",
    containerWeight: "",
    weightUnit: "",
    dimensionsUnit: "",
    floorLoaded: false,
    commodity: "",
    items: [],
    insurance: false,
    customs: false,
    dangerousGoods: false,
    readyDate: ""
  };
}

function buildParsedShipmentInquiryJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(emptyParsedShipmentInquiry()).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? { type: "array" }
          : typeof value === "boolean"
            ? { type: "boolean" }
            : { type: "string" }
      ])
    ),
    required: Object.keys(emptyParsedShipmentInquiry())
  };
}

function normalizeItem(value: unknown): ParsedShipmentInquiry["items"][number] {
  const record = isRecord(value) ? value : {};
  return {
    quantity: readString(record.quantity),
    packagingType: readString(record.packagingType),
    length: readString(record.length),
    width: readString(record.width),
    height: readString(record.height),
    weight: readString(record.weight),
    weightType: normalizeUnit(record.weightType, ["each", "total"]),
    freightClass: readString(record.freightClass),
    nmfc: readString(record.nmfc),
    unNumber: readString(record.unNumber)
  };
}

function normalizeCustomerType(value: unknown): ParsedShipmentInquiry["customertype"] {
  const normalized = readString(value).toLowerCase();
  return normalized === "customer" || normalized === "agent" ? normalized : "";
}

function normalizeUnit<T extends string>(value: unknown, allowed: readonly T[]): T | "" {
  const raw = readString(value);
  const match = allowed.find((item) => item.toLowerCase() === raw.toLowerCase());
  return match ?? "";
}

function readString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
