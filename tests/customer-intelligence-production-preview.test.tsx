import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getAuthenticatedContext: vi.fn(),
  getOperatingCompany: vi.fn(),
  runCustomerIntelligenceDryRun: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: mocks.getAuthenticatedContext
}));

vi.mock("@/modules/customer-intelligence/queries", () => ({
  getOperatingCompany: mocks.getOperatingCompany
}));

vi.mock("@/modules/customer-intelligence/dry-run", () => ({
  runCustomerIntelligenceDryRun: mocks.runCustomerIntelligenceDryRun
}));

import {
  CustomerIntelligenceDryRunPreviewControl,
  PreviewReport
} from "@/modules/customer-intelligence/components/dry-run-preview-control";
import { runCustomerIntelligenceDryRunPreviewAction } from "@/modules/customer-intelligence/dry-run-preview-actions";
import {
  CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_CONFIRMATION,
  EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE
} from "@/modules/customer-intelligence/dry-run-preview-state";

const ADMIN_CONTEXT = {
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "User",
  role: "ADMIN",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  tenantName: "Tenant A"
};

function previewForm(input: { operatingCompanyId?: string; confirmed?: boolean } = {}) {
  const formData = new FormData();
  if (input.operatingCompanyId !== undefined) {
    formData.set("operatingCompanyId", input.operatingCompanyId);
  }
  if (input.confirmed) {
    formData.set("confirmation", CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_CONFIRMATION);
  }
  return formData;
}

function safeDryRunReport() {
  return {
    tenantId: "tenant-a",
    dryRun: true,
    startedAt: "2026-08-08T12:00:00.000Z",
    completedAt: "2026-08-08T12:01:00.000Z",
    scope: { operatingCompanyId: "oc-usa", operatingCompanyCount: 1 },
    runRecord: {
      jobRunId: "job-safe-1",
      jobType: "customer-intelligence.dry-run",
      status: "SUCCESS"
    },
    ingestion: {
      tenantId: "tenant-a",
      dryRun: true,
      startedAt: "2026-08-08T12:00:00.000Z",
      completedAt: "2026-08-08T12:00:20.000Z",
      operatingCompanies: [
        {
          operatingCompanyId: "oc-usa",
          slug: "newl-usa",
          displayName: "Newl USA",
          status: "ASSOCIATED",
          fetchedCustomers: 12,
          matched: 3,
          unmatchedProposed: 4,
          unmatchedRefreshed: 1,
          unmatchedUnchanged: 0,
          reviewedDecisionsPreserved: 2,
          skipped: 2,
          recordErrors: 0,
          warnings: ["provider-private-warning-must-not-cross-ui"]
        }
      ],
      totals: {
        fetchedCustomers: 12,
        matched: 3,
        unmatchedProposed: 4,
        unmatchedRefreshed: 1,
        unmatchedUnchanged: 0,
        reviewedDecisionsPreserved: 2,
        skipped: 2,
        recordErrors: 0,
        unassociatedCompanies: 0,
        notEnabledCompanies: 0,
        erroredCompanies: 0
      }
    },
    reconciliation: {
      tenantId: "tenant-a",
      dryRun: true,
      startedAt: "2026-08-08T12:00:20.000Z",
      completedAt: "2026-08-08T12:00:30.000Z",
      matches: [
        {
          sourceRecordKey: "private-source-key-must-not-cross-ui",
          bestCandidateCompanyId: "private-company-id-must-not-cross-ui"
        }
      ],
      totals: {
        evaluated: 5,
        autoLinked: 1,
        routedToReview: 4,
        reviewedPreserved: 2,
        errors: 0,
        errorClassifications: {}
      }
    },
    materialization: {
      tenantId: "tenant-a",
      dryRun: true,
      cadConsolidation: "Directional management reporting",
      startedAt: "2026-08-08T12:00:30.000Z",
      completedAt: "2026-08-08T12:01:00.000Z",
      operatingCompanies: [
        {
          operatingCompanyId: "oc-usa",
          slug: "newl-usa",
          displayName: "Newl USA",
          status: "ASSOCIATED",
          reason: "provider-private-reason-must-not-cross-ui"
        }
      ],
      totals: {
        fetchedRevenueRows: 20,
        fetchedAgingRows: 6,
        revenueMaterialized: 8,
        revenuePreserved: 0,
        revenueSkippedMissingIdentity: 0,
        revenueSkippedUnmatched: 2,
        revenueSkippedMissingRequired: 0,
        revenueSkippedInvalidAmount: 0,
        revenueSkippedMissingFx: 0,
        reportRowsSkippedOutsideWindow: 0,
        costRowsPaired: 0,
        costRowsAmbiguous: 0,
        agingMaterialized: 3,
        agingSkippedUnmatched: 0,
        agingSkippedMissingEvidence: 0,
        monthlyRowsWritten: 2,
        relationshipsRefreshed: 0,
        fxRatesApplied: 0,
        fxRatesMissing: 0,
        recordErrors: 0,
        incompleteMonths: 0,
        unassociatedCompanies: 0,
        notEnabledCompanies: 0,
        erroredCompanies: 0,
        limitationCompanies: 0
      }
    },
    zeroWrites: {
      provenByContract: true,
      wouldChangeRecords: 20
    }
  };
}

