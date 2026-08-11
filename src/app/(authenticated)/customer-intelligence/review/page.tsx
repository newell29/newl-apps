import { CustomerIdentityMatchKind, PlatformRole } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { CustomerIntelligenceDryRunPreviewControl } from "@/modules/customer-intelligence/components/dry-run-preview-control";
import { IdentityReconciliationControl } from "@/modules/customer-intelligence/components/identity-reconciliation-control";
import { IdentityReviewActions } from "@/modules/customer-intelligence/components/identity-review-actions";
import { requireMatchApproval, requireReadAccess } from "@/modules/customer-intelligence/permissions";
import {
  getIdentityReviewMetrics,
  getIdentityReviewQueue,
  listOperatingCompanies,
  listTenantCompanies
} from "@/modules/customer-intelligence/queries";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Customer Intelligence identity review queue (CP-PHASE-02B-3). Leadership-only
 * read (ADMIN/MANAGER/FINANCE); approve/reject/defer and reconciliation are
 * ADMIN/FINANCE and are enforced again inside every server action.
 */
export default async function CustomerIntelligenceReviewPage() {
  const context = await getAuthenticatedContext();
  await requireReadAccess(context);

  const [queue, companies, operatingCompanies, metrics] = await Promise.all([
    getIdentityReviewQueue(context),
    listTenantCompanies(context),
    listOperatingCompanies(context),
    getIdentityReviewMetrics(context)
  ]);

  let canApprove = false;
  try {
    await requireMatchApproval(context);
    canApprove = true;
  } catch {
    canApprove = false;
  }

  const canReconcile =
    context.role === PlatformRole.ADMIN || context.role === PlatformRole.FINANCE;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer Intelligence"
        title="Identity Review"
        description="Unmatched QuickBooks customers waiting for a canonical company. Deterministic suggestions never approve on name alone, and no new canonical company is created automatically (CP-02B-3-Q1)."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Awaiting review" value={metrics.proposed} />
        <Metric label="Approved" value={metrics.approved} />
        <Metric label="Rejected" value={metrics.rejected} />
      </div>

      {context.role === PlatformRole.ADMIN ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">
            QuickBooks production preview
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
            Inspect one connected operating company through the complete ingestion,
            reconciliation, and financial-materialization pipeline without enabling live sync or
            changing Customer Intelligence customer or financial records. The preview records one
            job-ledger entry and one sanitized audit entry for traceability.
          </p>
          <CustomerIntelligenceDryRunPreviewControl
            operatingCompanies={operatingCompanies
              .filter((company) => company.active)
              .map((company) => ({
                id: company.id,
                slug: company.slug,
                displayName: company.displayName
              }))}
          />
        </section>
      ) : null}

      {canReconcile ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Deterministic reconciliation</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
                Re-scores every PROPOSED QuickBooks customer against the tenant&apos;s canonical
                companies using only the approved identity rules (auto-link at 90+; exact name
                alone never links; free-mail excluded). Unique high-confidence targets
                auto-approve; ambiguity, low confidence, and missing targets stay here for review.
              </p>
            </div>
            <IdentityReconciliationControl />
          </div>
        </section>
      ) : null}

      {queue.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-sm text-mutedForeground">
          No QuickBooks customers are awaiting identity review.
        </p>
      ) : (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            Awaiting review ({queue.length})
          </h2>
          {queue.map((match) => (
            <article
              key={match.id}
              className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm"
            >
              <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_2fr]">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {match.sourceLabel ?? match.sourceRecordKey ?? "Unnamed QuickBooks customer"}
                  </h3>
                  <p className="mt-1 text-xs text-mutedForeground">
                    {match.operatingCompany?.displayName ?? "Unknown operating company"}
                    {match.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT ? " · QuickBooks" : ""}
                  </p>
                  <p className="mt-2 text-sm text-mutedForeground">
                    Score:{" "}
                    <span className="font-semibold text-foreground">{match.score}</span>
                  </p>
                </div>
                <div className="text-sm text-mutedForeground">
                  <p>
                    <span className="font-medium text-foreground">Suggested company:</span>{" "}
                    {match.candidateCompany ? match.candidateCompany.name : "None"}
                  </p>
                  {match.candidateCompany?.domain ? (
                    <p className="mt-1">
                      <span className="font-medium text-foreground">Domain:</span>{" "}
                      {match.candidateCompany.domain}
                    </p>
                  ) : null}
                  <p className="mt-1">
                    <span className="font-medium text-foreground">Source key:</span>{" "}
                    {match.sourceRecordKey ?? "—"}
                  </p>
                </div>
                <EvidencePanel match={match} />
              </div>

              <IdentityReviewActions
                matchId={match.id}
                sourceLabel={match.sourceLabel ?? match.sourceRecordKey ?? "this customer"}
                defaultCompanyId={match.candidateCompanyId}
                companies={companies}
                operatingCompanyId={match.operatingCompanyId}
                operatingCompanies={operatingCompanies.map((company) => ({
                  id: company.id,
                  displayName: company.displayName
                }))}
                canApprove={canApprove}
              />
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function EvidencePanel({ match }: { match: EvidenceMatch }) {
  const evidence = readEvidence(match.evidence);
  if (!evidence) {
    return (
      <div className="rounded-md bg-muted/60 p-3 text-sm text-mutedForeground">
        No source evidence was recorded for this customer.
      </div>
    );
  }
  return (
    <div className="rounded-md bg-muted/60 p-3 text-sm leading-6 text-mutedForeground">
      <span className="font-medium text-foreground">QuickBooks source evidence</span>
      <dl className="mt-1 space-y-1">
        {evidence.displayName ? (
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-xs">Name</dt>
            <dd className="text-xs">{evidence.displayName}</dd>
          </div>
        ) : null}
        {evidence.email ? (
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-xs">Email</dt>
            <dd className="text-xs">{evidence.email}</dd>
          </div>
        ) : null}
        {evidence.phone ? (
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-xs">Phone</dt>
            <dd className="text-xs">{evidence.phone}</dd>
          </div>
        ) : null}
        {evidence.currency ? (
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-xs">Currency</dt>
            <dd className="text-xs">{evidence.currency}</dd>
          </div>
        ) : null}
        {evidence.billingAddress ? (
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-xs">Address</dt>
            <dd className="text-xs">{formatAddress(evidence.billingAddress)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

type EvidenceMatch = {
  evidence: unknown;
};

type EvidenceRecord = {
  displayName?: string;
  email?: string;
  phone?: string;
  currency?: string;
  billingAddress?: unknown;
};

function readEvidence(value: unknown): EvidenceRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const stringField = (key: string): string | undefined => {
    const field = raw[key];
    return typeof field === "string" && field.trim() !== "" ? field : undefined;
  };
  return {
    displayName: stringField("displayName"),
    email: stringField("email"),
    phone: stringField("phone"),
    currency: stringField("currency"),
    billingAddress: raw.billingAddress
  };
}

function formatAddress(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "—";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map((entry) => entry[1].trim());
  return entries.length > 0 ? entries.join(", ") : "—";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-mutedForeground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
