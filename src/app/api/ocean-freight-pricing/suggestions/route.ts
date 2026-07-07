import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  filterSuggestionOptions,
  mergeSuggestionOptions,
  toTenantSuggestionOptions
} from "@/modules/lead-gen/search-profile-suggestions";
import { NORTH_AMERICA_INLAND_PORT_SUGGESTIONS } from "@/modules/ocean-freight-pricing/inland-port-suggestions";
import { requireModule } from "@/server/auth/authorization";
import { getCanonicalTradeMiningReference } from "@/server/canonical-trademining-reference";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

const ALLOWED_FIELDS = new Set(["ports", "countries"]);

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);

    const url = new URL(request.url);
    const field = url.searchParams.get("field");
    const query = (url.searchParams.get("q") ?? "").trim();

    if (!field || !ALLOWED_FIELDS.has(field)) {
      return NextResponse.json({ error: "Invalid suggestion field." }, { status: 400 });
    }

    if (query.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    const canonical = getCanonicalTradeMiningReference();
    const tenantSuggestions = await getOceanTenantSuggestionValues(context.tenantId);
    const source =
      field === "countries"
        ? mergeSuggestionOptions(canonical.countries, toTenantSuggestionOptions(tenantSuggestions.countries))
        : mergeSuggestionOptions(
            canonical.ports,
            mergeSuggestionOptions(NORTH_AMERICA_INLAND_PORT_SUGGESTIONS, toTenantSuggestionOptions(tenantSuggestions.ports))
          );

    return NextResponse.json({
      suggestions: filterSuggestionOptions(source, query, 12)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load ocean freight suggestions."
      },
      { status: 500 }
    );
  }
}

async function getOceanTenantSuggestionValues(tenantId: string) {
  const [rates, agents, branches] = await Promise.all([
    prisma.oceanFreightRate.findMany({
      where: { tenantId },
      select: {
        originPort: true,
        destinationPort: true,
        originCountry: true,
        destinationCountry: true
      },
      take: 500
    }),
    prisma.oceanFreightAgent.findMany({
      where: { tenantId },
      select: {
        primaryCountry: true
      },
      take: 500
    }),
    prisma.oceanFreightAgentBranch.findMany({
      where: { tenantId },
      select: {
        country: true,
        port: true
      },
      take: 500
    })
  ]);

  return {
    ports: uniqueValues([
      ...rates.flatMap((rate) => [rate.originPort, rate.destinationPort]),
      ...branches.map((branch) => branch.port)
    ]),
    countries: uniqueValues([
      ...rates.flatMap((rate) => [rate.originCountry, rate.destinationCountry]),
      ...agents.map((agent) => agent.primaryCountry),
      ...branches.map((branch) => branch.country)
    ])
  };
}

function uniqueValues(values: Array<string | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}
