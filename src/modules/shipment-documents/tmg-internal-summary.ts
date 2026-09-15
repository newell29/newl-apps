import type { MicrosoftGraphOutboundMessage } from "@/server/integrations/microsoft-graph-mail";

export type TmgInternalSummaryOrder = {
  teamshipOrderNumber: string;
  customerReference: string;
  shipToName: string;
  shipToCity: string;
  shipToState: string;
  items: Array<{ sku: string; quantity: number }>;
  proNumber: string;
  documentUploadStatus: "UPLOADED" | "ALREADY_PRESENT" | "NEEDS_REVIEW";
  warehouseInstructions: string | null;
};

export function buildTmgInternalSummaryMessages({
  recipients,
  receivedAt,
  sourceSubject,
  orders
}: {
  recipients: string[];
  receivedAt: string;
  sourceSubject: string;
  orders: TmgInternalSummaryOrder[];
}): MicrosoftGraphOutboundMessage[] {
  if (orders.length === 0) throw new Error("A TMG internal summary requires at least one created order.");
  const subject = `TMG orders created - ${orders.length} order${orders.length === 1 ? "" : "s"}`;
  const body = [
    "TMG order intake completed.",
    "",
    `Source email: ${sourceSubject}`,
    `Received: ${formatReceivedAt(receivedAt)}`,
    "",
    ...orders.flatMap((order, index) => [
      `${index + 1}. Teamship ${order.teamshipOrderNumber} | TMG ${order.customerReference}`,
      `   Ship to: ${order.shipToName} - ${order.shipToCity}, ${order.shipToState}`,
      `   Products: ${order.items.map((item) => `${item.sku} x ${item.quantity}`).join(", ")}`,
      `   PRO: ${order.proNumber}`,
      `   Document: ${formatUploadStatus(order.documentUploadStatus)}`,
      ...(order.warehouseInstructions
        ? [`   Warehouse instructions: ${order.warehouseInstructions}`]
        : []),
      ""
    ]),
    "Delivery notes from the packing slip were intentionally excluded from Teamship because they are carrier instructions.",
    "Please review each created order in Teamship before warehouse processing."
  ].join("\n").trim();

  return Array.from(new Set(recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean))).map(
    (recipientEmail) => ({ recipientEmail, subject, body })
  );
}

function formatReceivedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("TMG source receivedAt must be a valid date.");
  return date.toISOString();
}

function formatUploadStatus(status: TmgInternalSummaryOrder["documentUploadStatus"]) {
  if (status === "UPLOADED") return "Uploaded and verified";
  if (status === "ALREADY_PRESENT") return "Already present and verified";
  return "Needs review";
}
