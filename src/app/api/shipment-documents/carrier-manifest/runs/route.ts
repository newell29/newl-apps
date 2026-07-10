import { ModuleKey, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getGarlandCarrierManifestHistory } from "@/modules/shipment-documents/carrier-manifest-queries";
import type { GarlandCarrierKey, GarlandCarrierManifestRow } from "@/modules/shipment-documents/carrier-manifest-types";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SaveManifestPayload = {
  shipmentDate: string;
  documentLabel: string;
  sourceBolFileName?: string | null;
  rows: GarlandCarrierManifestRow[];
  workbooks: Partial<Record<GarlandCarrierKey, { fileName: string; base64: string }>>;
};

type CarrierManifestRunMutationClient = typeof prisma & {
  shipmentCarrierManifestRun: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export async function GET() {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const history = await getGarlandCarrierManifestHistory(context);

    return NextResponse.json(history);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Garland carrier manifest history." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const client = prisma as CarrierManifestRunMutationClient;
    const body = (await request.json().catch(() => null)) as SaveManifestPayload | null;

    if (!body) {
      return NextResponse.json({ error: "A carrier manifest payload is required." }, { status: 400 });
    }

    const shipmentDate = parseShipmentDate(body.shipmentDate);
    const documentLabel = readRequiredString(body.documentLabel, "documentLabel");
    const rows = Array.isArray(body.rows) ? body.rows.filter(isManifestRow) : [];

    if (rows.length === 0) {
      return NextResponse.json({ error: "At least one Midland, Speedy, or Suretrack row is required." }, { status: 400 });
    }

    const counts = buildCarrierCounts(rows);
    const workbooks = body.workbooks ?? {};

    await client.shipmentCarrierManifestRun.create({
      data: {
        tenantId: context.tenantId,
        workflowKey: "GARLAND_CARRIER_MANIFEST",
        documentLabel,
        shipmentDate,
        sourceBolFileName: readOptionalString(body.sourceBolFileName),
        carrierCounts: counts as Prisma.InputJsonValue,
        manifestRows: rows as Prisma.InputJsonValue,
        midlandFileName: workbooks.MIDLAND?.fileName ?? null,
        midlandWorkbookBytes: workbooks.MIDLAND ? decodeBase64(workbooks.MIDLAND.base64) : null,
        speedyFileName: workbooks.SPEEDY?.fileName ?? null,
        speedyWorkbookBytes: workbooks.SPEEDY ? decodeBase64(workbooks.SPEEDY.base64) : null,
        suretrackFileName: workbooks.SURETRACK?.fileName ?? null,
        suretrackWorkbookBytes: workbooks.SURETRACK ? decodeBase64(workbooks.SURETRACK.base64) : null,
        createdByUserId: context.userId
      }
    });

    const history = await getGarlandCarrierManifestHistory(context);
    return NextResponse.json(history, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save Garland carrier manifest run." },
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

function readRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function decodeBase64(value: string) {
  const buffer = Buffer.from(value, "base64");

  if (buffer.byteLength === 0) {
    throw new Error("Generated workbook contents were empty.");
  }

  return buffer;
}

function isManifestRow(value: GarlandCarrierManifestRow): value is GarlandCarrierManifestRow {
  return (
    value &&
    ["MIDLAND", "SPEEDY", "SURETRACK"].includes(value.carrier) &&
    typeof value.pageNumber === "number" &&
    typeof value.srNumber === "string" &&
    typeof value.psNumber === "string" &&
    typeof value.cityProvince === "string"
  );
}

function buildCarrierCounts(rows: GarlandCarrierManifestRow[]): Record<GarlandCarrierKey, number> {
  return {
    MIDLAND: rows.filter((row) => row.carrier === "MIDLAND").length,
    SPEEDY: rows.filter((row) => row.carrier === "SPEEDY").length,
    SURETRACK: rows.filter((row) => row.carrier === "SURETRACK").length
  };
}
