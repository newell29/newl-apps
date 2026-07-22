"use client";

import {
  ApolloStatus,
  ContactSource,
  ContactOutreachDraftStatus,
  ContactStatus,
  ContactTier,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef
} from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { DataGridColumnMenu } from "@/components/data-grid-column-menu";
import { usePersistedTableState } from "@/components/use-persisted-table-state";
import type { ApolloPushJobSummary } from "@/modules/lead-gen/apollo-push-jobs";
import type { ContactSequenceStatusFilter } from "@/modules/lead-gen/queries";
import {
  EMPTY_CONTACT_BULK_ACTION_SUMMARY,
  type ContactBulkActionDetail,
  type ContactBulkActionSummary
} from "@/modules/lead-gen/contact-bulk-action-summary";
import type { SequenceCatalogItem } from "@/modules/lead-gen/sequence-catalog";

type ContactDirectoryRow = {
  id: string;
  companyId: string;
  companyName: string;
  companyNormalizedName: string;
  matchedSearchProfileId: string | null;
  matchedSearchProfileName: string | null;
  fullName: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  email: string | null;
  source: string;
  contactStatus: ContactStatus;
  contactScore: number;
  contactTier: ContactTier;
  contactScoreSummary: string;
  apolloStatus: ApolloStatus;
  sequenceStatus: SequenceStatus;
  apolloPushBlockedReason: string | null;
  apolloPushBlockedAt: string | null;
  effectiveSequenceStatus: ContactSequenceStatusFilter;
  replyStatus: ReplyStatus;
  recommendedSequenceName: string;
  selectedSequenceId: string;
  selectedSequenceName: string;
  sequenceRecommendationReason: string;
  sequenceOverrideReason: string | null;
  sequenceManuallyOverridden: boolean;
  requiresAiDraft: boolean;
  draftGenerationConfigured: boolean;
  draftGenerationDisabledReason: string | null;
  draft: {
    id: string;
    subject: string;
    body: string;
    personalizationNotes: string | null;
    status: ContactOutreachDraftStatus;
  } | null;
  draftStatus: string;
  lastTouchAt: Date | null;
  lastReplyAt: Date | null;
  assignedRepValue: string | null;
  assignedRep: string;
  apolloAssignmentBlockReason: string | null;
  updatedAt: Date;
};

