import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { getLeadPipeline, type LeadPipelineSort } from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);

    const url = new URL(request.url);
    const stage = parseStageParam(url.searchParams.get("stage"));
    const ownerUserId = parseOwnerParam(url.searchParams.get("rep"));
    const minScore = parseScoreParam(url.searchParams.get("minScore"));
    const maxScore = parseScoreParam(url.searchParams.get("maxScore"));
    const sort = parseSortParam(url.searchParams.get("sort"));

    const leads = await getLeadPipeline(context, {
      stage,
      ownerUserId,
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

function parseStageParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return (
    value === "NEW" ||
    value === "CONTACTED" ||
    value === "REPLIED" ||
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
