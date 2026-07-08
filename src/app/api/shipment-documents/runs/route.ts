import { ModuleKey, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  buildShipmentDocumentRunSearchText,
  getShipmentDocumentRunHistory,
  mapShipmentDocumentRunSummary
} from "@/modules/shipment-documents/queries";
import { normalizePsNumber } from "@/modules/shipment-documents/ps-number";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type ShipmentDocumentRunMutationClient = typeof prisma & {
  shipmentDocumentRun: {
    create(args: {
      data: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{
      id: string;
      workflowKey: string;
      documentLabel: string;
      shipmentDate: Date;
      recipientEmail: string | null;
      sourceBolFileName: string | null;
      sourcePickTicketFileName: string | null;
      outputBolFileName: string;
      outputPickTicketFileName: string;
      bolPageCount: number;
      pickTicketPageCount: number;
      bolAiFallbackPageCount: number;
      pickAiFallbackPageCount: number;
      bolPsNumbers: unknown;
      pickPsNumbers: unknown;
      createdAt: Date;
      createdBy: {
        name: string | null;
        email: string;
      } | null;
    }>;
  };
};

type SaveRunPayload = {
  shipmentDate: string;
  documentLabel: string;
  recipientEmail?: string | null;
  sourceBolFileName?: string | null;
  sourcePickTicketFileName?: string | null;
  deferPdfUpload?: boolean;
  bol: SaveRunDocumentPayload;
  pickTickets: SaveRunDocumentPayload;
};

type SaveRunDocumentPayload = {
  fileName: string;
  pageCount: number;
  pages: Array<{
    pageNumber: number;
    psNumber: string;
    detectionMethod: "TEXT" | "AI" | "INHERITED" | "MANUAL";
    confidence: string;
    notes?: string | null;
  }>;
  pdfBase64?: string;
};

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const history = await getShipmentDocumentRunHistory(context, { search });

    return NextResponse.json(history);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load shipment document history." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const client = prisma as ShipmentDocumentRunMutationClient;

    const body = (await request.json().catch(() => null)) as SaveRunPayload | null;

    if (!body) {
      return NextResponse.json({ error: "A shipment document run payload is required." }, { status: 400 });
    }

    const shipmentDate = parseShipmentDate(body.shipmentDate);
    const documentLabel = readRequiredString(body.documentLabel, "documentLabel");
    const deferPdfUpload = body.deferPdfUpload === true;
    const bol = validateDocumentPayload(body.bol, "BOL", deferPdfUpload);
    const pickTickets = validateDocumentPayload(body.pickTickets, "Pick tickets", deferPdfUpload);
    const recipientEmail = readOptionalString(body.recipientEmail);
    const sourceBolFileName = readOptionalString(body.sourceBolFileName);
    const sourcePickTicketFileName = readOptionalString(body.sourcePickTicketFileName);
    const bolPsNumbers = normalizePsNumbersFromPages(bol.pages);
    const pickPsNumbers = normalizePsNumbersFromPages(pickTickets.pages);

    const created = await client.shipmentDocumentRun.create({
      data: {
        tenantId: context.tenantId,
        workflowKey: "GARLAND_CANADA",
        documentLabel,
        shipmentDate,
        recipientEmail,
        sourceBolFileName,
        sourcePickTicketFileName,
        outputBolFileName: bol.fileName,
        outputPickTicketFileName: pickTickets.fileName,
        bolPageCount: bol.pageCount,
        pickTicketPageCount: pickTickets.pageCount,
        bolAiFallbackPageCount: countAiFallbackPages(bol.pages),
        pickAiFallbackPageCount: countAiFallbackPages(pickTickets.pages),
        bolPsNumbers: bolPsNumbers as Prisma.InputJsonValue,
        pickPsNumbers: pickPsNumbers as Prisma.InputJsonValue,
        searchText: buildShipmentDocumentRunSearchText({
          documentLabel,
          shipmentDate: body.shipmentDate,
          recipientEmail,
          sourceBolFileName,
          sourcePickTicketFileName,
          bolPsNumbers,
          pickPsNumbers
        }),
        bolPdfBytes: deferPdfUpload ? Buffer.alloc(0) : decodeBase64Pdf(readRequiredString(bol.pdfBase64, "BOL pdfBase64")),
        pickTicketPdfBytes: deferPdfUpload
          ? Buffer.alloc(0)
          : decodeBase64Pdf(readRequiredString(pickTickets.pdfBase64, "Pick tickets pdfBase64")),
        bolPdfUploadComplete: !deferPdfUpload,
        pickPdfUploadComplete: !deferPdfUpload,
        createdByUserId: context.userId
      },
      select: {
        id: true,
        workflowKey: true,
        documentLabel: true,
        shipmentDate: true,
        recipientEmail: true,
        sourceBolFileName: true,
        sourcePickTicketFileName: true,
        outputBolFileName: true,
        outputPickTicketFileName: true,
        bolPageCount: true,
        pickTicketPageCount: true,
        bolAiFallbackPageCount: true,
        pickAiFallbackPageCount: true,
        bolPsNumbers: true,
        pickPsNumbers: true,
        createdAt: true,
        createdBy: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    return NextResponse.json({ run: mapShipmentDocumentRunSummary(created) }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save shipment document run." },
      { status: 500 }
    );
  }
}

function parseShipmentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("shipmentDate must use YYYY-MM-DD format.");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("shipmentDate is invalid.");
  }

  return parsed;
}

function validateDocumentPayload(value: SaveRunDocumentPayload | undefined, label: string, deferPdfUpload: boolean) {
  if (!value) {
    throw new Error(`${label} output is required.`);
  }

  const fileName = readRequiredString(value.fileName, `${label} fileName`);
  const pageCount = Number.isInteger(value.pageCount) && value.pageCount > 0 ? value.pageCount : null;
  if (!pageCount) {
    throw new Error(`${label} pageCount must be a positive integer.`);
  }

  if (!Array.isArray(value.pages) || value.pages.length === 0) {
    throw new Error(`${label} pages are required.`);
  }

  const pdfBase64 = deferPdfUpload ? undefined : readRequiredString(value.pdfBase64, `${label} pdfBase64`);

  return {
    fileName,
    pageCount,
    pages: value.pages,
    pdfBase64
  };
}

function readRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function decodeBase64Pdf(value: string) {
  const buffer = Buffer.from(value, "base64");

  if (buffer.byteLength === 0) {
    throw new Error("Generated PDF contents were empty.");
  }

  return buffer;
}

function normalizePsNumbersFromPages(
  pages: Array<{ psNumber: string; detectionMethod: "TEXT" | "AI" | "INHERITED" | "MANUAL"; confidence: string; pageNumber: number }>
) {
  return pages
    .map((page) => normalizePsNumber(page.psNumber))
    .filter((value): value is string => Boolean(value));
}

function countAiFallbackPages(
  pages: Array<{ detectionMethod: "TEXT" | "AI" | "INHERITED" | "MANUAL" }>
) {
  return pages.filter((page) => page.detectionMethod === "AI").length;
}
