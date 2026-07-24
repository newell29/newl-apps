import { describe, expect, it } from "vitest";
import {
  paginateCandidates,
  parseCandidatePage,
  parseCandidatePageSize
} from "@/modules/lead-gen/candidate-pagination";

describe("Found Companies pagination", () => {
  it("uses 25 rows by default and accepts only the supported sizes", () => {
    expect(parseCandidatePageSize(undefined)).toBe(25);
    expect(parseCandidatePageSize("50")).toBe(50);
    expect(parseCandidatePageSize("75")).toBe(75);
    expect(parseCandidatePageSize("100")).toBe(100);
    expect(parseCandidatePageSize("500")).toBe(25);
  });

  it("returns only the selected page and reports the full result count", () => {
    const result = paginateCandidates(
      Array.from({ length: 184 }, (_, index) => index + 1),
      3,
      25
    );

    expect(result).toMatchObject({
      page: 3,
      pageSize: 25,
      totalItems: 184,
      totalPages: 8,
      firstItem: 51,
      lastItem: 75
    });
    expect(result.items).toEqual(Array.from({ length: 25 }, (_, index) => index + 51));
  });

  it("clamps invalid or out-of-range pages", () => {
    expect(parseCandidatePage("0")).toBe(1);
    expect(parseCandidatePage("anything")).toBe(1);
    expect(paginateCandidates([1, 2, 3], 99, 25)).toMatchObject({
      page: 1,
      firstItem: 1,
      lastItem: 3
    });
  });
});
