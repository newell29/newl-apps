import { CustomerLifecycle } from "@prisma/client";

import { LIFECYCLE_STRENGTH } from "@/modules/customer-intelligence/constants";

export type RelationshipActivityInput = {
  /** Whether the relationship has an approved QuickBooks customer mapping. */
  hasApprovedMapping: boolean;
  /** Recognized revenue or open AR observed within the trailing 12 months. */
  hasRevenueOrOpenArInLast12Months: boolean;
  /** Every linked source account for the relationship is inactive. */
  allSourceAccountsInactive: boolean;
};

/**
 * Deterministic lifecycle per operating-company relationship:
 *
 * - PROSPECT: no approved QuickBooks customer mapping.
 * - ACTIVE_CUSTOMER: recognized revenue or open AR within the trailing 12 months.
 * - DORMANT_CUSTOMER: linked QuickBooks account but no revenue/open AR in 12 months.
 * - FORMER_CUSTOMER: all linked source accounts inactive and no open AR.
 */
export function computeRelationshipLifecycle(input: RelationshipActivityInput): CustomerLifecycle {
  if (!input.hasApprovedMapping) {
    return CustomerLifecycle.PROSPECT;
  }
  if (input.hasRevenueOrOpenArInLast12Months) {
    return CustomerLifecycle.ACTIVE_CUSTOMER;
  }
  if (input.allSourceAccountsInactive) {
    return CustomerLifecycle.FORMER_CUSTOMER;
  }
  return CustomerLifecycle.DORMANT_CUSTOMER;
}

/**
 * Roll a canonical company's lifecycle up from its per-relationship lifecycles.
 * ACTIVE beats DORMANT beats FORMER beats PROSPECT, so a company remains
 * ACTIVE as long as any operating-company relationship is active.
 */
export function rollupCompanyLifecycle(lifecycles: CustomerLifecycle[]): CustomerLifecycle {
  if (lifecycles.length === 0) {
    return CustomerLifecycle.PROSPECT;
  }
  let strongest: CustomerLifecycle = CustomerLifecycle.PROSPECT;
  for (const lifecycle of lifecycles) {
    if (LIFECYCLE_STRENGTH[lifecycle] > LIFECYCLE_STRENGTH[strongest]) {
      strongest = lifecycle;
    }
  }
  return strongest;
}

/** True when the given date falls inside a trailing window from a reference date. */
export function isWithinTrailingMonths(
  observed: Date,
  referenceDate: Date,
  months: number
): boolean {
  const reference = new Date(referenceDate);
  reference.setMonth(reference.getMonth() - months);
  return observed >= reference;
}
