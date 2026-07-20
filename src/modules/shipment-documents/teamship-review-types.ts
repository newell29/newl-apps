export type GarlandShippingOrderItem = {
  lineNumber: number | null;
  sku: string;
  description: string;
  quantity: number | null;
  dueShipDate: string | null;
  serialNumbers: string[];
  commodityOverride?: string | null;
  botActionEnabled?: boolean | null;
};

export type GarlandPdfShippingOrder = {
  pageNumbers: number[];
  psNumber: string;
  srNumber: string;
  shipToCode: string | null;
  shipToName: string | null;
  shipToAddress1: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  shipToPo: string | null;
  freightTerms: string | null;
  orderDate: string | null;
  shipVia: string | null;
  instructions: string;
  items: GarlandShippingOrderItem[];
  rawText: string;
};

export type TeamshipAlertOrderItem = {
  itemNumber: string | null;
  description: string | null;
  requestedQuantity: string | null;
  serialNumber: string | null;
  rawText: string;
};

export type TeamshipAlertOrder = {
  srNumber: string;
  reason: string;
  items: TeamshipAlertOrderItem[];
  rawText: string;
};

export type TeamshipCustomField = {
  label?: string | null;
  edi_key?: string | null;
  value?: string | number | boolean | null;
};

export type TeamshipShippingOrderItem = {
  sku?: string | null;
  item_number?: string | null;
  itemNumber?: string | null;
  product_sku?: string | null;
  productSku?: string | null;
  inventory_count?: number | string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  serial?: string | null;
  serial_number?: string | null;
  serialNumber?: string | null;
  serial_numbers?: string | string[] | null;
  serialNumbers?: string | string[] | null;
  product?: {
    sku?: string | null;
    item_number?: string | null;
    itemNumber?: string | null;
    serial?: string | null;
    serial_number?: string | null;
    serialNumber?: string | null;
    serial_numbers?: string | string[] | null;
    serialNumbers?: string | string[] | null;
  } | null;
  inventory_stock?: {
    sku?: string | null;
    serial?: string | null;
    serial_number?: string | null;
    serialNumber?: string | null;
    serial_numbers?: string | string[] | null;
    serialNumbers?: string | string[] | null;
  } | null;
  inventoryStock?: {
    sku?: string | null;
    serial?: string | null;
    serial_number?: string | null;
    serialNumber?: string | null;
    serial_numbers?: string | string[] | null;
    serialNumbers?: string | string[] | null;
  } | null;
  stock?: {
    sku?: string | null;
    serial?: string | null;
    serial_number?: string | null;
    serialNumber?: string | null;
    serial_numbers?: string | string[] | null;
    serialNumbers?: string | string[] | null;
  } | null;
  custom_attributes?: Array<{ name?: string | null; value?: string | number | boolean | null }> | null;
  customAttributes?: Array<{ name?: string | null; value?: string | number | boolean | null }> | null;
};

export type TeamshipPalletDim = {
  quantity?: number | string | null;
  width?: number | string | null;
  length?: number | string | null;
  height?: number | string | null;
  weight?: number | string | null;
  weight_unit?: string | null;
  commodity?: string | null;
};

