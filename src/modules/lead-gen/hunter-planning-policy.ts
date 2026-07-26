import { HunterServiceLine } from "@prisma/client";

export const DEFAULT_HUNTER_ALLOCATION = {
  [HunterServiceLine.WAREHOUSING]: 60,
  [HunterServiceLine.OCEAN_AIR]: 30,
  [HunterServiceLine.TRUCKING]: 10
} as const;

export type HunterPlanningCandidate = {
  companyKey: string;
  priorityScore: number;
  confidence: number;
  serviceLine: HunterServiceLine;
};

export function validateHunterAllocation(allocation: Record<HunterServiceLine, number>) {
  const values = Object.values(allocation);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 100)) {
    throw new Error("Hunter service allocations must be whole percentages between 0 and 100.");
  }
  if (values.reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error("Hunter service allocations must total exactly 100%.");
  }
}

export function allocateHunterServiceCounts(
  limit: number,
  allocation: Record<HunterServiceLine, number>
) {
  validateHunterAllocation(allocation);
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = Object.values(HunterServiceLine).map((serviceLine) => {
    const exact = (safeLimit * allocation[serviceLine]) / 100;
    return { serviceLine, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = safeLimit - rows.reduce((sum, row) => sum + row.count, 0);
  for (const row of rows.sort((left, right) => right.remainder - left.remainder)) {
    if (remaining <= 0) break;
    row.count += 1;
    remaining -= 1;
  }
  return Object.fromEntries(rows.map((row) => [row.serviceLine, row.count])) as Record<HunterServiceLine, number>;
}

export function selectHunterPlanningCandidates<T extends HunterPlanningCandidate>(
  candidates: T[],
  limit: number,
  allocation: Record<HunterServiceLine, number>
) {
  const counts = allocateHunterServiceCounts(limit, allocation);
  const sorted = candidates
    .slice()
    .sort((left, right) =>
      right.priorityScore - left.priorityScore ||
      right.confidence - left.confidence ||
      left.companyKey.localeCompare(right.companyKey)
    );
  const selected: T[] = [];
  const selectedKeys = new Set<string>();

  for (const serviceLine of Object.values(HunterServiceLine)) {
    for (const candidate of sorted.filter((row) => row.serviceLine === serviceLine).slice(0, counts[serviceLine])) {
      selected.push(candidate);
      selectedKeys.add(candidate.companyKey);
    }
  }

  for (const candidate of sorted) {
    if (selected.length >= Math.max(1, limit)) break;
    if (!selectedKeys.has(candidate.companyKey)) {
      selected.push(candidate);
      selectedKeys.add(candidate.companyKey);
    }
  }

  return selected.sort((left, right) =>
    right.priorityScore - left.priorityScore ||
    right.confidence - left.confidence ||
    left.companyKey.localeCompare(right.companyKey)
  );
}
