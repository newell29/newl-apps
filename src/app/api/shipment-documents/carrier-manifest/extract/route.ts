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
  let primaryParsedRows: unknown[] = [];

  try {
    const primary = await runOpenAiExtraction({
      apiKey,
      images,
      model: DEFAULT_VISION_MODEL,
      prompt: buildPrompt(images.map((image) => image.pageNumber)),
      systemPrompt:
        "You do OCR on Garland Canada BOL crop sheets. Return JSON only. Read each labeled crop literally and return one page entry for every attached image. Do not filter by carrier; the app will filter target carriers after OCR."
    });
    const parsedRows = readRowsFromParsedResponse(primary.parsed);
    primaryParsedRows = parsedRows;
    primaryRows = normalizeRows(parsedRows, images.map((image) => image.pageNumber));
    logExtractionResult({
      stage: "primary",
      model: DEFAULT_VISION_MODEL,
      pageNumbers: images.map((image) => image.pageNumber),
      parsed: primary.parsed,
      parsedRows,
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

  if (shouldRunFallback(primaryRows, primaryParsedRows)) {
    try {
      const fallback = await runOpenAiExtraction({
        apiKey,
        images,
        model: FALLBACK_VISION_MODEL,
        prompt: buildFallbackPrompt(images.map((image) => image.pageNumber)),
        systemPrompt:
          "You are doing literal OCR on Garland BOL crop sheets. Return JSON only. Always return one page entry for every attached image, even when the carrier is not a target carrier."
      });
      const parsedRows = readRowsFromParsedResponse(fallback.parsed);
      fallbackRows = normalizeRows(parsedRows, images.map((image) => image.pageNumber));
      logExtractionResult({
        stage: "fallback",
        model: FALLBACK_VISION_MODEL,
        pageNumbers: images.map((image) => image.pageNumber),
        parsed: fallback.parsed,
        parsedRows,
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
  parsedRows,
  parsedRowCount,
  normalizedRowCount
}: {
  stage: "primary" | "fallback";
  model: string;
  pageNumbers: number[];
  parsed: unknown;
  parsedRows: unknown[];
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
      rowDiagnostics: buildRowDiagnostics(parsedRows),
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
    "Each attached image is a labeled crop sheet made from one scanned Garland BOL page.",
    `Page numbers: ${pageNumbers.join(", ")}.`,
    "Every crop sheet has labels such as Header overview, Carrier box, References and shipment id, Consignee city/province, and Total pallets.",
    "Return exactly one OCR entry per attached image. Do not skip non-target carriers. Do not decide whether the app needs the row.",
    "Set isNewBolPage true only when the Header overview shows a new BILL OF LADING header with printed CARRIER, REFERENCES, and SHIPMENT ID fields.",
    "Set isNewBolPage false for continuation/footer pages, signature pages, or pages that only show lower BOL sections. A handwritten carrier name in a signature area is not a new BOL.",
    "Read carrier as the literal value under the Carrier box label, for example SURETRACK STANDARD, SPEEDY, MIDLAND, DAY & ROSS, or blank.",
    "Read psNumber from References and shipment id. The PS value is before the first dash, for example PS209872 from PS209872-SR810664 - SR810664.",
    "Read srNumber from Shipment ID in References and shipment id. Use digits only, for example 810664 from SR810664.",
    "Read cityProvince from Consignee city/province. Use only city and province/state, for example OTTAWA, ON or CALGARY, AB. Do not include postal code or country.",
    "Read skids from Total pallets. Total: 1 PALLETS means 1. Pallets count as skids.",
    "Use empty strings for unknown text fields and null for unknown skids. Do not use N/A.",
    "Use HIGH confidence when the printed crop labels are clear, MEDIUM when one value is uncertain, and LOW when most fields are blank.",
    "Return JSON exactly like: {\"rows\":[{\"pageNumber\":1,\"isNewBolPage\":true,\"carrier\":\"SURETRACK STANDARD\",\"srNumber\":\"810036\",\"psNumber\":\"PS209606\",\"cityProvince\":\"CALGARY, AB\",\"skids\":2,\"confidence\":\"HIGH\",\"notes\":\"literal OCR from crop sheet\"}]}"
  ].join(" ");
}

function buildFallbackPrompt(pageNumbers: number[]) {
  return [
    "Each image is a labeled crop sheet for one scanned Garland BOL page.",
    `Page numbers: ${pageNumbers.join(", ")}.`,
    "Return one OCR entry for every image. Do not filter by carrier.",
    "Read these literal fields from the labels: Carrier box, References and shipment id, Consignee city/province, and Total pallets.",
    "Set isNewBolPage true only for a new BOL header page. Set it false for continuation/footer/signature pages.",
    "Output exactly this JSON shape: {\"rows\":[{\"pageNumber\":1,\"isNewBolPage\":true,\"carrier\":\"SURETRACK STANDARD\",\"srNumber\":\"810036\",\"psNumber\":\"PS209606\",\"cityProvince\":\"CALGARY, AB\",\"skids\":2,\"confidence\":\"HIGH\",\"notes\":\"fallback OCR from crop sheet\"}]}."
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
    const isNewBolPage = readBooleanLike(
      readFirstValue(record, ["isNewBolPage", "isNewBol", "newBol", "newBolPage", "headerPresent", "newBillOfLading"])
    );
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
    const srNumber = normalizeDigits(
      readFirstValue(record, ["srNumber", "sr", "shipmentId", "shipmentID", "shipment", "orderNumber"])
    );

    if (isNewBolPage === false && !hasStrongBolFields({ psNumber, srNumber, cityProvince, skids })) {
      return [];
    }

    if (!pageNumber) {
      return [];
    }

    return [
      {
        carrier,
        pageNumber,
        srNumber,
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

function shouldRunFallback(primaryRows: GarlandCarrierManifestRow[], parsedRows: unknown[]) {
  if (primaryRows.length > 0) {
    return false;
  }

  if (parsedRows.length === 0) {
    return true;
  }

  return parsedRows.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return true;
    }

    const record = entry as Record<string, unknown>;
    const isNewBolPage = readBooleanLike(
      readFirstValue(record, ["isNewBolPage", "isNewBol", "newBol", "newBolPage", "headerPresent", "newBillOfLading"])
    );
    const carrierText = normalizeNullableText(
      readFirstValue(record, ["carrier", "carrierName", "carrierText", "carrierRaw", "carrierBox", "carrierValue"])
    );
    const psNumber = normalizeManifestPsNumber(
      readFirstValue(record, ["psNumber", "ps", "preShipper", "reference", "references", "referenceNumber", "psReference"])
    );
    const srNumber = normalizeDigits(
      readFirstValue(record, ["srNumber", "sr", "shipmentId", "shipmentID", "shipment", "orderNumber"])
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

    return !carrierText || (isNewBolPage === false && hasStrongBolFields({ psNumber, srNumber, cityProvince, skids }));
  });
}

function buildRowDiagnostics(rows: unknown[]) {
  return rows.slice(0, 5).map((entry) => {
    if (!entry || typeof entry !== "object") {
      return { shape: typeof entry };
    }

    const record = entry as Record<string, unknown>;
    const psNumber = normalizeManifestPsNumber(
      readFirstValue(record, ["psNumber", "ps", "preShipper", "reference", "references", "referenceNumber", "psReference"])
    );
    const srNumber = normalizeDigits(
      readFirstValue(record, ["srNumber", "sr", "shipmentId", "shipmentID", "shipment", "orderNumber"])
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
    const isNewBolPage = readBooleanLike(
      readFirstValue(record, ["isNewBolPage", "isNewBol", "newBol", "newBolPage", "headerPresent", "newBillOfLading"])
    );

    return {
      keys: Object.keys(record).slice(0, 12),
      carrier: normalizeCarrier(
        readFirstValue(record, ["carrier", "carrierName", "carrierText", "carrierRaw", "carrierBox", "carrierValue"])
      ),
      isNewBolPage,
      hasPs: Boolean(psNumber),
      hasSr: Boolean(srNumber),
      hasCity: cityProvince.length > 0,
      hasSkids: skids !== null,
      hasStrongBolFields: hasStrongBolFields({ psNumber, srNumber, cityProvince, skids })
    };
  });
}

function hasStrongBolFields({
  psNumber,
  srNumber,
  cityProvince,
  skids
}: {
  psNumber: string | null;
  srNumber: string;
  cityProvince: string;
  skids: number | null;
}) {
  return Boolean(psNumber && (srNumber || cityProvince || skids !== null));
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

function readBooleanLike(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "yes", "new", "new bol", "header", "header present"].includes(normalized)) {
      return true;
    }

    if (["false", "no", "continuation", "footer", "signature", "not new", "not a new bol"].includes(normalized)) {
      return false;
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
