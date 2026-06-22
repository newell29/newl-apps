import type { SearchProfileSuggestionOption } from "@/modules/lead-gen/search-profile-suggestions";
import { readFileSync } from "node:fs";
import path from "node:path";

type CanonicalTradeMiningReference = {
  metadata: {
    source: string;
    generatedAt: string;
  };
  countries: SearchProfileSuggestionOption[];
  ports: SearchProfileSuggestionOption[];
  locations: SearchProfileSuggestionOption[];
};

let cachedReference: CanonicalTradeMiningReference | null = null;

export function getCanonicalTradeMiningReference() {
  if (cachedReference) {
    return cachedReference;
  }

  const filePath = path.join(process.cwd(), "src", "data", "canonical-trademining-reference.json");
  const contents = readFileSync(filePath, "utf8");
  cachedReference = JSON.parse(contents) as CanonicalTradeMiningReference;
  return cachedReference;
}
