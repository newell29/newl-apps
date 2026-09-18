"use client";

import { useActionState } from "react";

import {
  generateOpportunityEmailDraftAction,
  handoffOpportunityMailboxAction,
  linkOpportunityEmailAction,
  sendOpportunityEmailDraftAction,
  syncOpportunityCorrespondenceAction
} from "../actions";
import { CLOSED_STATUSES, EMPTY_ACTION_STATE, type OpportunityActionState } from "../opportunities";

const buttonClass =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover disabled:opacity-50";
const secondaryButtonClass =
  "rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50";
const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-70";

export type CorrespondenceMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "RECEIVED" | "DRAFT" | "SENDING" | "SENT" | "SEND_FAILED" | "CANCELLED";
  mailboxAddress: string;
  subject: string;
  bodyText: string;
  bodyPreview: string | null;
  senderAddress: string;
  senderName: string | null;
  webLink: string | null;
  hasAttachments: boolean;
  messageAt: string;
  draftSource: string | null;
  draftRationale: string | null;
  suggestedNextAction: string | null;
  suggestedFollowUpOn: string | null;
  basedOnMessageId: string | null;
  failureReason: string | null;
};

export function InboundMailboxToolbar({
  enabled,
  reason,
  mailboxes,
  canMutate
}: {
  enabled: boolean;
  reason: string | null;
  mailboxes: string[];
  canMutate: boolean;
}) {
  const [state, action, pending] = useActionState(
    syncOpportunityCorrespondenceAction,
    EMPTY_ACTION_STATE
  );
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Microsoft 365 correspondence</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            {enabled
              ? `${mailboxes.length} approved owner mailbox${mailboxes.length === 1 ? "" : "es"} are available. Mail is also synchronized hourly.`
              : reason || "Microsoft 365 correspondence is not ready."}
          </p>
          {enabled ? (
            <p className="mt-1 text-xs text-mutedForeground">{mailboxes.join(" · ")}</p>
          ) : null}
        </div>
        {canMutate && enabled ? (
          <form action={action}>
            <button className={secondaryButtonClass} disabled={pending}>
              {pending ? "Synchronizing…" : "Sync mail now"}
            </button>
          </form>
        ) : null}
      </div>
      <ActionMessage state={state} />
    </section>
  );
}

export function EmailMatchQueue({
  messages,
  canMutate
}: {
  messages: Array<{
    id: string;
    senderAddress: string;
    subject: string;
    messageAt: string;
    candidates: Array<{ id: string; label: string }>;
  }>;
  canMutate: boolean;
}) {
  if (!messages.length) return null;
  return (
    <section className="rounded-lg border border-warning/40 bg-warning/10 p-4">
      <h2 className="font-semibold">Email matching needs review</h2>
      <p className="mt-1 text-sm text-mutedForeground">
        These messages match more than one opportunity with the same contact email. Choose the
        correct enquiry; Newl Apps will not guess.
      </p>
      <div className="mt-3 space-y-3">
        {messages.map((message) => (
          <EmailMatchCard key={message.id} message={message} canMutate={canMutate} />
        ))}
      </div>
    </section>
  );
}

