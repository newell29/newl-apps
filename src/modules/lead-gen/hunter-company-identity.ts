import { normalizeHunterCompanyIdentity } from "@/modules/lead-gen/hunter-company-key";

export type HunterCompanyIdentityInput = {
  id: string;
  name: string;
  normalizedName: string;
  domain?: string | null;
};

export function resolveHunterCompanyIdentityKey(
  company: Omit<HunterCompanyIdentityInput, "id">
) {
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