describe("Customer Intelligence production preview action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedContext.mockResolvedValue(ADMIN_CONTEXT);
    mocks.getOperatingCompany.mockResolvedValue({
      id: "oc-usa",
      slug: "newl-usa",
      displayName: "Newl USA",
      active: true
    });
    mocks.runCustomerIntelligenceDryRun.mockResolvedValue(safeDryRunReport());
  });

  it("requires one operating company and exact explicit confirmation", async () => {
    const missingCompany = await runCustomerIntelligenceDryRunPreviewAction(
      EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE,
      previewForm({ confirmed: true })
    );
    const missingConfirmation = await runCustomerIntelligenceDryRunPreviewAction(
      EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE,
      previewForm({ operatingCompanyId: "oc-usa" })
    );

    expect(missingCompany.status).toBe("error");
    expect(missingConfirmation.status).toBe("error");
    expect(mocks.getAuthenticatedContext).not.toHaveBeenCalled();
    expect(mocks.runCustomerIntelligenceDryRun).not.toHaveBeenCalled();
  });

  it("scopes the consolidated dry run to the selected tenant-owned active company", async () => {
    const state = await runCustomerIntelligenceDryRunPreviewAction(
      EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE,
      previewForm({ operatingCompanyId: "oc-usa", confirmed: true })
    );

    expect(mocks.getOperatingCompany).toHaveBeenCalledWith(ADMIN_CONTEXT, "oc-usa");
    expect(mocks.runCustomerIntelligenceDryRun).toHaveBeenCalledWith(ADMIN_CONTEXT, {
      operatingCompanyId: "oc-usa"
    });
    expect(state.status).toBe("success");
    expect(state.report).toMatchObject({
      operatingCompanyName: "Newl USA",
      runRecordId: "job-safe-1",
      zeroCustomerDataWrites: true,
      wouldChangeRecords: 20,
      ingestion: { fetchedCustomers: 12, status: "ASSOCIATED" },
      reconciliation: { evaluated: 5, routedToReview: 4 },
      materialization: { fetchedRevenueRows: 20, status: "ASSOCIATED" }
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/customer-intelligence/review");
  });

  it("returns only sanitized counts and classifications", async () => {
    const state = await runCustomerIntelligenceDryRunPreviewAction(
      EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE,
      previewForm({ operatingCompanyId: "oc-usa", confirmed: true })
    );
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain("provider-private");
    expect(serialized).not.toContain("private-source-key");
    expect(serialized).not.toContain("private-company-id");
    expect(serialized).not.toContain("tenant-a");
    expect(serialized).not.toContain("cadConsolidation");
  });

  it("warns and displays only bounded count diagnostics when reconciliation is blocked", async () => {
    const report = safeDryRunReport();
    report.reconciliation.totals.errors = 5;
    report.reconciliation.totals.routedToReview = 0;
    report.reconciliation.totals.errorClassifications = {
      CANONICAL_COMPANY_READ_FAILED: 5
    };
    report.materialization.operatingCompanies[0].status = "LIMITATION";
    mocks.runCustomerIntelligenceDryRun.mockResolvedValue(report);

    const state = await runCustomerIntelligenceDryRunPreviewAction(
      EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE,
      previewForm({ operatingCompanyId: "oc-usa", confirmed: true })
    );
    const html = renderToStaticMarkup(<PreviewReport report={state.report!} />);

    expect(state.status).toBe("warning");
    expect(state.message).toContain("Live sync remains disabled");
    expect(state.report?.reconciliation.errorClassifications).toEqual([
      { code: "CANONICAL_COMPANY_READ_FAILED", count: 5 }
    ]);
    expect(JSON.stringify(state)).not.toContain("provider-private");
    expect(html).toContain("Canonical-company candidates unavailable");
    expect(html).not.toContain("provider-private");
  });

  it("rejects inactive companies before any QuickBooks call", async () => {
    mocks.getOperatingCompany.mockResolvedValue({
      id: "oc-usa",
      slug: "newl-usa",
      displayName: "Newl USA",
      active: false
    });

    const state = await runCustomerIntelligenceDryRunPreviewAction(
      EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE,
      previewForm({ operatingCompanyId: "oc-usa", confirmed: true })
    );

    expect(state.status).toBe("error");
    expect(mocks.runCustomerIntelligenceDryRun).not.toHaveBeenCalled();
  });

  it("fails closed without exposing provider error text", async () => {
    mocks.runCustomerIntelligenceDryRun.mockRejectedValue(
      new Error("Authorization: Bearer private-token provider payload")
    );

    const state = await runCustomerIntelligenceDryRunPreviewAction(
      EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE,
      previewForm({ operatingCompanyId: "oc-usa", confirmed: true })
    );

    expect(state.status).toBe("error");
    expect(state.message).not.toContain("private-token");
    expect(state.report).toBeUndefined();
  });
});

describe("Customer Intelligence production preview control", () => {
  it("defaults to Newl USA and requires a read-only confirmation", () => {
    const html = renderToStaticMarkup(
      <CustomerIntelligenceDryRunPreviewControl
        operatingCompanies={[
          { id: "oc-worldwide", slug: "newl-worldwide", displayName: "Newl Worldwide" },
          { id: "oc-usa", slug: "newl-usa", displayName: "Newl USA" }
        ]}
      />
    );

    expect(html).toContain('name="operatingCompanyId"');
    expect(html).toContain('<option value="oc-usa" selected="">Newl USA</option>');
    expect(html).toContain('name="confirmation"');
    expect(html).toContain('value="RUN_READ_ONLY_PREVIEW"');
    expect(html).toContain("must not enable live sync");
  });
});