function EmailMatchCard({
  message,
  canMutate
}: {
  message: {
    id: string;
    senderAddress: string;
    subject: string;
    messageAt: string;
    candidates: Array<{ id: string; label: string }>;
  };
  canMutate: boolean;
}) {
  const [state, action, pending] = useActionState(linkOpportunityEmailAction, EMPTY_ACTION_STATE);
  return (
    <form action={action} className="rounded-md border border-border bg-card p-3">
      <input type="hidden" name="messageId" value={message.id} />
      <p className="text-sm font-semibold">{message.subject}</p>
      <p className="mt-1 text-xs text-mutedForeground">
        {message.senderAddress} · {formatDateTime(message.messageAt)}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 text-sm font-medium">
          Link to opportunity
          <select name="targetSubmissionId" required className={inputClass} disabled={!canMutate || pending}>
            <option value="">Choose an exact-email match</option>
            {message.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        {canMutate ? (
          <button className={secondaryButtonClass} disabled={pending}>
            {pending ? "Linking…" : "Link email"}
          </button>
        ) : null}
      </div>
      <ActionMessage state={state} />
    </form>
  );
}

export function CorrespondencePanel({
  opportunity,
  messages,
  ownerMailbox,
  enabled,
  draftingEnabled,
  canMutate,
  currentUserId
}: {
  opportunity: {
    id: string;
    status: string;
    email: string | null;
    ownerUserId: string | null;
    communicationMailbox: string | null;
  };
  messages: CorrespondenceMessage[];
  ownerMailbox: string | null;
  enabled: boolean;
  draftingEnabled: boolean;
  canMutate: boolean;
  currentUserId: string;
}) {
  const [draftState, draftAction, drafting] = useActionState(
    generateOpportunityEmailDraftAction,
    EMPTY_ACTION_STATE
  );
  const [handoffState, handoffAction, handingOff] = useActionState(
    handoffOpportunityMailboxAction,
    EMPTY_ACTION_STATE
  );
  const closed = CLOSED_STATUSES.includes(opportunity.status as never);
  const isOwner = opportunity.ownerUserId === currentUserId;
  const mailboxMismatch = Boolean(
    ownerMailbox &&
      opportunity.communicationMailbox &&
      ownerMailbox.toLowerCase() !== opportunity.communicationMailbox.toLowerCase()
  );
  const canPrepare =
    canMutate && enabled && Boolean(ownerMailbox) && Boolean(opportunity.email) && !closed && !mailboxMismatch;

  return (
    <section className="mt-6 border-t border-border pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Email correspondence</h3>
          <p className="mt-1 text-xs text-mutedForeground">
            {ownerMailbox
              ? `Assigned mailbox: ${ownerMailbox}`
              : "Assign this opportunity to an approved mailbox owner to prepare email."}
          </p>
          {opportunity.communicationMailbox ? (
            <p className="mt-1 text-xs text-mutedForeground">
              Conversation mailbox: {opportunity.communicationMailbox}
            </p>
          ) : null}
        </div>
        {canPrepare ? (
          <form action={draftAction}>
            <input type="hidden" name="submissionId" value={opportunity.id} />
            <button className={secondaryButtonClass} disabled={drafting}>
              {drafting ? "Preparing…" : messages.some((message) => message.direction === "INBOUND") ? "Prepare suggested reply" : "Prepare initial email"}
            </button>
          </form>
        ) : null}
      </div>
      {mailboxMismatch && isOwner && canMutate ? (
        <form action={handoffAction} className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3">
          <input type="hidden" name="submissionId" value={opportunity.id} />
          <p className="text-sm">
            This conversation still uses {opportunity.communicationMailbox}. Accepting the handoff
            starts future email from {ownerMailbox}; earlier mail remains in the original mailbox.
          </p>
          <button className={`${secondaryButtonClass} mt-3`} disabled={handingOff}>
            {handingOff ? "Handing off…" : "Accept mailbox handoff"}
          </button>
        </form>
      ) : null}
      {!draftingEnabled && enabled ? (
        <p className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-mutedForeground">
          Tracking is active. Sending remains disabled until Microsoft 365 drafting is enabled and
          Mail.Send is confirmed.
        </p>
      ) : null}
      <ActionMessage state={draftState} />
      <ActionMessage state={handoffState} />
      <div className="mt-4 space-y-3">
        {messages.map((message) =>
          message.status === "DRAFT" ? (
            <DraftCard
              key={message.id}
              message={message}
              canSend={canMutate && draftingEnabled && isOwner && !mailboxMismatch}
              recipient={opportunity.email}
            />
          ) : message.status === "CANCELLED" ? null : (
            <MessageCard key={message.id} message={message} />
          )
        )}
        {!messages.some((message) => message.status !== "CANCELLED") ? (
          <p className="text-sm text-mutedForeground">
            No linked email yet. Synchronize Microsoft 365, or prepare the first approved email.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function DraftCard({
  message,
  canSend,
  recipient
}: {
  message: CorrespondenceMessage;
  canSend: boolean;
  recipient: string | null;
}) {
  const [state, action, pending] = useActionState(
    sendOpportunityEmailDraftAction,
    EMPTY_ACTION_STATE
  );
  return (
    <form action={action} className="rounded-md border border-primary/30 bg-accentSoft/30 p-4">
      <input type="hidden" name="draftId" value={message.id} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Review email draft</p>
        <span className="rounded-full border border-border px-2 py-1 text-xs">
          {message.draftSource === "AI" ? "AI assisted" : "Safe template"}
        </span>
      </div>
      <p className="mt-1 text-xs text-mutedForeground">
        From {message.mailboxAddress} to {recipient || "missing contact email"}
      </p>
      <label className="mt-3 block text-sm font-medium">
        Subject
        <input
          name="subject"
          required
          maxLength={200}
          defaultValue={message.subject}
          className={inputClass}
          disabled={pending || !canSend}
        />
      </label>
      <label className="mt-3 block text-sm font-medium">
        Message
        <textarea
          name="body"
          required
          maxLength={5000}
          rows={10}
          defaultValue={message.bodyText}
          className={inputClass}
          disabled={pending || !canSend}
        />
      </label>
      {message.draftRationale ? (
        <p className="mt-3 text-xs text-mutedForeground">Why this draft: {message.draftRationale}</p>
      ) : null}
      {message.suggestedNextAction ? (
        <p className="mt-1 text-xs text-mutedForeground">
          Suggested next action: {message.suggestedNextAction}
          {message.suggestedFollowUpOn ? ` · Follow up ${message.suggestedFollowUpOn}` : ""}
        </p>
      ) : null}
      {canSend ? (
        <button className={`${buttonClass} mt-4`} disabled={pending}>
          {pending ? "Sending…" : "Approve exact email & send"}
        </button>
      ) : (
        <p className="mt-3 text-sm text-mutedForeground">
          The assigned owner must review and send this draft.
        </p>
      )}
      <ActionMessage state={state} />
    </form>
  );
}

function MessageCard({ message }: { message: CorrespondenceMessage }) {
  const failed = message.status === "SEND_FAILED";
  return (
    <article className={`rounded-md border p-3 ${failed ? "border-danger/30 bg-danger/10" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            {message.direction === "INBOUND" ? "Received" : failed ? "Send not confirmed" : "Sent"}
          </p>
          <p className="mt-1 text-sm font-semibold">{message.subject}</p>
        </div>
        <p className="text-xs text-mutedForeground">{formatDateTime(message.messageAt)}</p>
      </div>
      <p className="mt-1 break-all text-xs text-mutedForeground">
        {message.direction === "INBOUND"
          ? `From ${message.senderName || message.senderAddress}`
          : `From ${message.mailboxAddress}`}
        {message.hasAttachments ? " · Has attachments" : ""}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-primary">Read message</summary>
        <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
          {message.bodyText || message.bodyPreview || "No message body was returned."}
        </p>
      </details>
      {message.webLink ? (
        <a
          href={message.webLink}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-semibold text-primary underline"
        >
          Open in Outlook
        </a>
      ) : null}
      {failed ? (
        <p className="mt-2 text-xs text-danger">
          Check Sent Items and synchronize before preparing another email. The app will not retry an
          uncertain customer communication automatically.
        </p>
      ) : null}
    </article>
  );
}

function ActionMessage({ state }: { state: OpportunityActionState }) {
  return state.message ? (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`mt-3 rounded-md border p-3 text-sm ${state.status === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-border bg-muted/30"}`}
    >
      {state.message}
    </p>
  ) : null;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto"
  }).format(new Date(value));
}
