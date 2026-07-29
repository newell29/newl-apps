import { normalizeHunterCompanyIdentity } from "@/modules/lead-gen/hunter-company-key";

export type HunterCompanyIdentityInput = {
  id: string;
  name: string;
  normalizedName: string;
  domain?: string | null;
  apolloOrganizationId?: string | null;
};

export type HunterCompanyNameCandidate = HunterCompanyIdentityInput;

export function resolveHunterCompanyIdentityKey(
  company: Omit<HunterCompanyIdentityInput, "id">
) {
  const apolloOrganizationId = company.apolloOrganizationId?.trim();
  if (apolloOrganizationId) return `apollo:${apolloOrganizationId}`;

  const domain = normalizeHunterCompanyDomain(company.domain);
  if (domain) return `domain:${domain}`;

  const identity =
    normalizeHunterCompanyIdentity(company.name) ||
    normalizeHunterCompanyIdentity(company.normalizedName);
  return `name:${identity || company.normalizedName}`;
}

export function dedupeHunterCompaniesByIdentity<T extends HunterCompanyIdentityInput>(
  companies: T[]
) {
  const seen = new Set<string>();
  return companies.filter((company) => {
    const identityKey = resolveHunterCompanyIdentityKey(company);
    if (seen.has(identityKey)) return false;
    seen.add(identityKey);
    return true;
  });
}

export function resolveExistingHunterCompanyByName<
  T extends HunterCompanyNameCandidate
>(
  incoming: {
    name: string;
    normalizedName: string;
  },
  companies: T[]
) {
  const exact = companies.find(
    (company) => company.normalizedName === incoming.normalizedName
  );
  if (exact) {
    return {
      company: exact,
      matchType: "EXACT_NORMALIZED_NAME" as const
    };
  }

  const identity =
    normalizeHunterCompanyIdentity(incoming.name) ||
    normalizeHunterCompanyIdentity(incoming.normalizedName);
  if (!isSafeAutomaticCompanyNameIdentity(identity)) return null;

  const aliases = companies.filter((company) => {
    const candidateIdentity =
      normalizeHunterCompanyIdentity(company.name) ||
      normalizeHunterCompanyIdentity(company.normalizedName);
    return candidateIdentity === identity;
  });
  if (aliases.length !== 1) return null;

  return {
    company: aliases[0],
    matchType: "UNIQUE_LEGAL_NAME_ALIAS" as const
  };
}

export function isSafeAutomaticCompanyNameIdentity(value: string) {
  if (!value) return false;
  const tokens = value.split("-").filter(Boolean);
  return tokens.length >= 2 || value.length >= 6;
}

export function normalizeHunterCompanyDomain(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(
      value.includes("://") ? value : `https://${value}`
    );
    return url.hostname.toLowerCase().replace(/^www\./u, "") || null;
  } catch {
    return value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//u, "")
      .replace(/^www\./u, "")
      .split("/")[0] || null;
  }
}
