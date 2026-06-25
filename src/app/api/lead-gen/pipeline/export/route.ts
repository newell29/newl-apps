import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  getLeadPipeline,
  type LeadPipelineApolloStatusFilter,
  type LeadPipelineCandidateStatusFilter,
  type LeadPipelineContactStatusFilter,
  type LeadPipelineSequenceStatusFilter,
  type LeadPipelineSort
} from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);

    const url = new URL(request.url);
    const stage = parseStageParam(url.searchParams.get("stage"));
    const ownerUserId = parseOwnerParam(url.searchParams.get("rep"));
    const industry = readNullable(url.searchParams.get("industry"));
    const candidateStatus = parseCandidateStatusParam(url.searchParams.get("candidateStatus"));
    const contactStatus = parseContactStatusParam(url.searchParams.get("contactStatus"));
    const apolloStatus = parseApolloStatusParam(url.searchParams.get("apolloStatus"));
    const sequenceStatus = parseSequenceStatusParam(url.searchParams.get("sequenceStatus"));
    const minShipments30d = parseShipmentCountParam(url.searchParams.get("minShipments30d"));
    const maxShipments30d = parseShipmentCountParam(url.searchParams.get("maxShipments30d"));
    const minShipments90d = parseShipmentCountParam(url.searchParams.get("minShipments90d"));
    const maxShipments90d = parseShipmentCountParam(url.searchParams.get("maxShipments90d"));
    const minScore = parseScoreParam(url.searchParams.get("minScore"));
    const maxScore = parseScoreParam(url.searchParams.get("maxScore"));
    const sort = parseSortParam(url.searchParams.get("sort"));

    const leads = await getLeadPipeline(context, {
      stage,
      ownerUserId,
      industry: industry ?? undefined,
      candidateStatus,
      contactStatus,
      apolloStatus,
      sequenceStatus,
      minShipments30d,
      maxShipments30d,
      minShipments90d,
      maxShipments90d,
      minScore,
      maxScore,
      sort
    });

    const csv = toCsv([
      [
        "Company",
        "Normalized Name",
        "Pipeline Stage",
        "Candidate Status",
        "Industry",
        "Shipments 30d",
        "Shipments 90d",
        "Score",
        "Company Score",
        "Assigned Rep",
        "Primary Contact",
        "Contact Status",
        "Apollo Status",
        "Sequence Status",
        "Sequence Readiness",
        "Next Step",
        "Notes",
        "Approved At",
        "Updated At"
      ],
      ...leads.map((lead) => [
        lead.companyName,
        lead.normalizedName,
        lead.stage,
        lead.candidateStatus,
        lead.primaryIndustry ?? "",
        String(lead.shipmentCount30d),
        String(lead.shipmentCount90d),
        String(lead.score),
        String(lead.companyScore),
        lead.assignedRep,
        lead.contactName ?? "",
        lead.contactStatus,
        lead.apolloStatus,
        lead.sequenceStatus,
        lead.sequenceReadiness,
        lead.nextStep,
        lead.notes ?? "",
        lead.approvedAt.toISOString(),
        lead.updatedAt.toISOString()
      ])
    ]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pipeline_export.csv"'
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to export pipeline."
      },
      { status: 500 }
    );
  }
}

function toCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");
}

function readNullable(value: string | null) {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function parseStageParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return (
    value === "NEW" ||
    value === "RESEARCHING" ||
    value === "ENRICHED" ||
    value === "CONTACTED" ||
    value === "REPLIED" ||
    value === "QUOTED" ||
    value === "QUALIFIED" ||
    value === "MEETING_BOOKED" ||
    value === "WON" ||
    value === "LOST" ||
    value === "DISQUALIFIED"
  )
    ? value
    : "ALL";
}

function parseOwnerParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value === "UNASSIGNED" ? "UNASSIGNED" : value;
}

function parseCandidateStatusParam(value: string | null): LeadPipelineCandidateStatusFilter {
  return value === "NEW" ||
    value === "REVIEWING" ||
    value === "APPROVED_FOR_PIPELINE" ||
    value === "REJECTED" ||
    value === "DISQUALIFIED"
    ? value
    : "ALL";
}

function parseContactStatusParam(value: string | null): LeadPipelineContactStatusFilter {
  return value === "NOT_ENRICHED" ||
    value === "PRIMARY_SELECTED" ||
    value === "APPROVED" ||
    value === "REVIEWING" ||
    value === "FOUND"
    ? value
    : "ALL";
}

function parseApolloStatusParam(value: string | null): LeadPipelineApolloStatusFilter {
  return value === "NOT_STARTED" ||
    value === "QUEUED" ||
    value === "ENRICHED" ||
    value === "NOT_FOUND" ||
    value === "COMPANY_REVIEW_NEEDED" ||
    value === "NEEDS_REVIEW"
    ? value
    : "ALL";
}

function parseSequenceStatusParam(value: string | null): LeadPipelineSequenceStatusFilter {
  return value === "NOT_STARTED" ||
    value === "READY" ||
    value === "ENROLLED" ||
    value === "REPLIED"
    ? value
    : "ALL";
}

function parseSortParam(value: string | null): LeadPipelineSort {
  return value === "score_desc" || value === "updated_desc" || value === "company_name_asc"
    ? value
    : "approved_desc";
}

function parseScoreParam(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : undefined;
}

function parseShipmentCountParam(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
}
