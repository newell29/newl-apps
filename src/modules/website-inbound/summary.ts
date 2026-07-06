import type { WebsiteInboundFieldValue } from "@/modules/website-inbound/types";

function asText(value: WebsiteInboundFieldValue | undefined) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }

  return value?.trim();
}

function firstMatchingField(
  fields: Record<string, WebsiteInboundFieldValue>,
  candidates: readonly string[]
) {
  const entries = Object.entries(fields);

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    const found = entries.find(([key]) => key.toLowerCase() === normalizedCandidate);

    if (found) {
      return asText(found[1]);
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    const found = entries.find(([key]) => key.toLowerCase().includes(normalizedCandidate));

    if (found) {
      return asText(found[1]);
    }
  }

  return undefined;
}

export function summarizeWebsiteInboundFields(fields: Record<string, WebsiteInboundFieldValue>) {
  return {
    name:
      firstMatchingField(fields, [
        "name",
        "primary contact name",
        "authorized name",
        "contact name"
      ]) || undefined,
    email:
      firstMatchingField(fields, [
        "email",
        "primary contact email",
        "accounts payable email",
        "invoice email"
      ]) || undefined,
    company:
      firstMatchingField(fields, [
        "company",
        "legal company name",
        "operating name",
        "operating name / dba"
      ]) || undefined,
    phone:
      firstMatchingField(fields, [
        "phone",
        "main phone",
        "primary contact phone",
        "accounts payable phone"
      ]) || undefined,
    primaryNeed:
      firstMatchingField(fields, [
        "primary need",
        "service need",
        "freight need",
        "industry",
        "service",
        "services"
      ]) || undefined
  };
}
