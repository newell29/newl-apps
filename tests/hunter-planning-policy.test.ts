import {
  CandidateStatus,
  HunterServiceLine,
  ReplyStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildHunterPlanningCompanyWhere,
  isHunterCompanyBlocked
} from "@/modules/lead-gen/hunter-planner";
import {
  allocateHunterServiceCounts,
  selectHunterPlanningCandidates,
  validateHunterAllocation
} from "@/modules/lead-gen/hunter-planning-policy";

const allocation = {
  [HunterServiceLine.WAREHOUSING]: 60,
  [HunterServiceLine.OCEAN_AIR]: 30,
  [HunterServiceLine.TRUCKING]: 10
};

describe("Hunter planning policy", () => {
  it("allocates a 20-company plan as 12 warehousing, 6 ocean/air, and 2 trucking", () => {
    expect(allocateHunterServiceCounts(20, allocation)).toEqual({
      [HunterServiceLine.WAREHOUSING]: 12,
      [HunterServiceLine.OCEAN_AIR]: 6,
      [HunterServiceLine.TRUCKING]: 2
    });
  });

  it("backfills an undersupplied service bucket with the best remaining opportunities", () => {
    const candidates = [
      candidate("warehouse-1", HunterServiceLine.WAREHOUSING, 99),
      candidate("warehouse-2", HunterServiceLine.WAREHOUSING, 98),
      candidate("warehouse-3", HunterServiceLine.WAREHOUSING, 97),
      candidate("ocean-1", HunterServiceLine.OCEAN_AIR, 96)
    ];

    const selected = selectHunterPlanningCandidates(candidates, 4, allocation);

    expect(selected.map((row) => row.companyKey)).toEqual([
      "warehouse-1",
      "warehouse-2",
      "warehouse-3",
      "ocean-1"
    ]);
  });

  it("rejects allocations that do not total 100 percent", () => {
    expect(() =>
      validateHunterAllocation({
        [HunterServiceLine.WAREHOUSING]: 60,
        [HunterServiceLine.OCEAN_AIR]: 30,
        [HunterServiceLine.TRUCKING]: 20
      })
    ).toThrow("total exactly 100%");
  });

  it("ignores legacy lead and sequence history but blocks real engagement", () => {
    expect(buildHunterPlanningCompanyWhere("tenant-a")).not.toHaveProperty("leads");
    const base = {
      doNotProspect: false,
      candidateStatus: CandidateStatus.NEW,
      cashflowCustomers: [],
      contacts: []
    };

    expect(isHunterCompanyBlocked(base)).toBe(false);
    expect(
      isHunterCompanyBlocked({
        ...base,
        contacts: [
          {
            replyStatus: ReplyStatus.NO_REPLY
          }
        ]
      })
    ).toBe(false);
    expect(
      isHunterCompanyBlocked({
        ...base,
        contacts: [
          {
            replyStatus: ReplyStatus.POSITIVE
          }
        ]
      })
    ).toBe(true);
    expect(
      isHunterCompanyBlocked({
        ...base,
        contacts: [
          {
            replyStatus: ReplyStatus.NEGATIVE
          },
          {
            replyStatus: ReplyStatus.OUT_OF_OFFICE
          }
        ]
      })
    ).toBe(false);
  });
});

function candidate(companyKey: string, serviceLine: HunterServiceLine, priorityScore: number) {
  return {
    companyKey,
    serviceLine,
    priorityScore,
    confidence: priorityScore
  };
}
