import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { defaultDueDateFromInvoiceDate } from "@/modules/invoice-automation/extraction";
import type { InvoiceAutomationOcrInvoice, InvoiceAutomationOcrResult } from "@/modules/invoice-automation/types";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_VISION_MODEL = process.env.OPENAI_DOCUMENT_VISION_MODEL?.trim() || "gpt-5-mini";

type InvoiceOcrRequest = {
  invoiceType?: "CUSTOMER" | "VENDOR";
  fileName?: string;
  images?: Array<{
    pageNumber: number;
    imageDataUrl: string;
  }>;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey === "OPENAI_API_KEY_PLACEHOLDER") {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured for invoice OCR." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as InvoiceOcrRequest | null;
  const images = Array.isArray(body?.images) ? body.images.filter(isValidImagePayload).slice(0, 8) : [];

  if (!body?.invoiceType || !["CUSTOMER", "VENDOR"].includes(body.invoiceType) || images.length === 0) {
    return NextResponse.json(
      { error: "Provide invoiceType and at least one rendered invoice page image." },
      { status: 400 }
    );
  }

  const requestBody = JSON.stringify({
    model: DEFAULT_VISION_MODEL,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content:
          "You extract invoice data from rendered PDF page images for a freight/logistics accounting workflow. Return JSON only. Do not guess values that are not visible. Use null for uncertain fields. Dates must be YYYY-MM-DD. Amount fields must be numbers, not strings."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildPrompt(body.invoiceType, body.fileName ?? "invoice.pdf", images.map((image) => image.pageNumber))
          },
          ...images.map((image) => ({
            type: "image_url" as const,
            image_url: {
              url: image.imageDataUrl,
              detail: "high" as const
            }
          }))
        ]
      }
    ]
  });

  const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: requestBody,
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    return NextResponse.json(
      {
        error:
          readOpenAiError(json) ??
          `OpenAI invoice OCR failed with status ${response.status}. Request size was ${formatByteSize(requestBody.length)}.`
      },
      { status: 502 }
    );
  }

  const content = readAssistantContent(json);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "OpenAI returned non-JSON invoice OCR output." }, { status: 502 });
  }

  const parsedInvoices = Array.isArray(parsed.invoices)
    ? parsed.invoices.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    : [parsed];
  const result: InvoiceAutomationOcrResult = {
    model: DEFAULT_VISION_MODEL,
    invoices: parsedInvoices.map(normalizeOcrInvoice).filter(hasAnyInvoiceSignal)
  };

  return NextResponse.json(result);
}

function buildPrompt(invoiceType: "CUSTOMER" | "VENDOR", fileName: string, pageNumbers: number[]) {
  return [
    `Invoice type: ${invoiceType}.`,
    `Source filename: ${fileName}.`,
    `Attached page numbers: ${pageNumbers.join(", ")}.`,
    "The attachment may contain multiple invoices or freight bills. Check for multiple invoice numbers, pro/bill numbers, shipment references, page groups, repeated invoice headers, tear-off sections, or Part 1 of N / Part 2 of N groups.",
    "If multiple invoices are present, return one entry per invoice in the invoices array. Do not combine totals from separate invoices.",
    "When a freight bill has multiple pages or parts for the same invoice/pro/bill number, combine only those pages into one invoice entry.",
    invoiceType === "CUSTOMER"
      ? "This is a customer invoice Newl sends to its customer. Extract the customer/bill-to name."
      : "This is a vendor invoice Newl receives from a carrier/vendor. Extract the actual carrier/vendor name, not a factoring company, payment assignee, payable-to party, or remit-to lockbox.",
    invoiceType === "VENDOR"
      ? "Many trucking vendors factor receivables. If text says bills were sold/assigned/payable to a financial service company, that company is only the factor/payee. Prefer labels such as Assigned For, carrier name, carrier/vendor identity near the invoice table, or the carrier on the load confirmation. Example: if RTS Financial is payable-to but the invoice says 373 CARGO INCORPORATED or Assigned For: 373 CARGO INCORPORATED, return 373 CARGO INCORPORATED as entityName."
      : "Do not use Newl/Newells as the customer just because it appears as sender or remittance contact; use the bill-to/customer being invoiced.",
    "Find the shipment file number if visible. Valid prefixes are OE, OI, AE, AI, TR, and DR.",
    "Extract invoice number, invoice date, due date, currency, subtotal before tax, sales tax/HST, and total.",
    "If no due date is visible, return dueDate as null; the app will default payment terms to 30 days after invoice date.",
    "Do not return a service/category label such as Air Freight, Ocean Freight, Trucking, or Warehouse as entityName.",
    "If tax is not present, set taxAmount to 0 only when the invoice clearly has no tax; otherwise use null.",
    "Return JSON with this exact shape: {\"invoices\":[{\"extractedText\":\"short transcription of visible key invoice text\",\"shipmentFileNumber\":\"OE12345\",\"entityName\":\"Customer or Vendor Name\",\"invoiceNumber\":\"INV-123\",\"invoiceDate\":\"2026-07-08\",\"dueDate\":\"2026-08-07\",\"currency\":\"CAD\",\"subtotalAmount\":1000.00,\"taxAmount\":130.00,\"totalAmount\":1130.00,\"taxApplicable\":true,\"confidence\":\"HIGH\",\"notes\":\"short note\"}]}."
  ].join(" ");
}

