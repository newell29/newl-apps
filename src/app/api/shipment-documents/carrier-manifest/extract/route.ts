import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import type { GarlandCarrierKey, GarlandCarrierManifestRow } from "@/modules/shipment-documents/carrier-manifest-types";
import { extractPsNumberFromText, normalizePsNumber } from "@/modules/shipment-documents/ps-number";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_VISION_MODEL = process.env.OPENAI_DOCUMENT_VISION_MODEL?.trim() || "gpt-5-mini";
const FALLBACK_VISION_MODEL = process.env.OPENAI_DOCUMENT_VISION_FALLBACK_MODEL?.trim() || "gpt-4o";

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

  let primaryRows: GarlandCarrierManifestRow[];

  try {
    const primary = await runOpenAiExtraction({
      apiKey,
      images,
      model: DEFAULT_VISION_MODEL,
      prompt: buildPrompt(images.map((image) => image.pageNumber)),
      systemPrompt:
        "You extract Garland Canada carrier loading-manifest rows from scanned BOL page images. Return JSON only. The key fields are carrier, PS/reference number, consignee city/province, and total pallets. Include a row for every new BOL whose CARRIER field contains Midland, Speedy, Suretrack, Sure Track, or Suretrak. Ignore other carriers and continuation/footer pages. Do not drop a matching carrier page just because another field is uncertain."
    });
    const parsedRows = readRowsFromParsedResponse(primary.parsed);
    primaryRows = normalizeRows(parsedRows, images.map((image) => image.pageNumber));
    logExtractionResult({
      stage: "primary",
      model: DEFAULT_VISION_MODEL,
      pageNumbers: images.map((image) => image.pageNumber),
      parsed: primary.parsed,
      parsedRowCount: parsedRows.length,
      normalizedRowCount: primaryRows.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Carrier manifest extraction failed." },
      { status: 502 }
    );
  }

  let fallbackRows: GarlandCarrierManifestRow[] = [];
  let fallbackError: string | null = null;

  if (primaryRows.length === 0) {
    try {
      const fallback = await runOpenAiExtraction({
        apiKey,
        images,
        model: FALLBACK_VISION_MODEL,
        prompt: buildFallbackPrompt(images.map((image) => image.pageNumber)),
        systemPrompt:
          "You are doing OCR on scanned Garland BOL page images. Return JSON only. Read the printed BOL labels and values literally. Do not return an empty result when a target carrier is printed in the CARRIER field of a new BOL."
      });
      const parsedRows = readRowsFromParsedResponse(fallback.parsed);
      fallbackRows = normalizeRows(parsedRows, images.map((image) => image.pageNumber));
      logExtractionResult({
        stage: "fallback",
        model: FALLBACK_VISION_MODEL,
        pageNumbers: images.map((image) => image.pageNumber),
        parsed: fallback.parsed,
        parsedRowCount: parsedRows.length,
        normalizedRowCount: fallbackRows.length
      });
    } catch (error) {
      fallbackError = error instanceof Error ? error.message : "Fallback carrier manifest extraction failed.";
    }
  }

  return NextResponse.json({
    model: fallbackRows.length > 0 ? FALLBACK_VISION_MODEL : DEFAULT_VISION_MODEL,
    fallbackUsed: fallbackRows.length > 0,
    fallbackError,
    rows: fallbackRows.length > 0 ? fallbackRows : primaryRows
  });
}

function logExtractionResult({
  stage,
  model,
  pageNumbers,
  parsed,
  parsedRowCount,
  normalizedRowCount
}: {
  stage: "primary" | "fallback";
  model: string;
  pageNumbers: number[];
  parsed: unknown;
  parsedRowCount: number;
  normalizedRowCount: number;
}) {
  console.info(
    "[garland-carrier-manifest] extraction",
    JSON.stringify({
      stage,
      model,
      pageNumbers,
      responseShape: describeResponseShape(parsed),
      parsedRowCount,
      normalizedRowCount
    })
  );
}

function describeResponseShape(value: unknown) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (!value || typeof value !== "object") {
    return typeof value;
  }

  return Object.keys(value as Record<string, unknown>).slice(0, 12);
}

