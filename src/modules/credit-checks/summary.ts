import type { WebsiteInboundFieldValue } from "@/modules/website-inbound/types";

export type CreditCheckFieldRecord = Record<string, WebsiteInboundFieldValue>;

function asText(value: WebsiteInboundFieldValue | undefined) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean).join(", ");
  }

  return value?.trim();
}

function findField(fields: CreditCheckFieldRecord, candidates: readonly string[]) {
  const entries = Object.entries(fields);

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const found = entries.find(([key]) => normalize(key) === normalizedCandidate);

    if (found) {
      return asText(found[1]) || undefined;
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const found = entries.find(([key]) => normalize(key).includes(normalizedCandidate));

    if (found) {
      return asText(found[1]) || undefined;
    }
  }

  return undefined;
}

function collectFields(fields: CreditCheckFieldRecord, candidates: readonly string[]) {
  const normalizedCandidates = candidates.map(normalize);
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => {
      const normalizedKey = normalize(key);
      return Boolean(asText(value)) && normalizedCandidates.some((candidate) => normalizedKey.includes(candidate));
    })
  );
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function summarizeCreditCheckFields(fields: CreditCheckFieldRecord) {
  const legalCompanyName = findField(fields, ["legalCompanyName", "legal company name", "company"]);
  const operatingName = findField(fields, ["operatingName", "operating name", "dba"]);

  return {
    legalCompanyName,
    operatingName,
    company: legalCompanyName ?? operatingName,
    mainPhone: findField(fields, ["mainPhone", "main phone", "company phone", "phone"]),
    primaryContactName: findField(fields, ["primaryContactName", "primary contact name", "contact name", "name"]),
    primaryContactEmail: findField(fields, ["primaryContactEmail", "primary contact email", "email"]),
    accountsPayableEmail: findField(fields, ["accountsPayableEmail", "accounts payable email", "invoice email"]),
    requestedCreditLimit: findField(fields, ["requestedCreditLimit", "requested credit limit", "credit limit"]),
    services: valueToJsonValue(findField(fields, ["services", "service need", "service"])),
    tradeReferences: collectFields(fields, ["reference", "tradeReference", "bank"])
  };
}

function valueToJsonValue(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
