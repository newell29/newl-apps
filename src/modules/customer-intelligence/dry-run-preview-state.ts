/**
 * Sanitized server-action state for the Customer Intelligence production
 * preview. It deliberately contains counts and classifications only: no
 * customer names, source keys, transaction identifiers, amounts, credentials,
 * or provider response text may cross this UI boundary.
 */
export const CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_CONFIRMATION =
  "RUN_READ_ONLY_PREVIEW";

export type CustomerIntelligenceDryRunPreviewState = {
  status: "idle" | "success" | "warning" | "error";
  message?: string;
  report?: {
    operatingCompanyName: string;
    startedAt: string;
    completedAt: string;
    runRecordId: string;
    zeroCustomerDataWrites: true;
    wouldChangeRecords: number;
    ingestion: {
      status: string;
      fetchedCustomers: number;
      matched: number;
      unmatchedProposed: number;
      unmatchedRefreshed: number;
      reviewedDecisionsPreserved: number;
      skipped: number;
      recordErrors: number;
    };
    reconciliation: {
      evaluated: number;
      autoLinked: number;
      routedToReview: number;
      reviewedPreserved: number;
      errors: number;
      errorClassifications: Array<{ code: string; count: number }>;
    };
    materialization: {
      status: string;
      fetchedRevenueRows: number;
      fetchedAgingRows: number;
      revenueMaterialized: number;
      agingMaterialized: number;
      monthlyRowsWritten: number;
      incompleteMonths: number;
      recordErrors: number;
      limitationCompanies: number;
      erroredCompanies: number;
    };
  };
};

export const EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE: CustomerIntelligenceDryRunPreviewState =
  { status: "idle" };
