import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCandidateFeed, type CandidateFeedSort } from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);

    const url = new URL(request.url);
    const status = parseStatusParam(url.searchParams.get("status"));
    const sort = parseSortParam(url.searchParams.get("sort"));
    const searchProfileId = readNullable(url.searchParams.get("profile"));
    const industry = readNullable(url.searchParams.get("industry"));
    const minScore = parseScoreParam(url.searchParams.get("minScore"));
    const maxScore = parseScoreParam(url.searchParams.get("maxScore"));
    const minShipmentCount = parseShipmentCountParam(url.searchParams.get("minShipmentCount"));
    const query = readNullable(url.searchParams.get("q")) ?? undefined;

    const companies = await getCandidateFeed(context, {
      query,
      status,
      searchProfileId: searchProfileId ?? undefined,
      industry: industry ?? undefined,
      minScore,
      maxScore,
      minShipmentCount,
      sort
    });

    const csv = toCsv([
      [
        "Company",
        "Normalized Name",
        "Domain",
        "Status",
        "Score",
        "Matched Profile",
        "Industry",
        "Shipment Count",
        "Latest Shipment",
        "Destination",
        "Origin",
        "Product Description",
        "HS Code",
        "Assigned Rep",
        "Pipeline Stage",
        "Score Reasoning"
      ],
      ...companies.map((company) => [
        company.companyName,
        company.normalizedName,
        company.domain ?? "",
        company.candidateStatus,
        String(company.candidateScore),
        company.matchedSearchProfileName,
        company.primaryIndustry ?? "",
        String(company.shipmentCount),
        company.latestShipmentDate ? company.latestShipmentDate.toISOString() : "",
        company.destinationMarket ?? company.destinationPort ?? "",
        [company.originCountry, company.originPort, company.shipFromPort].filter(Boolean).join(" / "),
        company.productDescription ?? "",
        company.hsCode ?? "",
        company.assignedRep,
        company.currentPipelineStage ?? "",
        company.scoreReasoning
      ])
    ]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="found_companies_export.csv"'
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to export candidate feed."
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

function parseStatusParam(value: string | null) {
  if (!value || value === "ACTIVE") {
    return "ACTIVE";
  }

  return value === "NEW" ||
    value === "REVIEWING" ||
    value === "APPROVED_FOR_PIPELINE" ||
    value === "REJECTED" ||
    value === "DISQUALIFIED"
    ? value
    : "ACTIVE";
}

function parseSortParam(value: string | null): CandidateFeedSort {
  return value === "score_asc" ||
    value === "updated_desc" ||
    value === "shipment_count_desc" ||
    value === "latest_shipment_desc"
    ? value
    : "score_desc";
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
