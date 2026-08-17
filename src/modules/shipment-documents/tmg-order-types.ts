export type TmgSourcePdfAttachment = {
  sourceId: string;
  fileName: string;
  contentType?: string | null;
  bytes: Uint8Array;
};

export type TmgShipTo = {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
  email: string | null;
};

export type TmgOrderItem = {
  sku: string;
  quantity: number | null;
};

export type TmgPackingSlipOrder = {
  customerReference: string;
  orderDate: string | null;
  shipTo: TmgShipTo;
  items: TmgOrderItem[];
  deliveryNotes: string | null;
  sourceAttachmentId: string;
  sourceFileName: string;
  sourcePageNumber: number;
  sourceText: string;
};

export type TmgPicklistOrder = {
  customerReference: string;
  sku: string | null;
  quantity: number | null;
  trackingNumber: string | null;
  warehouseInstructions: string | null;
  sourceAttachmentId: string;
  sourceFileName: string;
  sourcePageNumber: number;
};

export type TmgBolEvidence = {
  customerReference: string;
  proNumber: string | null;
  carrier: string | null;
  sourceAttachmentId: string;
  sourceFileName: string;
  sourceText: string;
};

export type TmgLabelEvidence = {
  customerReference: string;
  proNumber: string | null;
  sourceAttachmentId: string;
  sourceFileName: string;
  sourceText: string;
};

export type TmgOrderValidationIssue = {
  code:
    | "DUPLICATE_BOL"
    | "DUPLICATE_LABEL"
    | "DUPLICATE_PACKING_SLIP"
    | "MISSING_BOL"
    | "MISSING_LABEL"
    | "MISSING_ORDER_DATE"
    | "MISSING_PACKING_SLIP"
    | "MISSING_PICKLIST_ORDER"
    | "MISSING_PRO_NUMBER"
    | "MISSING_PRODUCT"
    | "MISSING_PRODUCT_QUANTITY"
    | "MISSING_SHIP_TO"
    | "PACKET_TOO_LARGE"
    | "PICKLIST_QUANTITY_MISMATCH"
    | "PICKLIST_SKU_MISMATCH"
    | "TEAMSHIP_ORDER_EXISTS"
    | "TEAMSHIP_PRODUCT_MATCH";
  message: string;
};

export type TmgPreparedOrder = {
  customerReference: string;
  packingSlip: TmgPackingSlipOrder;
  picklist: TmgPicklistOrder | null;
  bol: TmgBolEvidence | null;
  label: TmgLabelEvidence | null;
  warehouseInstructions: string | null;
  deliveryNotesExcludedFromTeamship: true;
  combinedPdfFileName: string | null;
  combinedPdfBytes: Uint8Array | null;
  combinedPdfHash: string | null;
  validationIssues: TmgOrderValidationIssue[];
  readyForApproval: boolean;
};

export type TmgPreparedBatch = {
  attachmentCount: number;
  uniquePdfCount: number;
  duplicatePdfCount: number;
  packingSlipOrders: TmgPackingSlipOrder[];
  picklistOrders: TmgPicklistOrder[];
  orders: TmgPreparedOrder[];
  batchIssues: string[];
};
