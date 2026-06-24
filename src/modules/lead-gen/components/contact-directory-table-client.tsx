"use client";

import {
  ApolloStatus,
  ContactOutreachDraftStatus,
  ContactStatus,
  ContactTier,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { useMemo, useState } from "react";
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
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = contacts.length > 0 && contacts.every((contact) => selectedSet.has(contact.id));
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedSet.has(contact.id)),
    [contacts, selectedSet]
  );
  const selectedContactsWithSequenceHistory = selectedContacts.filter((contact) =>
    requiresSequenceOverrideConfirmation(contact.sequenceStatus)
  );

  function toggleSelection(contactId: string) {
    setSelectedIds((current) =>
      current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]
    );
  }

  function toggleAllVisible() {
    setSelectedIds((current) => (current.length === contacts.length ? [] : contacts.map((contact) => contact.id)));
  }

  function clearSelection() {
    setSelectedIds([]);
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
        <table className="min-w-[1780px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label={allVisibleSelected ? "Deselect all visible contacts" : "Select all visible contacts"}
                />
              </th>
              <th className="px-4 py-3">Contact name</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Contact status</th>
              <th className="px-4 py-3">Score / tier</th>
              <th className="px-4 py-3">Selected sequence</th>
              <th className="px-4 py-3">Recommendation</th>
              <th className="px-4 py-3">Draft</th>
              <th className="px-4 py-3">Apollo</th>
              <th className="px-4 py-3">Sequence</th>
              <th className="px-4 py-3">Reply</th>
              <th className="px-4 py-3">Assigned rep</th>
              <th className="px-4 py-3">Last touch</th>
              <th className="px-4 py-3">Last reply</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {contacts.map((contact) => (
              <tr key={contact.id} className="align-top transition-colors hover:bg-muted/60">
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(contact.id)}
                    onChange={() => toggleSelection(contact.id)}
                    aria-label={`Select ${contact.fullName}`}
                  />
                </td>
                <td className="max-w-[220px] px-4 py-4">
                  <p className="font-semibold text-foreground">{contact.fullName}</p>
                  <p className="mt-1 text-xs text-mutedForeground">
                    {[contact.seniority, contact.department].filter(Boolean).join(" / ") || "Unclassified"}
                  </p>
                </td>
                <td className="max-w-[220px] px-4 py-4 text-mutedForeground">{contact.title ?? "Unknown title"}</td>
                <td className="max-w-[220px] px-4 py-4">
                  <p className="font-medium text-foreground">{contact.companyName}</p>
                  <p className="mt-1 text-xs text-mutedForeground">{contact.companyNormalizedName}</p>
                  {contact.matchedSearchProfileName ? (
                    <div className="mt-2 inline-flex max-w-full items-center rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-[11px] font-semibold text-primary">
                      <span className="truncate">Profile: {contact.matchedSearchProfileName}</span>
                    </div>
                  ) : null}
                </td>
                <td className="max-w-[220px] px-4 py-4 text-mutedForeground">{contact.email ?? "No email yet"}</td>
                <td className="px-4 py-4">
                  <StatusBadge value={contact.contactStatus} tone={contactStatusTone(contact.contactStatus)} />
                </td>
                <td className="px-4 py-4">
                  <span className="text-lg font-bold text-primary">{contact.contactScore}</span>
                  <p className="mt-1 text-xs font-medium text-mutedForeground">{formatEnum(contact.contactTier)}</p>
                  <p className="mt-2 max-w-[220px] text-xs leading-5 text-mutedForeground">{contact.contactScoreSummary}</p>
                </td>
                <td className="max-w-[220px] px-4 py-4">
                  <p className="font-medium text-foreground">{contact.selectedSequenceName}</p>
                  <p className="mt-1 text-xs text-mutedForeground">
                    {contact.sequenceManuallyOverridden ? "Manual override" : "Auto-selected"}
                  </p>
                </td>
                <td className="max-w-[260px] px-4 py-4 text-mutedForeground">
                  <p className="font-medium text-foreground">{contact.recommendedSequenceName}</p>
                  <p className="mt-1 text-xs leading-5">{contact.sequenceRecommendationReason}</p>
                </td>
                <td className="max-w-[300px] px-4 py-4">
                  <StatusBadge value={contact.draftStatus} tone={draftStatusTone(contact.draftStatus)} />
                  {contact.draft ? (
                    <div className="mt-2 rounded-md border border-border bg-background p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-mutedForeground">Subject</p>
                      <p className="mt-1 text-xs font-medium text-foreground">{contact.draft.subject}</p>
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-mutedForeground">Preview</p>
                      <p className="mt-1 line-clamp-4 text-xs leading-5 text-mutedForeground">{contact.draft.body}</p>
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge value={contact.apolloStatus} tone={apolloStatusTone(contact.apolloStatus)} />
                </td>
                <td className="px-4 py-4">
                  <StatusBadge value={contact.sequenceStatus} tone={sequenceStatusTone(contact.sequenceStatus)} />
                </td>
                <td className="px-4 py-4">
                  <StatusBadge value={contact.replyStatus} tone={replyStatusTone(contact.replyStatus)} />
                </td>
                <td className="px-4 py-4 text-mutedForeground">{contact.assignedRep}</td>
                <td className="px-4 py-4 text-mutedForeground">{formatDate(contact.lastTouchAt)}</td>
                <td className="px-4 py-4 text-mutedForeground">{formatDate(contact.lastReplyAt)}</td>
                <td className="px-4 py-4 text-mutedForeground">{formatEnum(contact.source)}</td>
                <td className="px-4 py-4 text-mutedForeground">{formatDate(contact.updatedAt)}</td>
                <td className="px-4 py-4">
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
                          <span>
                            Confirm changing cadence for a contact already showing Apollo sequence history.
                          </span>
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
                </td>
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
  if (status === ContactStatus.APPROVED) {
    return "success";
  }

  if (status === ContactStatus.REVIEWING) {
    return "warning";
  }

  if (status === ContactStatus.REJECTED || status === ContactStatus.DO_NOT_CONTACT) {
    return "danger";
  }

  return "neutral";
}

function apolloStatusTone(status: ApolloStatus) {
  if (status === ApolloStatus.ENRICHED) {
    return "success";
  }

  if (status === ApolloStatus.ERROR) {
    return "danger";
  }

  if (status === ApolloStatus.NOT_FOUND) {
    return "warning";
  }

  return "neutral";
}

function sequenceStatusTone(status: SequenceStatus) {
  if (status === SequenceStatus.ENROLLED || status === SequenceStatus.FINISHED || status === SequenceStatus.REPLIED) {
    return "success";
  }

  if (status === SequenceStatus.READY || status === SequenceStatus.PAUSED) {
    return "warning";
  }

  if (status === SequenceStatus.BOUNCED) {
    return "danger";
  }

  return "neutral";
}

function replyStatusTone(status: ReplyStatus) {
  if (status === ReplyStatus.POSITIVE || status === ReplyStatus.MEETING_BOOKED) {
    return "success";
  }

  if (status === ReplyStatus.NEGATIVE) {
    return "danger";
  }

  if (status === ReplyStatus.REPLIED || status === ReplyStatus.OUT_OF_OFFICE) {
    return "warning";
  }

  return "neutral";
}

function requiresSequenceOverrideConfirmation(sequenceStatus: SequenceStatus) {
  return sequenceStatus !== SequenceStatus.NOT_STARTED && sequenceStatus !== SequenceStatus.READY;
}

function draftStatusTone(status: string) {
  if (status === ContactOutreachDraftStatus.APPROVED || status === ContactOutreachDraftStatus.EDITED) {
    return "success";
  }

  if (status === ContactOutreachDraftStatus.AVAILABLE || status === ContactOutreachDraftStatus.DRAFT) {
    return "warning";
  }

  return "neutral";
}