export function ContactDirectoryTableClient({
  contacts,
  initialApolloPushJobs,
  sequenceOptions,
  bulkUpdateContactSequenceAction,
  bulkRemoveContactsAction,
  bulkPushContactsToApolloAction,
  syncSelectedApolloStatusesAction,
  updateContactSequenceAction,
  saveContactDraftAction,
  generateContactDraftAction
}: {
  contacts: ContactDirectoryRow[];
  initialApolloPushJobs: ApolloPushJobSummary[];
  sequenceOptions: readonly SequenceCatalogItem[];
  bulkUpdateContactSequenceAction: (
    previousState: ContactBulkActionSummary,
    formData: FormData
  ) => Promise<ContactBulkActionSummary>;
  bulkRemoveContactsAction: (
    previousState: ContactBulkActionSummary,
    formData: FormData
  ) => Promise<ContactBulkActionSummary>;
  bulkPushContactsToApolloAction: (
    previousState: ContactBulkActionSummary,
    formData: FormData
  ) => Promise<ContactBulkActionSummary>;
  syncSelectedApolloStatusesAction: (
    previousState: ContactBulkActionSummary,
    formData: FormData
  ) => Promise<ContactBulkActionSummary>;
  updateContactSequenceAction: (formData: FormData) => Promise<void>;
  saveContactDraftAction: (formData: FormData) => Promise<void>;
  generateContactDraftAction: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionState, runBulkSequenceAction, isBulkSequencePending] = useActionState(
    bulkUpdateContactSequenceAction,
    EMPTY_CONTACT_BULK_ACTION_SUMMARY
  );
  const [removeActionState, runBulkRemoveAction, isBulkRemovePending] = useActionState(
    bulkRemoveContactsAction,
    EMPTY_CONTACT_BULK_ACTION_SUMMARY
  );
  const [apolloPushState, runApolloPushAction, isApolloPushPending] = useActionState(
    bulkPushContactsToApolloAction,
    EMPTY_CONTACT_BULK_ACTION_SUMMARY
  );
  const [apolloSyncState, runApolloSyncAction, isApolloSyncPending] = useActionState(
    syncSelectedApolloStatusesAction,
    EMPTY_CONTACT_BULK_ACTION_SUMMARY
  );
  const [apolloPushJobs, setApolloPushJobs] = useState(initialApolloPushJobs);
  const [activeApolloPushJobId, setActiveApolloPushJobId] = useState<string | null>(
    initialApolloPushJobs.find((job) => job.status === "QUEUED" || job.status === "RUNNING")?.id ?? null
  );
  const startedApolloPushJobIdsRef = useRef<Set<string>>(new Set());
  const {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    columnSizing,
    setColumnSizing
  } = usePersistedTableState("newl-apps:lead-gen:contacts-grid");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggleSelection(contactId: string) {
    setSelectedIds((current) =>
      current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]
    );
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function getDraftButtonLabel(contact: ContactDirectoryRow, hasDraft: boolean) {
    if (contact.draftGenerationConfigured) {
      return hasDraft ? "Regenerate AI Draft" : "Generate AI Draft";
    }

    if (contact.draftGenerationDisabledReason === "LEAD_GEN_AI_DISABLED") {
      return "Enable lead-gen AI in Settings";
    }

    return "OpenAI key required";
  }

  function getDraftDisabledHelp(contact: ContactDirectoryRow) {
    if (contact.draftGenerationConfigured) {
      return null;
    }

    if (contact.draftGenerationDisabledReason === "LEAD_GEN_AI_DISABLED") {
      return (
        <p className="text-xs text-mutedForeground">
          Lead-gen AI is currently turned off. Enable it in{" "}
          <Link href="/settings#lead-generation-settings" className="font-medium text-primary hover:underline">
            Settings
          </Link>{" "}
          before generating Tier 1 drafts.
        </p>
      );
    }

    return (
      <p className="text-xs text-mutedForeground">
        OpenAI draft generation is not configured for this runtime yet. Add `OPENAI_API_KEY` to enable Tier 1 drafts.
      </p>
    );
  }

  const columns = useMemo<ColumnDef<ContactDirectoryRow>[]>(
    () => [
      {
        id: "select",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableHiding: false,
        size: 52,
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedSet.has(row.original.id)}
            onChange={() => toggleSelection(row.original.id)}
            aria-label={`Select ${row.original.fullName}`}
          />
        )
      },
      {
        accessorKey: "fullName",
        header: "Contact name",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="max-w-[220px]">
              <p className="font-semibold text-foreground">{contact.fullName}</p>
              <p className="mt-1 text-xs text-mutedForeground">
                {[contact.seniority, contact.department].filter(Boolean).join(" / ") || "Unclassified"}
              </p>
            </div>
          );
        }
      },
      {
        accessorKey: "title",
        header: "Title",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => <div className="max-w-[220px] text-mutedForeground">{row.original.title ?? "Unknown title"}</div>
      },
      {
        accessorKey: "companyName",
        header: "Company",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="max-w-[220px]">
              <Link
                href={`/lead-gen/pipeline?company=${contact.companyId}&companyName=${encodeURIComponent(contact.companyName)}`}
                className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                title={`Open ${contact.companyName} in Pipeline`}
              >
                {contact.companyName}
              </Link>
              <p className="mt-1 text-xs text-mutedForeground">{contact.companyNormalizedName}</p>
              {contact.matchedSearchProfileName ? (
                <div className="mt-2 inline-flex max-w-full items-center rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-[11px] font-semibold text-primary">
                  <span className="truncate">Profile: {contact.matchedSearchProfileName}</span>
                </div>
              ) : null}
            </div>
          );
        }
      },
      {
        accessorKey: "email",
        header: "Email",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => <div className="max-w-[220px] text-mutedForeground">{row.original.email ?? "No email yet"}</div>
      },
      {
        accessorKey: "contactStatus",
        header: "Contact status",
        filterFn: normalizedEqualsFilter,
        size: 150,
        cell: ({ row }) => <StatusBadge value={row.original.contactStatus} tone={contactStatusTone(row.original.contactStatus)} />
      },
      {
        accessorKey: "contactScore",
        header: "Score / tier",
        filterFn: minimumNumberFilter,
        size: 220,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div>
              <span className="text-lg font-bold text-primary">{contact.contactScore}</span>
              <p className="mt-1 text-xs font-medium text-mutedForeground">{formatEnum(contact.contactTier)}</p>
              <p className="mt-2 max-w-[220px] text-xs leading-5 text-mutedForeground">{contact.contactScoreSummary}</p>
            </div>
          );
        }
      },
      {
        accessorKey: "selectedSequenceName",
        header: "Selected sequence",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="max-w-[220px]">
              <p className="font-medium text-foreground">{contact.selectedSequenceName}</p>
              <p className="mt-1 text-xs text-mutedForeground">
                {contact.sequenceManuallyOverridden ? "Manual override" : "Auto-selected"}
              </p>
              {contact.apolloPushBlockedReason ? (
                <div className="mt-2 rounded-md border border-danger/20 bg-danger/5 px-2.5 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">Push blocked</p>
                  <p className="mt-1 text-xs leading-5 text-foreground">{contact.apolloPushBlockedReason}</p>
                </div>
              ) : null}
            </div>
          );
        }
      },
      {
        accessorKey: "recommendedSequenceName",
        header: "Recommendation",
        filterFn: "includesString",
        size: 260,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="max-w-[260px] text-mutedForeground">
              <p className="font-medium text-foreground">{contact.recommendedSequenceName}</p>
              <p className="mt-1 text-xs leading-5">{contact.sequenceRecommendationReason}</p>
            </div>
          );
        }
      },
      {
        accessorKey: "draftStatus",
        header: "Draft",
        filterFn: normalizedIncludesFilter,
        size: 300,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="max-w-[300px]">
              <StatusBadge value={contact.draftStatus} tone={draftStatusTone(contact.draftStatus)} />
              {contact.draft ? (
                <div className="mt-2 rounded-md border border-border bg-background p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-mutedForeground">Subject</p>
                  <p className="mt-1 text-xs font-medium text-foreground">{contact.draft.subject}</p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-mutedForeground">Preview</p>
                  <p className="mt-1 line-clamp-4 text-xs leading-5 text-mutedForeground">{contact.draft.body}</p>
                </div>
              ) : null}
            </div>
          );
        }
      },
      {
        accessorKey: "apolloStatus",
        header: "Apollo",
        filterFn: normalizedEqualsFilter,
        size: 120,
        cell: ({ row }) => <StatusBadge value={row.original.apolloStatus} tone={apolloStatusTone(row.original.apolloStatus)} />
      },
      {
        accessorFn: (row) => row.effectiveSequenceStatus,
        id: "sequenceStatus",
        header: "Sequence",
        filterFn: normalizedEqualsFilter,
        size: 120,
        cell: ({ row }) => {
          const contact = row.original;
          if (contact.apolloPushBlockedReason && contact.sequenceStatus !== SequenceStatus.ENROLLED) {
            return <StatusBadge value="PUSH_BLOCKED" tone="danger" />;
          }

          return <StatusBadge value={contact.sequenceStatus} tone={sequenceStatusTone(contact.sequenceStatus)} />;
        }
      },
      {
        accessorKey: "replyStatus",
        header: "Reply",
        filterFn: normalizedEqualsFilter,
        size: 120,
        cell: ({ row }) => <StatusBadge value={row.original.replyStatus} tone={replyStatusTone(row.original.replyStatus)} />
      },
      {
        accessorKey: "assignedRep",
        header: "Assigned rep",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="max-w-[220px]">
              <p className={contact.assignedRepValue ? "font-medium text-foreground" : "font-medium text-danger"}>
                {contact.assignedRep}
              </p>
              {contact.apolloAssignmentBlockReason ? (
                <p className="mt-1 text-xs leading-5 text-danger">{contact.apolloAssignmentBlockReason}</p>
              ) : (
                <p className="mt-1 text-xs text-mutedForeground">Rep assigned</p>
              )}
            </div>
          );
        }
      },
      {
        accessorKey: "lastTouchAt",
        header: "Last touch",
        size: 130,
        cell: ({ row }) => <div className="text-mutedForeground">{formatDate(row.original.lastTouchAt)}</div>
      },
      {
        accessorKey: "lastReplyAt",
        header: "Last reply",
        size: 130,
        cell: ({ row }) => <div className="text-mutedForeground">{formatDate(row.original.lastReplyAt)}</div>
      },
      {
        accessorKey: "source",
        header: "Source",
        filterFn: normalizedEqualsFilter,
        size: 120,
        cell: ({ row }) => <div className="text-mutedForeground">{formatEnum(row.original.source)}</div>
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        size: 130,
        cell: ({ row }) => <div className="text-mutedForeground">{formatDate(row.original.updatedAt)}</div>
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        enableColumnFilter: false,
        size: 340,
        cell: ({ row }) => {
          const contact = row.original;

          return (
            <div className="min-w-[320px] space-y-3">
              <form action={updateContactSequenceAction} className="grid gap-2">
                <input type="hidden" name="contactId" value={contact.id} />
                <select
                  name="sequenceId"
                  defaultValue={contact.selectedSequenceId}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  {sequenceOptions.map((sequence) => (
                    <option key={sequence.id} value={sequence.id}>
                      {sequence.name}
                    </option>
                  ))}
                </select>
                <input
                  name="sequenceOverrideReason"
                  defaultValue={contact.sequenceOverrideReason ?? ""}
                  placeholder="Optional override reason"
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                />
                {requiresSequenceOverrideConfirmation(contact.sequenceStatus) ? (
                  <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                    <input type="checkbox" name="confirmExistingSequenceOverride" value="true" className="mt-0.5" />
                    <span>Confirm changing cadence for a contact already showing Apollo sequence history.</span>
                  </label>
                ) : null}
                <button className="w-fit rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                  Change Sequence
                </button>
              </form>
              {contact.draft ? (
                <details className="rounded-md border border-border bg-background p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-primary">View Draft</summary>
                  {contact.requiresAiDraft ? (
                    <>
                      <form action={generateContactDraftAction} className="mt-3">
                        <input type="hidden" name="contactId" value={contact.id} />
                        <button
                          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!contact.draftGenerationConfigured}
                        >
                          {getDraftButtonLabel(contact, true)}
                        </button>
                      </form>
                      {getDraftDisabledHelp(contact)}
                    </>
                  ) : null}
                  <form action={saveContactDraftAction} className="mt-3 space-y-3">
                    <input type="hidden" name="draftId" value={contact.draft.id} />
                    <DraftMeta label="Contact" value={`${contact.fullName} at ${contact.companyName}`} />
                    <DraftMeta label="Title" value={contact.title ?? "Unknown title"} />
                    <DraftMeta label="Tier" value={formatEnum(contact.contactTier)} />
                    <DraftMeta label="Recommended sequence" value={contact.recommendedSequenceName} />
                    <DraftMeta label="Selected sequence" value={contact.selectedSequenceName} />
                    <DraftMeta label="Review status" value={formatEnum(contact.draft.status)} />
                    <label className="block space-y-1 text-xs font-semibold text-foreground">
                      <span>Subject line</span>
                      <input
                        name="subject"
                        defaultValue={contact.draft.subject}
                        className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                      />
                    </label>
                    <label className="block space-y-1 text-xs font-semibold text-foreground">
                      <span>Email body</span>
                      <textarea
                        name="body"
                        defaultValue={contact.draft.body}
                        rows={7}
                        className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs leading-5 text-foreground"
                      />
                    </label>
                    <DraftMeta
                      label="Personalization notes"
                      value={contact.draft.personalizationNotes ?? "No notes recorded"}
                    />
                    <p className="text-xs text-mutedForeground">
                      Saving keeps the draft ready for Apollo push. The actual enrollment still happens only when you use
                      Push to Apollo.
                    </p>
                    <p className="text-xs text-mutedForeground">
                      If you want a different angle, use Regenerate AI Draft and Newl Apps will write a fresh version
                      from the shipment context.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                        Save Draft
                      </button>
                    </div>
                  </form>
                </details>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-mutedForeground">
                    {contact.requiresAiDraft
                      ? "This tier requires a Newl Apps draft before Apollo push."
                      : contact.contactTier === ContactTier.TIER_1
                        ? "No Newl draft available yet."
                        : "Tier 2+ contacts use Apollo/template drafting later."}
                  </p>
                  {contact.requiresAiDraft ? (
                    <div className="space-y-2">
                      <form action={generateContactDraftAction}>
                        <input type="hidden" name="contactId" value={contact.id} />
                        <button
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!contact.draftGenerationConfigured}
                        >
                          {getDraftButtonLabel(contact, false)}
                        </button>
                      </form>
                      {getDraftDisabledHelp(contact)}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        }
      }
    ],
    [
      selectedSet,
      sequenceOptions,
      updateContactSequenceAction,
      saveContactDraftAction,
      generateContactDraftAction
    ]
  );

  const table = useReactTable({
    data: contacts,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnSizing
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange"
  });

  const allVisibleSelected =
    table.getRowModel().rows.length > 0 &&
    table.getRowModel().rows.every((row) => selectedSet.has(row.original.id));
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedSet.has(contact.id)),
    [contacts, selectedSet]
  );
  const selectedContactsWithSequenceHistory = selectedContacts.filter((contact) =>
    requiresSequenceOverrideConfirmation(contact.sequenceStatus)
  );
  const selectedContactsBlockedByAssignment = selectedContacts.filter((contact) =>
    Boolean(contact.apolloAssignmentBlockReason)
  );

  useEffect(() => {
    if (bulkActionState.status === "success" && bulkActionState.completedAt) {
      setSelectedIds([]);
    }
  }, [bulkActionState.completedAt, bulkActionState.status]);

  useEffect(() => {
    if (removeActionState.status === "success" && removeActionState.completedAt) {
      setSelectedIds([]);
    }
  }, [removeActionState.completedAt, removeActionState.status]);

  useEffect(() => {
    if (apolloPushState.status === "success" && apolloPushState.completedAt) {
      setSelectedIds([]);
    }
  }, [apolloPushState.completedAt, apolloPushState.status]);

  useEffect(() => {
    if (apolloPushState.jobRunId) {
      setActiveApolloPushJobId(apolloPushState.jobRunId);
    }
  }, [apolloPushState.jobRunId]);

  useEffect(() => {
    if (!activeApolloPushJobId) {
      return;
    }

    const activeJob = apolloPushJobs.find((job) => job.id === activeApolloPushJobId);
    if (!activeJob) {
      return;
    }

    const shouldStartQueuedJob = activeJob.status === "QUEUED";
    const shouldResumeStalledRunningJob = activeJob.status === "RUNNING" && activeJob.processedContacts === 0;

    if (!shouldStartQueuedJob && !shouldResumeStalledRunningJob) {
      return;
    }

    if (startedApolloPushJobIdsRef.current.has(activeJob.id)) {
      return;
    }

    startedApolloPushJobIdsRef.current.add(activeJob.id);

    void fetch("/api/lead-gen/apollo-push-jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jobId: activeJob.id
      })
    }).catch(() => {
      startedApolloPushJobIdsRef.current.delete(activeJob.id);
    });
  }, [activeApolloPushJobId, apolloPushJobs]);

  useEffect(() => {
    if (!activeApolloPushJobId) {
      return;
    }

    let cancelled = false;

    async function pollJob() {
      const response = await fetch(`/api/lead-gen/apollo-push-jobs?jobId=${activeApolloPushJobId}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { job?: ApolloPushJobSummary };
      if (!payload.job || cancelled) {
        return;
      }

      setApolloPushJobs((current) => {
        const next = [payload.job!, ...current.filter((job) => job.id !== payload.job!.id)];
        return next.slice(0, 10);
      });

      if (!isApolloPushJobStillActive(payload.job)) {
        startedApolloPushJobIdsRef.current.delete(payload.job.id);
        setActiveApolloPushJobId(null);
        router.refresh();
      }
    }

    void pollJob();
    const interval = window.setInterval(() => {
      void pollJob();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeApolloPushJobId, router]);

  function toggleAllVisible() {
    const visibleIds = table.getRowModel().rows.map((row) => row.original.id);
    const allVisibleCurrentlySelected =
      visibleIds.length > 0 && visibleIds.every((contactId) => selectedSet.has(contactId));
    setSelectedIds(allVisibleCurrentlySelected ? [] : visibleIds);
  }

  return (
    <>
      <ApolloPushJobHistoryPanel jobs={apolloPushJobs} />
      {isBulkSequencePending || isBulkRemovePending || isApolloPushPending || isApolloSyncPending ? (
        <div className="border-b border-border bg-primary/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isBulkRemovePending
                  ? "Removing contacts"
                  : isApolloPushPending
                    ? "Pushing selected contacts to Apollo"
                    : isApolloSyncPending
                      ? "Syncing Apollo contact statuses"
                      : "Updating contact cadence"}
              </p>
              <p className="text-xs text-mutedForeground">
                Working through {selectedIds.length} selected contact{selectedIds.length === 1 ? "" : "s"} now.
              </p>
            </div>
            <span className="text-xs font-medium text-primary">Running</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      ) : null}
      {bulkActionState.status !== "idle" ? <ContactBulkActionSummaryBanner summary={bulkActionState} /> : null}
      {removeActionState.status !== "idle" ? <ContactBulkActionSummaryBanner summary={removeActionState} /> : null}
      {apolloPushState.status !== "idle" ? <ContactBulkActionSummaryBanner summary={apolloPushState} /> : null}
      {apolloSyncState.status !== "idle" ? <ContactBulkActionSummaryBanner summary={apolloSyncState} /> : null}
      <form action={runBulkSequenceAction}>
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
            {selectedIds.map((contactId) => (
              <input key={contactId} type="hidden" name="contactId" value={contactId} />
            ))}
            <DataGridColumnMenu table={table} />
            <select
              name="sequenceId"
              defaultValue={sequenceOptions[0]?.id ?? ""}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              {sequenceOptions.map((sequence) => (
                <option key={sequence.id} value={sequence.id}>
                  {sequence.name}
                </option>
              ))}
            </select>
            <input
              name="sequenceOverrideReason"
              placeholder="Optional bulk reason"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            />
            {selectedContactsWithSequenceHistory.length > 0 ? (
              <label className="flex max-w-[300px] items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                <input type="checkbox" name="confirmExistingSequenceOverride" value="true" className="mt-0.5" />
                <span>
                  Confirm cadence change for {selectedContactsWithSequenceHistory.length} contact
                  {selectedContactsWithSequenceHistory.length === 1 ? "" : "s"} already showing Apollo sequence history.
                </span>
              </label>
            ) : null}
            {selectedContactsBlockedByAssignment.length > 0 ? (
              <p className="max-w-[300px] rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
                Assign a sales rep to {selectedContactsBlockedByAssignment.length} selected contact
                {selectedContactsBlockedByAssignment.length === 1 ? "" : "s"} before pushing to Apollo.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={
                selectedIds.length === 0 ||
                isBulkSequencePending ||
                isBulkRemovePending ||
                isApolloPushPending ||
                isApolloSyncPending
              }
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBulkSequencePending ? "Applying..." : "Apply selected cadence"}
            </button>
            <button
              type="submit"
              formAction={runApolloPushAction}
              disabled={
                selectedIds.length === 0 ||
                selectedContactsBlockedByAssignment.length > 0 ||
                isBulkSequencePending ||
                isBulkRemovePending ||
                isApolloPushPending ||
                isApolloSyncPending
              }
              className="rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isApolloPushPending ? "Pushing..." : "Push to Apollo"}
            </button>
            <button
              type="submit"
              formAction={runApolloSyncAction}
              disabled={
                selectedIds.length === 0 ||
                isBulkSequencePending ||
                isBulkRemovePending ||
                isApolloPushPending ||
                isApolloSyncPending
              }
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isApolloSyncPending ? "Syncing..." : "Sync Apollo status"}
            </button>
            <button
              type="submit"
              formAction={runBulkRemoveAction}
              disabled={
                selectedIds.length === 0 ||
                isBulkSequencePending ||
                isBulkRemovePending ||
                isApolloPushPending ||
                isApolloSyncPending
              }
              onClick={(event) => {
                if (
                  !window.confirm(
                    `Remove ${selectedIds.length} contact${selectedIds.length === 1 ? "" : "s"} from the Newl Apps contact directory? This will also remove any saved drafts for those contacts.`
                  )
                ) {
                  event.preventDefault();
                }
              }}
              className="rounded-md border border-danger/30 bg-card px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBulkRemovePending ? "Removing..." : "Remove selected"}
            </button>
          </div>
        </div>

        <div className="border-b border-border bg-card px-4 py-2 text-xs text-mutedForeground">
          Contacts already enrolled, paused, replied, bounced, or finished can still be assigned a new selected cadence, but
          the user must explicitly confirm that override first. Live Apollo push still blocks contacts that already show
          Apollo sequence history, so re-enrollment stays deliberate.
        </div>
      </form>
      <div className="overflow-x-auto">
        <table className="min-w-[2200px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDirection = header.column.getIsSorted();
                  return (
                    <th key={header.id} className="relative px-4 py-3" style={{ width: header.getSize() }}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
                        >
                          <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                          <SortIndicator direction={sortDirection} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                      {header.column.getCanResize() ? (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none bg-transparent transition-colors hover:bg-primary/20"
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
            <tr>
              {table.getVisibleLeafColumns().map((column) => (
                <th key={`${column.id}-filter`} className="border-t border-border px-4 py-2 align-top normal-case">
                  <ContactColumnFilterControl column={column} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-muted/60">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-4 align-top" style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatusBadge({ value, tone }: { value: string; tone: "neutral" | "success" | "warning" | "danger" }) {
  const className =
    tone === "success"
      ? "border-success/30 bg-success/10 text-success"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning"
        : tone === "danger"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-accentBorder bg-accentSoft text-primary";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{formatEnum(value)}</span>;
}

function ApolloPushJobHistoryPanel({ jobs }: { jobs: ApolloPushJobSummary[] }) {
  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Apollo push jobs</p>
          <p className="text-xs text-mutedForeground">
            Track recent bulk pushes, current progress, and any contacts Apollo skipped or rejected.
          </p>
        </div>
        <span className="rounded-full border border-accentBorder bg-card px-2.5 py-1 text-xs font-semibold text-primary">
          {jobs.length} recent job{jobs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {jobs.map((job) => {
          const progressPercent =
            job.selectedContacts > 0 ? Math.round((job.processedContacts / job.selectedContacts) * 100) : 0;
          const blockers = summarizeApolloJobBlockers(job.details);

          return (
            <details key={job.id} className="rounded-md border border-border bg-card px-3 py-3" open={job.status === "RUNNING"}>
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">Apollo bulk push</p>
                      <StatusBadge value={job.status} tone={apolloJobTone(job.status)} />
                    </div>
                    <p className="mt-1 text-xs text-mutedForeground">
                      Started {formatDateTime(job.startedAt)}
                      {job.finishedAt ? ` • Finished ${formatDateTime(job.finishedAt)}` : ""}
                    </p>
                  </div>
                  <div className="grid min-w-[340px] gap-2 text-right sm:grid-cols-4 sm:text-left">
                    <ContactBulkMetric label="Selected" value={job.selectedContacts} />
                    <ContactBulkMetric label="Enrolled" value={job.enrolledContacts} />
                    <ContactBulkMetric label="Skipped" value={job.skippedContacts} />
                    <ContactBulkMetric label="Failed" value={job.failedContacts} />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-mutedForeground">
                    <span>
                      {job.processedContacts} of {job.selectedContacts} contacts processed
                    </span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>
              </summary>
              {job.errorMessage ? <p className="mt-3 text-xs text-danger">{job.errorMessage}</p> : null}
              {blockers.length > 0 ? (
                <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Issues identified</p>
                  <div className="mt-2 space-y-2">
                    {blockers.map((blocker) => (
                      <div key={blocker.reason} className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground">
                        <span>{blocker.reason}</span>
                        <span className="rounded-full border border-warning/30 bg-background px-2 py-0.5 text-[11px] font-semibold text-warning">
                          {blocker.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {job.details.length > 0 ? <ApolloPushDetails details={job.details} /> : null}
            </details>
          );
        })}
      </div>
    </div>
  );
}

function ContactBulkActionSummaryBanner({ summary }: { summary: ContactBulkActionSummary }) {
  const isError = summary.status === "error";
  const apolloBlockerSummary = summarizeApolloBlockers(summary);
  const title = isError
    ? summary.operation === "remove"
      ? "Contact removal failed"
      : summary.operation === "apollo_push"
        ? "Apollo push failed"
        : summary.operation === "apollo_sync"
          ? "Apollo sync failed"
          : "Cadence update failed"
    : summary.operation === "remove"
      ? "Contact removal summary"
      : summary.operation === "apollo_push"
        ? "Apollo push summary"
        : summary.operation === "apollo_sync"
          ? "Apollo sync summary"
          : "Cadence update summary";

  return (
    <div className={`border-b px-4 py-3 ${isError ? "border-danger/20 bg-danger/5" : "border-success/20 bg-success/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-mutedForeground">{summary.message}</p>
        </div>
        {summary.completedAt ? <span className="text-xs text-mutedForeground">{formatDateTime(summary.completedAt)}</span> : null}
      </div>
      {summary.operation === "apollo_push" && apolloBlockerSummary.length > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Apollo blockers</p>
          <div className="mt-2 space-y-2">
            {apolloBlockerSummary.map((blocker) => (
              <div key={blocker.reason} className="flex flex-wrap items-start justify-between gap-2 text-sm text-foreground">
                <p className="max-w-3xl">{blocker.reason}</p>
                <span className="rounded-full border border-warning/30 bg-background px-2 py-0.5 text-[11px] font-semibold text-warning">
                  {blocker.count} contact{blocker.count === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!isError ? (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {summary.operation === "remove" ? (
              <>
                <ContactBulkMetric label="Selected" value={summary.selectedContacts} />
                <ContactBulkMetric label="Removed contacts" value={summary.removedContacts} />
                <ContactBulkMetric label="Removed drafts" value={summary.removedDrafts} />
                <ContactBulkMetric label="Apollo deletions" value={summary.pushedToApollo ? 1 : 0} />
              </>
            ) : summary.operation === "apollo_push" ? (
              <>
                <ContactBulkMetric label="Selected" value={summary.selectedContacts} />
                <ContactBulkMetric label="Enrolled" value={summary.enrolledContacts} />
                <ContactBulkMetric label="Skipped" value={summary.skippedContacts} />
                <ContactBulkMetric label="Failed" value={summary.failedContacts} />
              </>
            ) : summary.operation === "apollo_sync" ? (
              <>
                <ContactBulkMetric label="Selected" value={summary.selectedContacts} />
                <ContactBulkMetric label="Synced" value={summary.syncedContacts} />
                <ContactBulkMetric label="Skipped" value={summary.skippedContacts} />
                <ContactBulkMetric label="Companies" value={summary.companiesTouched} />
              </>
            ) : (
              <>
                <ContactBulkMetric label="Selected" value={summary.selectedContacts} />
                <ContactBulkMetric label="Updated cadence" value={summary.updatedContacts} />
                <ContactBulkMetric label="Marked ready" value={summary.readyContacts} />
                <ContactBulkMetric label="Needs manual caution" value={summary.protectedContacts} />
              </>
            )}
          </div>
          {summary.operation === "apollo_push" && summary.details.length > 0 ? (
            <ApolloPushDetails details={summary.details} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ApolloPushDetails({ details }: { details: ContactBulkActionDetail[] }) {
  const skippedOrFailed = details.filter((detail) => detail.outcome !== "enrolled");

  if (skippedOrFailed.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-md border border-border/70 bg-card px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Contact results</p>
      <div className="mt-2 space-y-2">
        {skippedOrFailed.map((detail) => (
          <div key={`${detail.contactId}-${detail.outcome}`} className="rounded-md border border-border/60 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                {detail.contactName} <span className="font-normal text-mutedForeground">({detail.companyName})</span>
              </p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  detail.outcome === "failed"
                    ? "border-danger/30 bg-danger/10 text-danger"
                    : "border-warning/30 bg-warning/10 text-warning"
                }`}
              >
                {detail.outcome === "failed" ? "Failed" : "Skipped"}
              </span>
            </div>
            <p className="mt-1 text-xs text-mutedForeground">{detail.reason ?? "No reason returned."}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function summarizeApolloBlockers(summary: ContactBulkActionSummary) {
  if (summary.operation !== "apollo_push" || summary.details.length === 0) {
    return [];
  }

  const reasonCounts = new Map<string, number>();

  for (const detail of summary.details) {
    if (detail.outcome === "enrolled") {
      continue;
    }

    const reason = detail.reason?.trim() || "No reason returned.";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  return Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, 3);
}

function summarizeApolloJobBlockers(details: ContactBulkActionDetail[]) {
  const reasonCounts = new Map<string, number>();

  for (const detail of details) {
    if (detail.outcome === "enrolled") {
      continue;
    }

    const reason = detail.reason?.trim() || "No reason returned.";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  return Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, 5);
}

function isApolloPushJobStillActive(job: ApolloPushJobSummary) {
  if (job.status === "QUEUED" || job.status === "RUNNING") {
    return true;
  }

  return job.details.some(
    (detail) =>
      detail.outcome === "skipped" &&
      detail.reason ===
        "Apollo accepted the push, but the cadence enrollment is still propagating in Apollo and was not visible during Newl Apps verification."
  );
}

function apolloJobTone(status: ApolloPushJobSummary["status"]) {
  if (status === "SUCCESS") {
    return "success";
  }

  if (status === "ERROR" || status === "CANCELLED") {
    return "danger";
  }

  return "warning";
}

function ContactBulkMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/70 bg-card px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value.toLocaleString("en-US")}</p>
    </div>
  );
}

function DraftMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <p className="font-semibold text-mutedForeground">{label}</p>
      <p className="mt-0.5 text-foreground">{value}</p>
    </div>
  );
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function contactStatusTone(status: ContactStatus) {
  if (status === ContactStatus.APPROVED) return "success";
  if (status === ContactStatus.REVIEWING) return "warning";
  if (status === ContactStatus.REJECTED || status === ContactStatus.DO_NOT_CONTACT) return "danger";
  return "neutral";
}

function apolloStatusTone(status: ApolloStatus) {
  if (status === ApolloStatus.ENRICHED) return "success";
  if (status === ApolloStatus.ERROR) return "danger";
  if (status === ApolloStatus.NOT_FOUND) return "warning";
  return "neutral";
}

function sequenceStatusTone(status: SequenceStatus) {
  if (status === SequenceStatus.ENROLLED || status === SequenceStatus.FINISHED || status === SequenceStatus.REPLIED) return "success";
  if (status === SequenceStatus.READY || status === SequenceStatus.PAUSED) return "warning";
  if (status === SequenceStatus.BOUNCED) return "danger";
  return "neutral";
}

function replyStatusTone(status: ReplyStatus) {
  if (status === ReplyStatus.POSITIVE || status === ReplyStatus.MEETING_BOOKED) return "success";
  if (status === ReplyStatus.NEGATIVE) return "danger";
  if (status === ReplyStatus.REPLIED || status === ReplyStatus.OUT_OF_OFFICE) return "warning";
  return "neutral";
}

function requiresSequenceOverrideConfirmation(sequenceStatus: SequenceStatus) {
  return sequenceStatus !== SequenceStatus.NOT_STARTED && sequenceStatus !== SequenceStatus.READY;
}

function draftStatusTone(status: string) {
  if (status === ContactOutreachDraftStatus.APPROVED || status === ContactOutreachDraftStatus.EDITED) return "success";
  if (status === ContactOutreachDraftStatus.AVAILABLE || status === ContactOutreachDraftStatus.DRAFT) return "warning";
  return "neutral";
}

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  if (!direction) {
    return <span className="text-[10px] text-mutedForeground">-</span>;
  }
  return <span className="text-[10px] text-foreground">{direction === "asc" ? "▲" : "▼"}</span>;
}

function ContactColumnFilterControl({
  column
}: {
  column: ReturnType<ReturnType<typeof useReactTable<ContactDirectoryRow>>["getVisibleLeafColumns"]>[number];
}) {
  const value = column.getFilterValue();

  if (column.id === "select" || column.id === "actions") return null;

  if (column.id === "contactScore") {
    return (
      <HeaderFilterNumber
        value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        placeholder="Min score"
      />
    );
  }

  if (column.id === "contactStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any contact status" },
          { value: ContactStatus.NEW, label: "New" },
          { value: ContactStatus.REVIEWING, label: "Reviewing" },
          { value: ContactStatus.APPROVED, label: "Approved" },
          { value: ContactStatus.REJECTED, label: "Rejected" },
          { value: ContactStatus.DO_NOT_CONTACT, label: "Do not contact" }
        ]}
      />
    );
  }

  if (column.id === "apolloStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any Apollo state" },
          { value: ApolloStatus.NOT_STARTED, label: "Not started" },
          { value: ApolloStatus.ENRICHED, label: "Enriched" },
          { value: ApolloStatus.NOT_FOUND, label: "Not found" },
          { value: ApolloStatus.ERROR, label: "Error" }
        ]}
      />
    );
  }

  if (column.id === "sequenceStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any sequence state" },
          { value: "PUSH_BLOCKED", label: "Push blocked" },
          { value: SequenceStatus.NOT_STARTED, label: "Not started" },
          { value: SequenceStatus.READY, label: "Ready" },
          { value: SequenceStatus.ENROLLED, label: "Enrolled" },
          { value: SequenceStatus.PAUSED, label: "Paused" },
          { value: SequenceStatus.REPLIED, label: "Replied" },
          { value: SequenceStatus.BOUNCED, label: "Bounced" },
          { value: SequenceStatus.FINISHED, label: "Finished" }
        ]}
      />
    );
  }

  if (column.id === "replyStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any reply state" },
          { value: ReplyStatus.NO_REPLY, label: "No reply" },
          { value: ReplyStatus.REPLIED, label: "Replied" },
          { value: ReplyStatus.POSITIVE, label: "Positive" },
          { value: ReplyStatus.NEGATIVE, label: "Negative" },
          { value: ReplyStatus.MEETING_BOOKED, label: "Meeting booked" },
          { value: ReplyStatus.OUT_OF_OFFICE, label: "Out of office" }
        ]}
      />
    );
  }

  if (column.id === "source") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any source" },
          { value: ContactSource.MANUAL, label: "Manual" },
          { value: ContactSource.APOLLO, label: "Apollo" },
          { value: ContactSource.IMPORT, label: "Import" },
          { value: ContactSource.UNKNOWN, label: "Unknown" }
        ]}
      />
    );
  }

  const textPlaceholders: Record<string, string> = {
    fullName: "Search contact",
    title: "Filter title",
    companyName: "Filter company",
    email: "Filter email",
    selectedSequenceName: "Filter selected cadence",
    recommendedSequenceName: "Filter recommendation",
    draftStatus: "Filter draft state",
    assignedRep: "Filter rep"
  };

  return <HeaderFilterText value={typeof value === "string" ? value : ""} onChange={(nextValue) => column.setFilterValue(nextValue)} placeholder={textPlaceholders[column.id] ?? "Filter"} />;
}

function HeaderFilterText({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-mutedForeground"
    />
  );
}

function HeaderFilterNumber({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="number"
      min="0"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-mutedForeground"
    />
  );
}

function HeaderFilterSelect({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
    >
      {options.map((option) => (
        <option key={`${option.value}-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function minimumNumberFilter(row: { getValue: (columnId: string) => unknown }, columnId: string, filterValue: unknown) {
  if (filterValue === undefined || filterValue === null || filterValue === "") return true;
  const numericFilter = Number(filterValue);
  if (Number.isNaN(numericFilter)) return true;
  const value = Number(row.getValue(columnId));
  return !Number.isNaN(value) && value >= numericFilter;
}

function normalizeFilterToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizedEqualsFilter(row: { getValue: (columnId: string) => unknown }, columnId: string, filterValue: unknown) {
  const normalizedFilter = normalizeFilterToken(filterValue);
  if (!normalizedFilter) {
    return true;
  }

  const normalizedValue = normalizeFilterToken(row.getValue(columnId));
  return normalizedValue === normalizedFilter;
}

function normalizedIncludesFilter(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: unknown
) {
  const normalizedFilter = normalizeFilterToken(filterValue);
  if (!normalizedFilter) {
    return true;
  }

  const normalizedValue = normalizeFilterToken(row.getValue(columnId));
  return normalizedValue.includes(normalizedFilter);
}
