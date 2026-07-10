import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import type { GarlandCarrierKey, GarlandCarrierManifestRow } from "@/modules/shipment-documents/carrier-manifest-types";
import { normalizePsNumber } from "@/modules/shipment-documents/ps-number";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_VISION_MODEL = process.env.OPENAI_DOCUMENT_VISION_MODEL?.trim() || "gpt-5-mini";

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
          "You extract Garland Canada carrier manifest rows from BOL page images. Return JSON only. Include a row only when the carrier is Midland, Speedy, or Suretrack/Sure Track. Ignore all other carriers. Do not invent missing fields."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildPrompt(images.map((image) => image.pageNumber))
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
    rows: normalizeRows(parsed.rows)
  });
}

function buildPrompt(pageNumbers: number[]) {
  return [
    "Each attached image is one full BOL page from the daily Garland BOL bundle.",
    `Page numbers: ${pageNumbers.join(", ")}.`,
    "For each page, inspect the carrier field, shipment/order id, references/PS number, consignee city/province, and skids/pallets/handling-unit count.",
    "Only return rows for carriers Midland, Speedy, or Suretrack/Sure Track. Ignore all other carriers.",
    "Normalize carrier to one of MIDLAND, SPEEDY, SURETRACK.",
    "SR number should be the SR/shipment/order id digits only when visible.",
    "PS number should be formatted PS123456 when visible.",
    "cityProvince should look like CITY, PROVINCE/STATE, for example CALGARY, AB.",
    "skids should be a number when visible, otherwise null.",
    "Return JSON exactly like: {\"rows\":[{\"pageNumber\":1,\"carrier\":\"SURETRACK\",\"srNumber\":\"810036\",\"psNumber\":\"PS209606\",\"cityProvince\":\"CALGARY, AB\",\"skids\":2,\"confidence\":\"HIGH\",\"notes\":\"short note\"}]}"
  ].join(" ");
}

function normalizeRows(value: unknown): GarlandCarrierManifestRow[] {
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

    const pageNumber = typeof record.pageNumber === "number" && Number.isInteger(record.pageNumber) ? record.pageNumber : null;
    const psNumber = normalizePsNumber(typeof record.psNumber === "string" ? record.psNumber : null);

    if (!pageNumber || !psNumber) {
      return [];
    }

    return [
      {
        carrier,
        pageNumber,
        srNumber: normalizeDigits(record.srNumber),
        psNumber,
        cityProvince: normalizeText(record.cityProvince),
        skids: normalizeSkids(record.skids),
        confidence: normalizeConfidence(record.confidence),
        notes: normalizeNullableText(record.notes)
      }
    ];
  });
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

function normalizeConfidence(value: unknown): "LOW" | "MEDIUM" | "HIGH" {
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
