import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { normalizePsNumber, type ShipmentDocumentType } from "@/modules/shipment-documents/ps-number";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_VISION_MODEL = process.env.OPENAI_DOCUMENT_VISION_MODEL?.trim() || "gpt-5-mini";

type DetectionRequest = {
  documentType: ShipmentDocumentType;
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
      { error: "OPENAI_API_KEY is not configured for scanned shipment document detection." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as DetectionRequest | null;
  const images = Array.isArray(body?.images) ? body.images.filter(isValidImagePayload) : [];

  if (!body?.documentType || !["BOL", "PICK_TICKET"].includes(body.documentType) || images.length === 0) {
    return NextResponse.json({ error: "Provide a documentType and at least one cropped page image." }, { status: 400 });
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_VISION_MODEL,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content:
            "You extract PS numbers from cropped shipment-document images. Return JSON only with an entries array. Each entry must include pageNumber, psNumber, confidence, and notes. psNumber must be formatted as PS followed by digits, or null if no PS number is visible. Do not invent values."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildPrompt(body.documentType, images.map((image) => image.pageNumber))
            },
            ...images.map((image) => ({
              type: "image_url" as const,
              image_url: {
                url: image.imageDataUrl
              }
            }))
          ]
        }
      ]
    }),
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    return NextResponse.json(
      { error: readOpenAiError(json) ?? `OpenAI detection failed with status ${response.status}.` },
      { status: 502 }
    );
  }

  const content = readAssistantContent(json);

  let parsed: {
    entries?: Array<{
      pageNumber?: number;
      psNumber?: string | null;
      confidence?: string | null;
      notes?: string | null;
    }>;
  };

  try {
    parsed = JSON.parse(content) as {
      entries?: Array<{
        pageNumber?: number;
        psNumber?: string | null;
        confidence?: string | null;
        notes?: string | null;
      }>;
    };
  } catch {
    return NextResponse.json({ error: "OpenAI returned non-JSON shipment detection output." }, { status: 502 });
  }

  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const normalizedEntries = images.map((image) => {
    const match = entries.find((entry) => entry.pageNumber === image.pageNumber);
    const psNumber = normalizePsNumber(match?.psNumber ?? null);

    return {
      pageNumber: image.pageNumber,
      psNumber,
      confidence: typeof match?.confidence === "string" ? match.confidence : psNumber ? "MEDIUM" : "LOW",
      notes: typeof match?.notes === "string" ? match.notes : null
    };
  });

  return NextResponse.json({
    model: DEFAULT_VISION_MODEL,
    entries: normalizedEntries
  });
}

function buildPrompt(documentType: ShipmentDocumentType, pageNumbers: number[]) {
  return [
    `Document type: ${documentType}.`,
    "Each attached image is a cropped header/reference area from one page, in the same order as the page numbers below.",
    `Page numbers: ${pageNumbers.join(", ")}.`,
    documentType === "BOL"
      ? "For BOL crops, the PS number typically appears near a References label."
      : "For pick ticket crops, the PS number typically appears near a Pre-Shipper label.",
    "Return JSON with this shape: {\"entries\":[{\"pageNumber\":1,\"psNumber\":\"PS123456\",\"confidence\":\"HIGH\",\"notes\":\"short note\"}]}"
  ].join(" ");
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
    throw new Error("OpenAI returned an empty shipment detection response.");
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