function normalizeOcrInvoice(parsed: Record<string, unknown>): InvoiceAutomationOcrInvoice {
  const invoiceDate = readIsoDate(parsed.invoiceDate);
  const dueDate = readIsoDate(parsed.dueDate) ?? defaultDueDateFromInvoiceDate(invoiceDate);

  return {
    extractedText: readString(parsed.extractedText) ?? buildSyntheticExtractedText(parsed),
    shipmentFileNumber: normalizeNullableCode(parsed.shipmentFileNumber),
    entityName: readString(parsed.entityName),
    invoiceNumber: normalizeNullableCode(parsed.invoiceNumber),
    invoiceDate,
    dueDate,
    currency: normalizeCurrency(parsed.currency),
    subtotalAmount: readNumber(parsed.subtotalAmount),
    taxAmount: readNumber(parsed.taxAmount),
    totalAmount: readNumber(parsed.totalAmount),
    taxApplicable: typeof parsed.taxApplicable === "boolean" ? parsed.taxApplicable : null,
    confidence: readString(parsed.confidence) ?? "MEDIUM",
    notes: readString(parsed.notes)
  };
}

function hasAnyInvoiceSignal(invoice: InvoiceAutomationOcrInvoice) {
  return Boolean(invoice.invoiceNumber || invoice.shipmentFileNumber || invoice.totalAmount !== null || invoice.extractedText);
}

function isValidImagePayload(value: unknown): value is { pageNumber: number; imageDataUrl: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { pageNumber?: unknown; imageDataUrl?: unknown };
  return (
    typeof candidate.pageNumber === "number" &&
    Number.isInteger(candidate.pageNumber) &&
    candidate.pageNumber > 0 &&
    typeof candidate.imageDataUrl === "string" &&
    candidate.imageDataUrl.startsWith("data:image/")
  );
}

function readAssistantContent(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : null;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("OpenAI returned an empty invoice OCR response.");
  }

  return content;
}

function readOpenAiError(payload: Record<string, unknown> | null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = payload.error;
  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNullableCode(value: unknown) {
  const text = readString(value);
  return text ? text.replace(/\s+/g, "").toUpperCase() : null;
}

function normalizeCurrency(value: unknown) {
  const text = readString(value)?.toUpperCase();
  if (text === "CAD" || text === "CDN") return "CAD";
  if (text === "USD") return "USD";
  return null;
}

function readIsoDate(value: unknown) {
  const text = readString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function readNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : null;
}

function buildSyntheticExtractedText(parsed: Record<string, unknown>) {
  return [
    ["Shipment file number", parsed.shipmentFileNumber],
    ["Entity", parsed.entityName],
    ["Invoice number", parsed.invoiceNumber],
    ["Invoice date", parsed.invoiceDate],
    ["Due date", parsed.dueDate],
    ["Currency", parsed.currency],
    ["Subtotal", parsed.subtotalAmount],
    ["Tax", parsed.taxAmount],
    ["Total", parsed.totalAmount]
  ]
    .filter(([, value]) => value !== null && value !== undefined && `${value}`.trim().length > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function formatByteSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
