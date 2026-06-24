"use client";

import { CandidateStatus } from "@prisma/client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StageBadge } from "@/components/stage-badge";

type Candidate = {
  id: string;
  companyName: string;
  normalizedName: string;
  domain: string | null;
  source: string | null;
  candidateStatus: CandidateStatus;
  candidateStatusReason: string | null;
  candidateScore: number;
  scoreReasoning: string;
  importedScoreReasoning: string | null;
  shipmentCount: number;
  latestShipmentDate: Date | null;
  matchedSearchProfileId: string | null;
  matchedSearchProfileName: string;
  destinationMarket: string | null;
  destinationPort: string | null;
  originCountry: string | null;
  originPort: string | null;
  shipFromPort: string | null;
  productDescription: string | null;
  hsCode: string | null;
  assignedRep: string;
  currentPipelineStage: string | null;
};

export function CandidateReviewTableClient({
  companies,
  bulkUpdateAction
}: {
  companies: Candidate[];
  bulkUpdateAction: (formData: FormData) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedScoreIds, setExpandedScoreIds] = useState<string[]>([]);
  const [expandedProductIds, setExpandedProductIds] = useState<string[]>([]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const expandedScoreSet = useMemo(() => new Set(expandedScoreIds), [expandedScoreIds]);
  const expandedProductSet = useMemo(() => new Set(expandedProductIds), [expandedProductIds]);

  const selectableIds = companies.filter((company) => !company.currentPipelineStage).map((company) => company.id);

  function toggleSelection(companyId: string) {
    setSelectedIds((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId]
    );
  }

  function toggleScoreExpanded(companyId: string) {
    setExpandedScoreIds((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId]
    );
  }

  function toggleProductExpanded(companyId: string) {
    setExpandedProductIds((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId]
    );
  }

  function selectAllVisible() {
    setSelectedIds(selectableIds);
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function confirmBulkDisqualify() {
    if (selectedIds.length === 0) {
      return true;
    }

    return window.confirm(
      `Disqualify ${selectedIds.length} compan${selectedIds.length === 1 ? "y" : "ies"}? Disqualified companies will stay out of future TradeMining review pulls unless you manually change their status later.`
    );
  }

  return (
    <form action={bulkUpdateAction}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={selectAllVisible}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
          >
            Select all visible
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
          >
            Clear selection
          </button>
          <span className="text-xs text-mutedForeground">{selectedIds.length} selected</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <BulkStatusButton status={CandidateStatus.REVIEWING} disabled={selectedIds.length === 0}>
            Mark reviewing
          </BulkStatusButton>
          <BulkStatusButton status={CandidateStatus.APPROVED_FOR_PIPELINE} disabled={selectedIds.length === 0} primary>
            Approve selected
          </BulkStatusButton>
          <BulkStatusButton status={CandidateStatus.REJECTED} disabled={selectedIds.length === 0}>
            Reject selected
          </BulkStatusButton>
          <BulkStatusButton
            status={CandidateStatus.DISQUALIFIED}
            disabled={selectedIds.length === 0}
            onBeforeSubmit={confirmBulkDisqualify}
          >
            Disqualify selected
          </BulkStatusButton>
        </div>
      </div>

      {selectedIds.map((companyId) => (
        <input key={companyId} type="hidden" name="companyId" value={companyId} />
      ))}

      <div className="overflow-x-auto">
        <table className="min-w-[1320px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            <tr>
              <th className="w-12 px-4 py-3"></th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Matched profile</th>
              <th className="px-4 py-3">Shipments</th>
              <th className="px-4 py-3">Destination</th>
              <th className="px-4 py-3">Origin</th>
              <th className="px-4 py-3">Product / HS</th>
              <th className="px-4 py-3">Rep</th>
              <th className="px-4 py-3">Pipeline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {companies.map((company) => {
              const isSelected = selectedSet.has(company.id);
              const isScoreExpanded = expandedScoreSet.has(company.id);
              const isProductExpanded = expandedProductSet.has(company.id);
              const canSelect = !company.currentPipelineStage;
              const shortReason =
                company.scoreReasoning.length > 88 ? `${company.scoreReasoning.slice(0, 88).trimEnd()}...` : company.scoreReasoning;
              const productSummary = company.productDescription ?? "Unknown product";
              const hsSummary = company.hsCode ? `HS: ${company.hsCode}` : "HS: Unknown";
              const combinedProductText = `${productSummary} ${hsSummary}`;
              const showProductToggle = combinedProductText.length > 72;

              return (
                <tr key={company.id} className="align-top transition-colors hover:bg-muted/60">
                  <td className="px-4 py-4">
                    {canSelect ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(company.id)}
                        aria-label={`Select ${company.companyName}`}
                      />
                    ) : (
                      <span className="text-xs text-mutedForeground">-</span>
                    )}
                  </td>
                  <td className="max-w-[240px] px-4 py-4">
                    <p className="font-semibold text-foreground">{company.companyName}</p>
                    <p className="mt-1 text-xs text-mutedForeground">{company.normalizedName}</p>
                    <p className="mt-1 text-xs text-mutedForeground">{company.domain ?? company.source ?? "TradeMining"}</p>
                  </td>
                  <td className="w-[320px] px-4 py-4">
                    <span className="text-xl font-bold text-primary">{company.candidateScore}</span>
                    <p className="mt-2 max-w-[320px] text-xs leading-5 text-mutedForeground">
                      {isScoreExpanded ? company.scoreReasoning : shortReason}
                    </p>
                    {company.scoreReasoning.length > 88 ? (
                      <button
                        type="button"
                        onClick={() => toggleScoreExpanded(company.id)}
                        className="mt-2 text-xs font-semibold text-primary transition-colors hover:text-primaryHover"
                      >
                        {isScoreExpanded ? "Show less" : "Show more"}
                      </button>
                    ) : null}
                    {company.importedScoreReasoning ? (
                      <p className="mt-2 max-w-[320px] rounded-md border border-border bg-background px-2 py-1 text-xs text-mutedForeground">
                        Ingested note: {company.importedScoreReasoning}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    <CandidateStatusBadge status={company.candidateStatus} />
                    {company.candidateStatusReason ? (
                      <p className="mt-2 max-w-[170px] text-xs text-mutedForeground">{company.candidateStatusReason}</p>
                    ) : null}
                  </td>
                  <td className="max-w-[180px] px-4 py-4 text-mutedForeground">
                    <p className="font-medium text-foreground">{company.matchedSearchProfileName}</p>
                    <p className="text-xs">{company.matchedSearchProfileId ?? "No profile id"}</p>
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">
                    <p className="font-semibold text-foreground">{company.shipmentCount}</p>
                    <p className="text-xs">Latest {formatDate(company.latestShipmentDate)}</p>
                  </td>
                  <td className="max-w-[170px] px-4 py-4 text-mutedForeground">
                    {company.destinationMarket ?? company.destinationPort ?? "Unknown"}
                  </td>
                  <td className="max-w-[190px] px-4 py-4 text-mutedForeground">
                    {[company.originCountry, company.originPort, company.shipFromPort].filter(Boolean).join(" / ") || "Unknown"}
                  </td>
                  <td className="w-[250px] px-4 py-4 text-mutedForeground">
                    {isProductExpanded ? (
                      <>
                        <p>{productSummary}</p>
                        <p className="mt-1 break-all text-xs">{hsSummary}</p>
                      </>
                    ) : (
                      <>
                        <p className="line-clamp-2">{productSummary}</p>
                        <p className="mt-1 line-clamp-1 break-all text-xs">{hsSummary}</p>
                      </>
                    )}
                    {showProductToggle ? (
                      <button
                        type="button"
                        onClick={() => toggleProductExpanded(company.id)}
                        className="mt-2 text-xs font-semibold text-primary transition-colors hover:text-primaryHover"
                      >
                        {isProductExpanded ? "Show less" : "Show more"}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">{company.assignedRep}</td>
                  <td className="px-4 py-4">
                    {company.currentPipelineStage ? (
                      <div className="space-y-2">
                        <StageBadge stage={company.currentPipelineStage} />
                        <Link className="block text-xs font-semibold text-primary hover:text-primaryHover" href="/lead-gen/pipeline">
                          In Pipeline
                        </Link>
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-mutedForeground">Not approved</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}

function BulkStatusButton({
  status,
  disabled,
  primary,
  children,
  onBeforeSubmit
}: {
  status: CandidateStatus;
  disabled: boolean;
  primary?: boolean;
  children: React.ReactNode;
  onBeforeSubmit?: () => boolean;
}) {
  return (
    <button
      type="submit"
      name="status"
      value={status}
      onClick={(event) => {
        if (onBeforeSubmit && !onBeforeSubmit()) {
          event.preventDefault();
        }
      }}
      disabled={disabled}
      className={
        primary
          ? "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
          : "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}

function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const className =
    status === CandidateStatus.APPROVED_FOR_PIPELINE
      ? "border-success/30 bg-success/10 text-success"
      : status === CandidateStatus.REJECTED || status === CandidateStatus.DISQUALIFIED
        ? "border-danger/30 bg-danger/10 text-danger"
        : status === CandidateStatus.REVIEWING
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-accentBorder bg-accentSoft text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function formatDate(value: Date | null) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}