export type TeamshipShippingOrderDetail = {
  id?: number | string | null;
  order_id?: number | string | null;
  display_id?: string | null;
  order_number?: string | null;
  shipment_id?: string | null;
  record_no?: string | null;
  status?: string | null;
  shipment_status?: string | null;
  shipmentStatus?: string | null;
  state?: string | null;
  completed_at?: string | null;
  completedAt?: string | null;
  carrier?: string | null;
  ship_method?: string | null;
  shipping_carrier?: string | null;
  method?: string | null;
  carrier_name?: string | null;
  carrier_value?: string | null;
  po_number?: string | null;
  poNumber?: string | null;
  pickup_eta?: string | null;
  pickETA_date?: string | null;
  shipment_date?: string | null;
  ship_to_name?: string | null;
  ship_first_name?: string | null;
  ship_last_name?: string | null;
  ship_to_address_1?: string | null;
  ship_address_1?: string | null;
  ship_to_city?: string | null;
  ship_city?: string | null;
  ship_to_state?: string | null;
  ship_state?: string | null;
  ship_to_zip?: string | null;
  ship_zip?: string | null;
  ship_to_country?: string | null;
  ship_country?: string | null;
  ship_to_phone?: string | null;
  shipping_instructions?: string | null;
  amazon_shipment_id1?: string | null;
  edi_field_1?: string | number | boolean | null;
  edi_field_2?: string | number | boolean | null;
  edi_field_3?: string | number | boolean | null;
  edi_field_4?: string | number | boolean | null;
  customer?: {
    id?: number | string | null;
    company?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
  customer_id?: number | string | null;
  user_id?: number | string | null;
  company?: string | null;
  user_company?: string | null;
  customer_name?: string | null;
  warehouse_id?: number | string | null;
  warehouse_name?: string | null;
  location_id?: number | string | null;
  location_name?: string | null;
  picking_status?: string | null;
  packing_status?: string | null;
  items?: TeamshipShippingOrderItem[];
  order_items?: TeamshipShippingOrderItem[];
  orderItems?: TeamshipShippingOrderItem[];
  pallets?: TeamshipPalletDim[];
  pallet_dims?: TeamshipPalletDim[];
  shipping_info?: {
    carrier?: string | null;
    method?: string | null;
    shipping_address?: {
      company?: string | null;
      name?: string | null;
      address_1?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
      country?: string | null;
      phone?: string | null;
    } | null;
  } | null;
  custom_fields?: TeamshipCustomField[];
  url?: string | null;
};

export type TeamshipShippingOrderSummary = TeamshipShippingOrderDetail & {
  created_at?: string | null;
  created_at_date?: string | null;
  imported_at?: string | null;
  imported_date?: string | null;
  order_created_at_date?: string | null;
};

export type ReviewFieldStatus = "MATCH" | "DISCREPANCY" | "MISSING" | "PENDING" | "INFO";

export type GarlandTeamshipReviewField = {
  key: string;
  label: string;
  status: ReviewFieldStatus;
  pdfValue: string | null;
  teamshipValue: string | null;
  message: string;
  proposedValue?: string | null;
  botActionEnabled?: boolean | null;
};

export type GarlandProductDimensionRecommendation = {
  sku: string;
  source: "UPS_RULE" | "CSR_OVERRIDE" | "CSR_LEARNED" | "TEAMSHIP_PALLET" | "TEAMSHIP_LEARNED" | "GARLAND_REFERENCE";
  productType: string | null;
  quantity: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightLb: number | null;
  weightUnit: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  note: string;
};

export type GarlandTeamshipItemDetail = {
  sku: string | null;
  quantity: string | null;
  serialNumbers: string[];
};

export type GarlandTeamshipOrderReview = {
  srNumber: string;
  psNumber: string;
  pageNumbers: number[];
  status: "PASS" | "FAIL" | "MISSING_TEAMSHIP" | "PENDING_TEAMSHIP" | "NO_PDF" | "SKIPPED_ALREADY_REVIEWED";
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  issueCount: number;
  alert: TeamshipAlertOrder | null;
  fields: GarlandTeamshipReviewField[];
  pdfItems: GarlandTeamshipItemDetail[];
  teamshipItems: GarlandTeamshipItemDetail[];
  productDimensions: GarlandProductDimensionRecommendation[];
};

export type GarlandTeamshipReviewSummary = {
  pdfOrderCount: number;
  teamshipMatchedCount: number;
  passedCount: number;
  failedCount: number;
  missingTeamshipCount: number;
  pendingTeamshipCount: number;
  noPdfCount: number;
  skippedAlreadyReviewedCount: number;
};

export type GarlandTeamshipReviewResponse = {
  summary: GarlandTeamshipReviewSummary;
  pdfOrders: GarlandPdfShippingOrder[];
  reviews: GarlandTeamshipOrderReview[];
  teamshipAlerts: TeamshipAlertOrder[];
  fetchedAt: string;
};

export type TeamshipPayloadInspectionMatch = {
  path: string;
  key: string | null;
  valuePreview: string;
  matchedValue: string | null;
  reason: "EXPECTED_SERIAL" | "SERIAL_LIKE_KEY" | "SERIAL_TEXT" | "EXPECTED_SKU";
};

export type TeamshipPayloadInspectionResult = {
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  fetchedAt: string;
  inspectedEndpoints: string[];
  expectedSerials: string[];
  expectedSkus: string[];
  searchedValueCount: number;
  exactSerialMatches: TeamshipPayloadInspectionMatch[];
  serialLikeMatches: TeamshipPayloadInspectionMatch[];
  skuMatches: TeamshipPayloadInspectionMatch[];
  conclusion: "EXPECTED_SERIAL_FOUND" | "SERIAL_EVIDENCE_FOUND" | "NO_SERIAL_EVIDENCE" | "TEAMSHIP_ORDER_NOT_FOUND";
  message: string;
};
