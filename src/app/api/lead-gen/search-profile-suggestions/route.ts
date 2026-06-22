import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  filterSuggestionOptions,
  mergeSuggestionOptions,
  toTenantSuggestionOptions
} from "@/modules/lead-gen/search-profile-suggestions";
import { getTradeMiningSearchProfileSuggestions } from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getCanonicalTradeMiningReference } from "@/server/canonical-trademining-reference";
import { getAuthenticatedContext } from "@/server/tenant-context";

const ALLOWED_FIELDS = new Set([
  "destinationMarkets",
  "destinationPorts",
  "originPorts",
  "shipFromPorts",
  "originCountries"
]);

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);

    const url = new URL(request.url);
    const field = url.searchParams.get("field");
    const query = (url.searchParams.get("q") ?? "").trim();

    if (!field || !ALLOWED_FIELDS.has(field)) {
      return NextResponse.json({ error: "Invalid suggestion field." }, { status: 400 });
    }

    if (query.length < 3) {
      return NextResponse.json({ suggestions: [] });
    }

    const canonical = getCanonicalTradeMiningReference();
    const tenantSuggestions = await getTradeMiningSearchProfileSuggestions(context);
    const source =
      field === "originCountries"
        ? mergeSuggestionOptions(canonical.countries, toTenantSuggestionOptions(tenantSuggestions.originCountries))
        : field === "destinationMarkets"
          ? mergeSuggestionOptions(canonical.locations, toTenantSuggestionOptions(tenantSuggestions.destinationMarkets))
          : field === "destinationPorts"
            ? mergeSuggestionOptions(canonical.ports, toTenantSuggestionOptions(tenantSuggestions.destinationPorts))
            : field === "originPorts"
              ? mergeSuggestionOptions(canonical.ports, toTenantSuggestionOptions(tenantSuggestions.originPorts))
              : mergeSuggestionOptions(canonical.ports, toTenantSuggestionOptions(tenantSuggestions.shipFromPorts));

    const suggestions = filterSuggestionOptions(source, query, 10);

    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load search profile suggestions."
      },
      { status: 500 }
    );
  }
}
