import { sendResendEmail } from "@/server/email/resend";
import type { ParsedShipmentInquiry } from "@/modules/shipment-inquiries/parser";
import type { LtlInquiryRatingResult } from "@/modules/shipment-inquiries/ltl-rating";
import type { TmsAutomationResult } from "@/modules/shipment-inquiries/tms-automation";

const NON_LTL_TO = "pricing@newlgroup.com";
const LTL_TO = "dispatch@newlgroup.com";

export type ShipmentInquiryNotificationResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  to: string[];
  subject: string;
};

export async function sendShipmentInquiryResultEmail(input: {
  originalSubject: string;
  inquiry: ParsedShipmentInquiry;
  tms: TmsAutomationResult;
  ltl: LtlInquiryRatingResult;
}): Promise<ShipmentInquiryNotificationResult> {
  const to = [input.ltl.isLtl ? LTL_TO : NON_LTL_TO];
  const subject = `${input.originalSubject || "Shipment inquiry"} ${input.tms.quoteNumber ?? ""}`.trim();
  const html = buildShipmentInquiryResultEmailHtml(input);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const attachments =
    !input.ltl.isLtl && input.tms.tradeMiningCustomerIntelligence.workbookAttachment
      ? [
          {
            filename: input.tms.tradeMiningCustomerIntelligence.workbookAttachment.fileName,
            content: input.tms.tradeMiningCustomerIntelligence.workbookAttachment.content
          }
        ]
      : undefined;
  const result = await sendResendEmail({
    from: process.env.COMPLETED_INQUIRY_EMAIL_FROM?.trim() || "Newl Apps <noreply@newlgroup.com>",
    to,
    subject,
    text,
    html,
    attachments
  });
  return { ...result, to, subject };
}

export function buildShipmentInquiryResultEmailHtml(input: {
  inquiry: ParsedShipmentInquiry;
  tms: TmsAutomationResult;
  ltl: LtlInquiryRatingResult;
}) {
  const rows = [
    ["TMS quote number", input.tms.quoteNumber ?? "(not captured)"],
    ["TMS quote link", input.tms.quoteUrl],
    ["Customer", input.inquiry.customer],
    ["Mode", input.inquiry.mode],
    ["Shipment type", input.inquiry.shipmentType],
    ["Origin", input.inquiry.origin || input.inquiry.originPostalCode],
    ["Destination", input.inquiry.destination || input.inquiry.destinationPostalCode],
    ["Commodity", input.inquiry.commodity],
    ["TradeMining search ID", input.tms.tradeMiningCustomerIntelligence.searchId ?? "(none)"],
    ["TradeMining record count", String(input.tms.tradeMiningCustomerIntelligence.totalShipmentRecordsFound)]
  ];
  const ltlRows = input.ltl.isLtl
    ? [
        ["7L status", input.ltl.status],
        ["7L account", input.ltl.accountName ?? "(none)"],
        ["Carriers requested", String(input.ltl.enabledCarrierCount)],
        ["Successful carrier results", String(input.ltl.quotes.length)],
        ["Carrier errors", String(input.ltl.errors.length)],
        ["7L warning", input.ltl.warning ?? "(none)"]
      ]
    : [];

  return `<div style="font-family:Arial,sans-serif;font-size:11pt;color:rgb(0,0,104)"><table>${[...rows, ...ltlRows]
    .map(([label, value]) => `<tr><td style="font-weight:bold;padding:3px 10px 3px 0">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join("")}</table></div>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
