import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createTeamshipUpdateJob,
  getTeamshipUpdateJobs
} from "@/modules/shipment-documents/teamship-update-jobs";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type CreateUpdateJobPayload = {
  documentLabel?: unknown;
  shipmentDate?: unknown;
  sourcePdfFileName?: unknown;
  review?: unknown;
  selectedSrNumbers?: unknown;
};

export async function GET() {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const jobs = await getTeamshipUpdateJobs(context);

    return NextResponse.json(jobs);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Teamship update jobs." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const body = (await request.json().catch(() => null)) as CreateUpdateJobPayload | null;

    if (!body) {
      return NextResponse.json({ error: "A Teamship update job payload is required." }, { status: 400 });
    }

    const job = await createTeamshipUpdateJob(context, {
      documentLabel: readRequiredString(body.documentLabel, "documentLabel"),
      shipmentDate: readRequiredString(body.shipmentDate, "shipmentDate"),
      sourcePdfFileName: readOptionalString(body.sourcePdfFileName),
      review: readReviewResponse(body.review),
      selectedSrNumbers: readStringArray(body.selectedSrNumbers)
    });
    const jobs = await getTeamshipUpdateJobs(context);

    return NextResponse.json({ job, ...jobs }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create Teamship update job." },
      { status: 500 }
    );
  }
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

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function readReviewResponse(value: unknown): GarlandTeamshipReviewResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("summary" in value) ||
    !("pdfOrders" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).pdfOrders) ||
    !("reviews" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).reviews)
  ) {
    throw new Error("A completed Teamship review response is required before creating an update job.");
  }

  return value as GarlandTeamshipReviewResponse;
}
