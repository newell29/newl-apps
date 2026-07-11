import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import type { GarlandCarrierKey, GarlandCarrierManifestRow } from "@/modules/shipment-documents/carrier-manifest-types";
import { extractPsNumberFromText, normalizePsNumber } from "@/modules/shipment-documents/ps-number";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_VISION_MODEL = process.env.OPENAI_DOCUMENT_VISION_MODEL?.trim() || "gpt-4.1-mini";

type ExtractionRequest = {
  images: Array<{
    pageNumber: number;
    imageDataUrl: string;
  }>;
};

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey === "OPENAI_API_KEY_PLACEHOLDER") {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured for carrier manifest extraction." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as ExtractionRequest | null;
  const images = Array.isArray(body?.images) ? body.images.filter(isValidImagePayload) : [];

  if (images.length === 0) {
    return NextResponse.json({ error: "Provide at least one BOL page image." }, { status: 400 });
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
          "You extract Garland Canada carrier loading-manifest rows from labeled BOL field-crop images. Return JSON only. The key fields are carrier, PS/reference number, consignee city/province, and total pallets. Include a row for every page where the Carrier box contains Midland, Speedy, Suretrack, Sure Track, or Suretrak. Ignore other carriers. Do not drop a matching carrier page just because another field is uncertain."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildPrompt(images.map((image) => image.pageNumber))
          },
          ...images.flatMap((image) => [
            {
              type: "text" as const,
              text: `BOL page ${image.pageNumber}: inspect this page.`
            },
            {
              type: "image_url" as const,
              image_url: {
                url: image.imageDataUrl,
                detail: "high" as const
              }
            }
          ])
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
          `Carrier manifest extraction failed with status ${response.status}. Request size was ${formatByteSize(requestBody.length)}.`
      },
      { status: 502 }
    );
  }

  const content = readAssistantContent(json);
  let parsed: { rows?: unknown[] };

  try {
    parsed = JSON.parse(content) as { rows?: unknown[] };
  } catch {
    return NextResponse.json({ error: "OpenAI returned non-JSON carrier manifest output." }, { status: 502 });
  }

  return NextResponse.json({
    model: DEFAULT_VISION_MODEL,
    rows: normalizeRows(parsed.rows, images.map((image) => image.pageNumber))
  });
}

function buildPrompt(pageNumbers: number[]) {
  return [
    "Each attached image is a labeled crop sheet from one BOL page in the daily Garland BOL bundle.",
    `Page numbers: ${pageNumbers.join(", ")}.`,
    "For each page, inspect the labeled Carrier box first. This is the most important field.",
    "Target carrier examples include SURETRACK STANDARD, SURETRAK, SURE TRACK, SPEEDY TRANSPORT, SPEEDY, MIDLAND TRANSPORT, and MIDLAND.",
    "Only return rows for carriers Midland, Speedy, or Suretrack/Sure Track/Suretrak. Ignore all other carriers.",
    "If the carrier is one of those targets, return a row. Spend extra effort reading the details before leaving anything blank.",
    "Some BOLs can be multiple pages. Return a row only when the crop sheet shows a new BOL header with a target carrier. If the crop sheet is a continuation page with no target carrier/PS header, return no row for that page.",
    "For matching pages, extract these exact fields from the labeled crops:",
    "1. carrier from Carrier box.",
    "2. psNumber from References / PS box. It is the PS value before the first dash, for example PS209872 from PS209872-SR810664 - SR810664.",
    "3. cityProvince from Consignee city/province. Use only city and province/state, for example OTTAWA, ON or CALGARY, AB. Do not include postal code or country.",
    "4. skids from Total pallets, for example Total: 1 PALLETS means skids 1. If there is a conflict, trust the Total pallets crop.",
    "Also extract srNumber from Shipment ID when visible, but it is secondary.",
    "Never return N/A for fields. Use an empty string for unknown text fields and null for unknown skids.",
    "Only use HIGH confidence when carrier, PS number, city/province, and pallet count were all read from the page. Use LOW if only the carrier was found.",
    "Normalize carrier to one of MIDLAND, SPEEDY, SURETRACK.",
    "pageNumber must match the attached BOL page number.",
    "SR number should be the SR/shipment/order id digits only when visible, otherwise an empty string.",
    "PS number should be formatted PS123456 when visible, otherwise null.",
    "cityProvince should look like CITY, PROVINCE/STATE, for example CALGARY, AB, otherwise an empty string.",
    "skids should be a number when visible, otherwise null. Pallets count as skids for this manifest.",
    "Return JSON exactly like: {\"rows\":[{\"pageNumber\":1,\"carrier\":\"SURETRACK\",\"srNumber\":\"810036\",\"psNumber\":\"PS209606\",\"cityProvince\":\"CALGARY, AB\",\"skids\":2,\"confidence\":\"HIGH\",\"notes\":\"short note\"}]}"
  ].join(" ");
}

function normalizeRows(value: unknown, pageNumbers: number[]): GarlandCarrierManifestRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const carrier = normalizeCarrier(record.carrier);

    if (!carrier) {
      return [];
    }

    const pageNumber = normalizePageNumber(readFirstValue(record, ["pageNumber", "page", "bolPage"])) ?? (pageNumbers.length === 1 ? pageNumbers[0] : null);
    const psNumber = normalizeManifestPsNumber(readFirstValue(record, ["psNumber", "ps", "reference", "references", "referenceNumber"]));

    if (!pageNumber) {
      return [];
    }

    return [
      {
        carrier,
        pageNumber,
        srNumber: normalizeDigits(readFirstValue(record, ["srNumber", "sr", "shipmentId", "shipmentID"])),
        psNumber: psNumber ?? "",
        cityProvince: normalizeText(readFirstValue(record, ["cityProvince", "cityProv", "city", "destination", "consigneeCityProvince"])),
        skids: normalizeSkids(readFirstValue(record, ["skids", "pallets", "palletCount", "totalPallets"])),
        confidence: normalizeConfidence(record.confidence, {
          psNumber: psNumber ?? "",
          cityProvince: normalizeText(readFirstValue(record, ["cityProvince", "cityProv", "city", "destination", "consigneeCityProvince"])),
          skids: normalizeSkids(readFirstValue(record, ["skids", "pallets", "palletCount", "totalPallets"]))
        }),
        notes: normalizeNullableText(record.notes)
      }
    ];
  });
}

function readFirstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function normalizeManifestPsNumber(value: unknown) {
  const text = normalizeNullableText(value);
  return normalizePsNumber(text) ?? extractPsNumberFromText(text);
}

function normalizeCarrier(value: unknown): GarlandCarrierKey | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, "").toUpperCase();

  if (normalized.includes("MIDLAND")) {
    return "MIDLAND";
  }

  if (normalized.includes("SPEEDY")) {
    return "SPEEDY";
  }

  if (normalized.includes("SURETRACK") || normalized.includes("SURETRAK")) {
    return "SURETRACK";
  }

  return null;
}

function normalizePageNumber(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const digits = value.match(/\d+/)?.[0];
    const parsed = digits ? Number.parseInt(digits, 10) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function normalizeDigits(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).replace(/\D+/g, "") : "";
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toUpperCase() : "";
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function normalizeSkids(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  return null;
}

function normalizeConfidence(
  value: unknown,
  fields?: { psNumber: string; cityProvince: string; skids: number | null }
): "LOW" | "MEDIUM" | "HIGH" {
  if (fields && (!fields.psNumber || !fields.cityProvince || fields.skids === null)) {
    return "LOW";
  }

  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "MEDIUM";
}

function formatByteSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    throw new Error("OpenAI returned an empty carrier manifest response.");
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
