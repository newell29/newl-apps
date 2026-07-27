import type { ApolloRepMappingEntry } from "@/modules/settings/types";

export function selectApolloMailboxForCompany({
  entries,
  owner,
  companyId
}: {
  entries: ApolloRepMappingEntry[];
  owner: { email: string | null; name: string | null };
  companyId: string;
}) {
  const ownerEmail = owner.email?.trim().toLowerCase() ?? null;
  const ownerName = owner.name?.trim().toLowerCase() ?? null;
  const candidates = entries
    .filter(
      (entry) =>
        entry.active &&
        entry.routingWeight > 0 &&
        Boolean(entry.apolloUserId) &&
        ((ownerEmail && entry.sendFromEmail?.trim().toLowerCase() === ownerEmail) ||
          (ownerName && entry.sequenceOwnerName.trim().toLowerCase() === ownerName))
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const totalWeight = candidates.reduce((total, entry) => total + entry.routingWeight, 0);
  if (totalWeight <= 0) return null;
  let bucket = stableHash(companyId) % totalWeight;
  for (const candidate of candidates) {
    if (bucket < candidate.routingWeight) return candidate;
    bucket -= candidate.routingWeight;
  }
  return candidates[candidates.length - 1] ?? null;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
