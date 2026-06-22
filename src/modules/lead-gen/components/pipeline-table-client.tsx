"use client";

import { CandidateStatus, LeadPipelineStage } from "@prisma/client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { StageBadge } from "@/components/stage-badge";

type PipelineLead = {
  id: string;
  companyId: string;
  companyName: string;
  normalizedName: string;
  contactName?: string | null;
  stage: LeadPipelineStage;
  candidateStatus: CandidateStatus;
  score: number;
  companyScore: number;
  assignedRepValue?: string | null;
  assignedRep: string;
  contactStatus: string;
  apolloStatus: string;
  sequenceStatus: string;
  sequenceReadiness: string;
  nextStep: string;
  notes?: string | null;
  approvedAt: Date;
  updatedAt: Date;
};

type RepOption = {
  value: string;
  label: string;
};

export function PipelineTableClient({
  leads,
  stageOptions,
  repOptions,
  bulkUpdateLeadStageAction,
  bulkQueueApolloEnrichmentAction,
  bulkAssignLeadOwnerAction,
  bulkUnassignLeadOwnerAction,
  updateLeadStageAction
}: {
  leads: PipelineLead[];
  stageOptions: LeadPipelineStage[];
  repOptions: RepOption[];
  bulkUpdateLeadStageAction: (formData: FormData) => Promise<void>;
  bulkQueueApolloEnrichmentAction: (formData: FormData) => Promise<void>;
  bulkAssignLeadOwnerAction: (formData: FormData) => Promise<void>;
  bulkUnassignLeadOwnerAction: (formData: FormData) => Promise<void>;
  updateLeadStageAction: (formData: FormData) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = leads.length > 0 && leads.every((lead) => selectedSet.has(lead.id));

  function toggleSelection(leadId: string) {
    setSelectedIds((current) => (current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]));
  }

  function toggleAllVisible() {
    setSelectedIds((current) => (current.length === leads.length ? [] : leads.map((lead) => lead.id)));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  return (
    <form action={bulkUpdateLeadStageAction}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={toggleAllVisible}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
          >
            {allVisibleSelected ? "Deselect all visible" : "Select all visible"}
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

        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.map((leadId) => (
            <input key={leadId} type="hidden" name="leadId" value={leadId} />
          ))}
          <select
            name="stage"
            defaultValue={LeadPipelineStage.RESEARCHING}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
          >
            {stageOptions.map((stageOption) => (
              <option key={stageOption} value={stageOption}>
                {formatStage(stageOption)}
              </option>
            ))}
          </select>
          <BulkActionButton disabled={selectedIds.length === 0}>Move selected</BulkActionButton>
          <button
            type="submit"
            name="stage"
            value={LeadPipelineStage.DISQUALIFIED}
            disabled={selectedIds.length === 0}
            className="rounded-md border border-danger/30 bg-card px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Disqualify selected
          </button>
          <button
            type="submit"
            formAction={bulkQueueApolloEnrichmentAction}
            disabled={selectedIds.length === 0}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
          >
            Queue Apollo
          </button>
          <select
            name="ownerUserId"
            defaultValue={repOptions[0]?.value ?? ""}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
          >
            {repOptions.length > 0 ? (
              repOptions.map((owner) => (
                <option key={owner.value} value={owner.value}>
                  {owner.label}
                </option>
              ))
            ) : (
              <option value="">No Apollo reps configured</option>
            )}
          </select>
          <button
            type="submit"
            formAction={bulkAssignLeadOwnerAction}
            disabled={selectedIds.length === 0 || repOptions.length === 0}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign selected
          </button>
          <button
            type="submit"
            formAction={bulkUnassignLeadOwnerAction}
            disabled={selectedIds.length === 0}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
          >
            Unassign selected
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1320px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label={allVisibleSelected ? "Deselect all visible accounts" : "Select all visible accounts"}
                />
              </th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Pipeline stage</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Candidate status</th>
              <th className="px-4 py-3">Assigned rep</th>
              <th className="px-4 py-3">Contact status</th>
              <th className="px-4 py-3">Apollo</th>
              <th className="px-4 py-3">Sequence</th>
              <th className="px-4 py-3">Last activity</th>
              <th className="px-4 py-3">Next step</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leads.map((lead) => (
              <tr key={lead.id} className="align-top transition-colors hover:bg-muted/60">
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(lead.id)}
                    onChange={() => toggleSelection(lead.id)}
                    aria-label={`Select ${lead.companyName}`}
                  />
                </td>
                <td className="max-w-[240px] px-4 py-4">
                  <p className="font-semibold text-foreground">{lead.companyName}</p>
                  <p className="mt-1 text-xs text-mutedForeground">{lead.normalizedName}</p>
                  {lead.notes ? <p className="mt-2 text-xs leading-5 text-mutedForeground">{lead.notes}</p> : null}
                </td>
                <td className="px-4 py-4">
                  <StageBadge stage={lead.stage} />
                </td>
                <td className="px-4 py-4">
                  <span className="text-lg font-bold text-primary">{lead.score}</span>
                  <p className="mt-1 text-xs text-mutedForeground">Company {lead.companyScore}</p>
                </td>
                <td className="px-4 py-4">
                  <CandidateStatusBadge status={lead.candidateStatus} />
                </td>
                <td className="px-4 py-4 text-mutedForeground">
                  <p className="font-medium text-foreground">{lead.assignedRep}</p>
                  <p className="mt-1 text-xs">
                    {lead.assignedRepValue ? "Assigned" : "Unassigned"}
                  </p>
                </td>
                <td className="max-w-[180px] px-4 py-4 text-mutedForeground">
                  <p className="font-medium text-foreground">{lead.contactStatus}</p>
                  <p className="mt-1 text-xs">{lead.contactName ?? "No primary contact"}</p>
                </td>
                <td className="px-4 py-4 text-mutedForeground">{lead.apolloStatus}</td>
                <td className="max-w-[220px] px-4 py-4 text-mutedForeground">
                  <p>{lead.sequenceStatus}</p>
                  <p className="mt-1 text-xs">{lead.sequenceReadiness}</p>
                </td>
                <td className="px-4 py-4 text-mutedForeground">
                  <p>{formatDate(lead.updatedAt)}</p>
                  <p className="mt-1 text-xs">Approved {formatDate(lead.approvedAt)}</p>
                </td>
                <td className="max-w-[200px] px-4 py-4 font-medium text-foreground">{lead.nextStep}</td>
                <td className="px-4 py-4">
                  <div className="flex min-w-[260px] flex-wrap gap-2">
                    <form action={updateLeadStageAction} className="flex gap-2">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <select
                        name="stage"
                        defaultValue={lead.stage}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                      >
                        {stageOptions.map((stageOption) => (
                          <option key={stageOption} value={stageOption}>
                            {formatStage(stageOption)}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                        Move
                      </button>
                    </form>
                    <form action={updateLeadStageAction}>
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="stage" value={LeadPipelineStage.DISQUALIFIED} />
                      <button className="rounded-md border border-danger/30 bg-card px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10">
                        Disqualify
                      </button>
                    </form>
                    <Link
                      href="/lead-gen/contacts"
                      className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
                    >
                      View contacts
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

function BulkActionButton({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const className =
    status === CandidateStatus.APPROVED_FOR_PIPELINE
      ? "border-success/30 bg-success/10 text-success"
      : status === CandidateStatus.DISQUALIFIED
        ? "border-danger/30 bg-danger/10 text-danger"
        : "border-accentBorder bg-accentSoft text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function formatStage(stage: LeadPipelineStage) {
  return stage
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}