function buildPrompt(pageNumbers: number[]) {
  return [
    "Each attached image is the top portion of one scanned BOL page in the daily Garland BOL bundle.",
    `Page numbers: ${pageNumbers.join(", ")}.`,
    "For each page, inspect the printed CARRIER field near the top first. This is the most important field.",
    "Target carrier examples include SURETRACK STANDARD, SURETRAK, SURE TRACK, SPEEDY TRANSPORT, SPEEDY, MIDLAND TRANSPORT, and MIDLAND.",
    "Only return rows for carriers Midland, Speedy, or Suretrack/Sure Track/Suretrak. Ignore all other carriers.",
    "If the carrier is one of those targets, return a row. Spend extra effort reading the details before leaving anything blank.",
    "Some BOLs can be multiple pages. Return a row only when the image shows a new BILL OF LADING header with printed CARRIER, REFERENCES, and SHIPMENT ID fields. A continuation/footer page can contain a handwritten carrier name near a signature; that is not a new BOL and must return no row.",
    "For matching pages, extract these exact fields from the printed BOL:",
    "1. carrier from the printed CARRIER field near the top left.",
    "2. psNumber from the printed REFERENCES field near the top right. It is the PS value before the first dash, for example PS209872 from PS209872-SR810664 - SR810664.",
    "3. cityProvince from the CONSIGNEE address. Use only city and province/state, for example OTTAWA, ON or CALGARY, AB. Do not include postal code or country.",
    "4. skids from the printed Total pallets line, for example Total: 1 PALLETS means skids 1. If there is a conflict, trust the Total line.",
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

function buildFallbackPrompt(pageNumbers: number[]) {
  return [
    "Each image is the top portion of one scanned Garland BOL page.",
    `Page numbers: ${pageNumbers.join(", ")}.`,
    "For each page, read the printed labels CARRIER, REFERENCES, SHIPMENT ID, CONSIGNEE, and Total pallets.",
    "Return a row if the printed CARRIER field of a new BOL contains SURETRACK, SURETRAK, SURE TRACK, SPEEDY, or MIDLAND.",
    "For non-target carriers, return no row.",
    "For continuation/footer pages without the printed new-BOL header fields, return no row even if a carrier name is handwritten near a signature.",
    "Map SURETRACK/SURETRAK/SURE TRACK to SURETRACK, SPEEDY to SPEEDY, MIDLAND to MIDLAND.",
    "Output exactly this JSON shape: {\"rows\":[{\"pageNumber\":1,\"carrier\":\"SURETRACK\",\"srNumber\":\"810036\",\"psNumber\":\"PS209606\",\"cityProvince\":\"CALGARY, AB\",\"skids\":2,\"confidence\":\"HIGH\",\"notes\":\"read from fallback OCR\"}]}."
  ].join(" ");
}

async function runOpenAiExtraction({
  apiKey,
  images,
  model,
  prompt,
  systemPrompt
}: {
  apiKey: string;
  images: Array<{ pageNumber: number; imageDataUrl: string }>;
  model: string;
  prompt: string;
  systemPrompt: string;
}) {
  const requestBody = JSON.stringify({
    model,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          ...images.flatMap((image) => [
            {
              type: "text" as const,
              text: `BOL page ${image.pageNumber}: inspect this scanned page image.`
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
    throw new Error(
      readOpenAiError(json) ??
        `Carrier manifest extraction failed with status ${response.status}. Request size was ${formatByteSize(requestBody.length)}.`
    );
  }

  const content = readAssistantContent(json);

  try {
    return {
      parsed: JSON.parse(content) as unknown
    };
  } catch {
    throw new Error("OpenAI returned non-JSON carrier manifest output.");
  }
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
    const carrier = normalizeCarrier(
      readFirstValue(record, [
        "carrier",
        "carrierName",
        "carrierText",
        "carrierRaw",
        "carrierBox",
        "carrierValue",
        "shippingCarrier"
      ])
    );

    if (!carrier) {
      return [];
    }

    const pageNumber =
      normalizePageNumber(readFirstValue(record, ["pageNumber", "page", "bolPage", "bolPageNumber"])) ??
      (pageNumbers.length === 1 ? pageNumbers[0] : null);
    const psNumber = normalizeManifestPsNumber(
      readFirstValue(record, ["psNumber", "ps", "preShipper", "reference", "references", "referenceNumber", "psReference"])
    );
    const cityProvince = normalizeText(
      readFirstValue(record, [
        "cityProvince",
        "cityProv",
        "city",
        "destination",
        "consignee",
        "consigneeCity",
        "consigneeCityProvince",
        "shipToCityProvince"
      ])
    );
    const skids = normalizeSkids(
      readFirstValue(record, ["skids", "pallets", "pallet", "palletCount", "totalPallets", "totalSkids", "packageTotal"])
    );

    if (!pageNumber) {
      return [];
    }

    return [
      {
        carrier,
        pageNumber,
        srNumber: normalizeDigits(readFirstValue(record, ["srNumber", "sr", "shipmentId", "shipmentID", "shipment", "orderNumber"])),
        psNumber: psNumber ?? "",
        cityProvince,
        skids,
        confidence: normalizeConfidence(record.confidence, {
          psNumber: psNumber ?? "",
          cityProvince,
          skids
        }),
        notes: normalizeNullableText(record.notes)
      }
    ];
  });
}

function readRowsFromParsedResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directRows = readFirstValue(record, ["rows", "entries", "pages", "manifests", "documents", "results", "data"]);

  if (Array.isArray(directRows)) {
    return directRows;
  }

  if (directRows && typeof directRows === "object") {
    return readRowsFromParsedResponse(directRows);
  }

  return [];
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
