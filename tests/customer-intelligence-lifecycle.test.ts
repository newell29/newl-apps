import { CustomerLifecycle } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  computeRelationshipLifecycle,
  isWithinTrailingMonths,
  rollupCompanyLifecycle,
  type RelationshipActivityInput
} from "@/modules/customer-intelligence/lifecycle";

const ACTIVE = CustomerLifecycle.ACTIVE_CUSTOMER;
const DORMANT = CustomerLifecycle.DORMANT_CUSTOMER;
const FORMER = CustomerLifecycle.FORMER_CUSTOMER;
const PROSPECT = CustomerLifecycle.PROSPECT;

function lifecycle(input: Partial<RelationshipActivityInput> = {}): CustomerLifecycle {
  return computeRelationshipLifecycle({
    hasApprovedMapping: false,
    hasRevenueOrOpenArInLast12Months: false,
    allSourceAccountsInactive: false,
    ...input
  });
}

describe("computeRelationshipLifecycle", () => {
  it("classifies a relationship with no approved QuickBooks mapping as PROSPECT", () => {
    expect(lifecycle({ hasApprovedMapping: false })).toBe(PROSPECT);
  });

  it("classifies recognized revenue or open AR in the trailing 12 months as ACTIVE_CUSTOMER", () => {
    expect(
      lifecycle({ hasApprovedMapping: true, hasRevenueOrOpenArInLast12Months: true })
    ).toBe(ACTIVE);
  });

  it("classifies a linked account with no recent activity as DORMANT_CUSTOMER", () => {
    expect(lifecycle({ hasApprovedMapping: true, allSourceAccountsInactive: false })).toBe(DORMANT);
  });

  it("classifies all-inactive accounts with no open AR as FORMER_CUSTOMER", () => {
    expect(
      lifecycle({ hasApprovedMapping: true, allSourceAccountsInactive: true })
    ).toBe(FORMER);
  });

  it("keeps PROSPECT even when accounts are inactive (no approved mapping)", () => {
    expect(lifecycle({ hasApprovedMapping: false, allSourceAccountsInactive: true })).toBe(PROSPECT);
  });
});

describe("rollupCompanyLifecycle", () => {
  it("rolls up to ACTIVE when any relationship is active", () => {
    expect(rollupCompanyLifecycle([DORMANT, ACTIVE, FORMER])).toBe(ACTIVE);
  });

  it("rolls up to DORMANT when no relationship is active but one is dormant", () => {
    expect(rollupCompanyLifecycle([FORMER, DORMANT])).toBe(DORMANT);
  });

  it("rolls up to FORMER when every relationship is former", () => {
    expect(rollupCompanyLifecycle([FORMER, FORMER])).toBe(FORMER);
  });

  it("rolls up to PROSPECT when every relationship is a prospect or none exist", () => {
    expect(rollupCompanyLifecycle([])).toBe(PROSPECT);
    expect(rollupCompanyLifecycle([PROSPECT, PROSPECT])).toBe(PROSPECT);
  });

  it("handles a single relationship", () => {
    expect(rollupCompanyLifecycle([ACTIVE])).toBe(ACTIVE);
  });
});

describe("isWithinTrailingMonths", () => {
  it("treats a date inside the trailing window as active", () => {
    const reference = new Date("2026-08-05T00:00:00.000Z");
    expect(isWithinTrailingMonths(new Date("2025-09-01T00:00:00.000Z"), reference, 12)).toBe(true);
  });

  it("treats a date outside the trailing window as inactive", () => {
    const reference = new Date("2026-08-05T00:00:00.000Z");
    expect(isWithinTrailingMonths(new Date("2025-07-01T00:00:00.000Z"), reference, 12)).toBe(false);
  });
});
