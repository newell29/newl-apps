export type ShipmentDocumentRunSummary = {
  id: string;
  workflowKey: string;
  documentLabel: string;
  shipmentDate: string;
  recipientEmail: string | null;
  sourceBolFileName: string | null;
  sourcePickTicketFileName: string | null;
  outputBolFileName: string;
  outputPickTicketFileName: string;
  bolPageCount: number;
  pickTicketPageCount: number;
  bolAiFallbackPageCount: number;
  pickAiFallbackPageCount: number;
  bolPsNumbers: string[];
  pickPsNumbers: string[];
  createdAt: string;
  createdByName: string | null;
};

export type ShipmentDocumentHistoryResponse = {
  runs: ShipmentDocumentRunSummary[];
  totalCount: number;
  search: string;
};
