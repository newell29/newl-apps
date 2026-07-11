export type GarlandShippingOrderItem = {
  lineNumber: number | null;
  sku: string;
  description: string;
  quantity: number | null;
  dueShipDate: string | null;
  serialNumbers: string[];
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

export type TeamshipCustomField = {
  label?: string | null;
  edi_key?: string | null;
  value?: string | number | boolean | null;
};

export type TeamshipShippingOrderItem = {
  sku?: string | null;
  inventory_count?: number | string | null;
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
    company?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
  company?: string | null;
  user_company?: string | null;
  customer_name?: string | null;
  items?: TeamshipShippingOrderItem[];
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

export type ReviewFieldStatus = "MATCH" | "DISCREPANCY" | "MISSING" | "INFO";

export type GarlandTeamshipReviewField = {
  key: string;
  label: string;
  status: ReviewFieldStatus;
  pdfValue: string | null;
  teamshipValue: string | null;
  message: string;
};

export type GarlandTeamshipOrderReview = {
  srNumber: string;
  psNumber: string;
  pageNumbers: number[];
  status: "PASS" | "FAIL" | "MISSING_TEAMSHIP";
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  issueCount: number;
  fields: GarlandTeamshipReviewField[];
};

export type GarlandTeamshipReviewSummary = {
  pdfOrderCount: number;
  teamshipMatchedCount: number;
  passedCount: number;
  failedCount: number;
  missingTeamshipCount: number;
};

export type GarlandTeamshipReviewResponse = {
  summary: GarlandTeamshipReviewSummary;
  pdfOrders: GarlandPdfShippingOrder[];
  reviews: GarlandTeamshipOrderReview[];
  fetchedAt: string;
};
