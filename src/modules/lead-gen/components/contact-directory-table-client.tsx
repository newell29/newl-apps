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
import { useMemo, useState } from "react";
import { DataGridColumnMenu } from "@/components/data-grid-column-menu";
import { usePersistedTableState } from "@/components/use-persisted-table-state";
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
  replyStatus: ReplyStatus;
  recommendedSequenceName: string;
  selectedSequenceId: string;
  selectedSequenceName: string;
  sequenceRecommendationReason: string;
  sequenceOverrideReason: string | null;
  sequenceManuallyOverridden: boolean;
  requiresAiDraft: boolean;
  draftGenerationConfigured: boolean;
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
  assignedRep: string;
  updatedAt: Date;
};

export function ContactDirectoryTableClient({
  contacts,
  sequenceOptions,
  bulkUpdateContactSequenceAction,
  updateContactSequenceAction,
  saveContactDraftAction,
  approveContactDraftAction,
  generateContactDraftAction
}: {
  contacts: ContactDirectoryRow[];
  sequenceOptions: readonly SequenceCatalogItem[];
  bulkUpdateContactSequenceAction: (formData: FormData) => Promise<void>;
  updateContactSequenceAction: (formData: FormData) => Promise<void>;
  saveContactDraftAction: (formData: FormData) => Promise<void>;
  approveContactDraftAction: (formData: FormData) => Promise<void>;
  generateContactDraftAction: (formData: FormData) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
              <p className="font-medium text-foreground">{contact.companyName}</p>
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
        filterFn: "includesString",
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
        filterFn: "includesString",
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
        filterFn: "includesString",
        size: 120,
        cell: ({ row }) => <StatusBadge value={row.original.apolloStatus} tone={apolloStatusTone(row.original.apolloStatus)} />
      },
      {
        accessorKey: "sequenceStatus",
        header: "Sequence",
        filterFn: "includesString",
        size: 120,
        cell: ({ row }) => <StatusBadge value={row.original.sequenceStatus} tone={sequenceStatusTone(row.original.sequenceStatus)} />
      },
      {
        accessorKey: "replyStatus",
        header: "Reply",
        filterFn: "includesString",
        size: 120,
        cell: ({ row }) => <StatusBadge value={row.original.replyStatus} tone={replyStatusTone(row.original.replyStatus)} />
      },
      {
        accessorKey: "assignedRep",
        header: "Assigned rep",
        filterFn: "includesString",
        size: 150
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
        filterFn: "includesString",
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
                    <form action={generateContactDraftAction} className="mt-3">
                      <input type="hidden" name="contactId" value={contact.id} />
                      <button
                        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!contact.draftGenerationConfigured}
                      >
                        {contact.draftGenerationConfigured ? "Regenerate AI Draft" : "OpenAI key required"}
                      </button>
                    </form>
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
                      Saving keeps the draft in Newl Apps only. Approving marks it ready for a future Apollo push, but still does not enroll a sequence or send email on its own.
                    </p>
                    <p className="text-xs text-mutedForeground">
                      Approve after you are happy with the subject and body. If you make edits first, save them before approving so the approved version matches your review.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                        Save Draft
                      </button>
                      <button
                        formAction={approveContactDraftAction}
                        className="rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/15"
                      >
                        Approve Draft
                      </button>
                    </div>
                  </form>
                </details>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-mutedForeground">
                    {contact.requiresAiDraft
                      ? "This tier requires a Newl Apps draft before future Apollo push."
                      : contact.contactTier === ContactTier.TIER_1
                        ? "No Newl draft available yet."
                        : "Tier 2+ contacts use Apollo/template drafting later."}
                  </p>
                  {contact.requiresAiDraft ? (
                    <form action={generateContactDraftAction}>
                      <input type="hidden" name="contactId" value={contact.id} />
                      <button
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!contact.draftGenerationConfigured}
                      >
                        {contact.draftGenerationConfigured ? "Generate AI Draft" : "OpenAI key required"}
                      </button>
                    </form>
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
      approveContactDraftAction,
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

  function toggleAllVisible() {
    const visibleIds = table.getRowModel().rows.map((row) => row.original.id);
    const allVisibleCurrentlySelected =
      visibleIds.length > 0 && visibleIds.every((contactId) => selectedSet.has(contactId));
    setSelectedIds(allVisibleCurrentlySelected ? [] : visibleIds);
  }

  return (
    <>
      <form action={bulkUpdateContactSequenceAction}>
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
            <button
              type="submit"
              disabled={selectedIds.length === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply selected cadence
            </button>
          </div>
        </div>

        <div className="border-b border-border bg-card px-4 py-2 text-xs text-mutedForeground">
          Contacts already enrolled, paused, replied, bounced, or finished can still be assigned a new selected cadence, but
          the user must explicitly confirm that override first. Their current Apollo sequence status stays intact until a
          future push is approved.
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
