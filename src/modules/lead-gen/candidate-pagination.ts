export const CANDIDATE_PAGE_SIZES = [25, 50, 75, 100] as const;

export type CandidatePageSize = (typeof CANDIDATE_PAGE_SIZES)[number];

export function parseCandidatePageSize(value: string | undefined): CandidatePageSize {
  const parsed = Number(value);
  return CANDIDATE_PAGE_SIZES.includes(parsed as CandidatePageSize) ? (parsed as CandidatePageSize) : 25;
}

export function parseCandidatePage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function paginateCandidates<T>(items: T[], requestedPage: number, pageSize: CandidatePageSize) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    totalItems,
    totalPages,
    firstItem: totalItems === 0 ? 0 : startIndex + 1,
    lastItem: startIndex + pageItems.length
  };
}
