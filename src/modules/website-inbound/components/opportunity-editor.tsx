"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  addOpportunityNoteAction,
  createOpportunityAction,
  updateOpportunityAction
} from "../actions";
import {
  CHANNEL_LABELS,
  EMPTY_ACTION_STATE,
  STATUS_LABELS,
  type OpportunityActionState
} from "../opportunities";

export type EditorOpportunity = {
  id: string;
  revision: number;
  entryMethod: string;
  company: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  primaryNeed: string | null;
  source: string | null;
  status: string;
  contactChannel: string;
  ownerUserId: string | null;
  receivedOn: string;
  nextAction: string | null;
  followUpOn: string | null;
  closedReason: string | null;
};
const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-70";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover disabled:opacity-50";

export function OpportunityEditor({
  opportunity,
  owners,
  canMutate,
  today,
  creationKey,
  returnTo,
  currentUserId
}: {
  opportunity?: EditorOpportunity;
  owners: { id: string; label: string }[];
  canMutate: boolean;
  today: string;
  creationKey?: string;
  returnTo: string;
  currentUserId: string;
}) {
  const [state, action, pending] = useActionState(
    opportunity ? updateOpportunityAction : createOpportunityAction,
    EMPTY_ACTION_STATE
  );
  const [key] = useState(creationKey);
  // Keep the revision tied to the values this editor loaded. A note save can
  // refresh server props while this form still contains unsaved contact edits.
  const [revision, setRevision] = useState(opportunity?.revision ?? 0);
  useEffect(() => {
    if (state.status === "success" && state.revision !== undefined) setRevision(state.revision);
  }, [state]);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    company: opportunity?.company ?? "",
    name: opportunity?.name ?? "",
    email: opportunity?.email ?? "",
    phone: opportunity?.phone ?? "",
    primaryNeed: opportunity?.primaryNeed ?? "",
    source: opportunity ? (opportunity.source ?? "") : "Website",
    status: opportunity?.status ?? "NEW",
    contactChannel: opportunity?.contactChannel ?? "PHONE",
    ownerUserId: opportunity?.ownerUserId ?? (opportunity ? "" : currentUserId),
    receivedOn: opportunity?.receivedOn ?? today,
    nextAction: opportunity?.nextAction ?? "",
    followUpOn: opportunity?.followUpOn ?? "",
    closedReason: opportunity?.closedReason ?? "",
    note: ""
  }));
  const [separate, setSeparate] = useState(false);
  const change = (name: string, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    setSeparate(false);
  };
  const websiteForm = opportunity?.entryMethod === "WEBSITE_FORM";
  const field = (
    name: string,
    label: string,
    maxLength: number,
    type = "text",
    required = false
  ) => (
    <label className="block text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        value={values[name]}
        onChange={(event) => change(name, event.target.value)}
        className={inputClass}
      />
    </label>
  );
  const textarea = (name: string, label: string, maxLength: number, rows = 3) => (
    <label className="block text-sm font-medium">
      {label}
      <textarea
        name={name}
        maxLength={maxLength}
        rows={rows}
        value={values[name]}
        onChange={(event) => change(name, event.target.value)}
        className={inputClass}
        required={name === "closedReason" && values.status === "LOST"}
      />
    </label>
  );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="submissionId" value={opportunity?.id ?? ""} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="creationKey" value={key ?? ""} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <fieldset disabled={!canMutate || pending} className="space-y-4">
        <legend className="mb-3 font-semibold">Contact and enquiry</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("company", "Company", 200)}
          {field("name", "Contact name", 200)}
          {field("email", "Email", 320, "email")}
          {field("phone", "Phone", 64, "tel")}
        </div>
        {textarea("primaryNeed", "Services interested in / requirements", 2000)}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("source", "How they found us", 200)}
          <label className="block text-sm font-medium">
            Contact channel
            {websiteForm ? (
              <>
                <input type="hidden" name="contactChannel" value="WEBSITE_FORM" />
                <p className={inputClass}>Website form</p>
              </>
            ) : (
              <select
                name="contactChannel"
                value={values.contactChannel}
                onChange={(event) => change("contactChannel", event.target.value)}
                className={inputClass}
              >
                {Object.entries(CHANNEL_LABELS)
                  .filter(([key]) => key !== "WEBSITE_FORM")
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            )}
          </label>
          {field("receivedOn", "Enquiry date", 10, "date", true)}
          <label className="block text-sm font-medium">
            Owner
            <select
              name="ownerUserId"
              value={values.ownerUserId}
              onChange={(event) => change("ownerUserId", event.target.value)}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-mutedForeground">
          For example: source Website, channel Phone. Add an email or a phone number when available.
        </p>
        <div className="border-t border-border pt-4">
          <h3 className="mb-3 font-semibold">Progress and follow-up</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Status
              <select
                name="status"
                value={values.status}
                onChange={(event) => change("status", event.target.value)}
                className={inputClass}
              >
                {Object.entries(STATUS_LABELS)
                  .filter(
                    ([key]) =>
                      !["REVIEWED", "CONVERTED", "CLOSED"].includes(key) ||
                      key === opportunity?.status
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            {field("followUpOn", "Follow-up date", 10, "date")}
          </div>
          <div className="mt-3">{textarea("nextAction", "Next action", 1000, 2)}</div>
          <div className="mt-3">
            {textarea(
              "closedReason",
              values.status === "LOST" ? "Lost reason (required)" : "Outcome / closure reason",
              1000,
              2
            )}
          </div>
          <p className="mt-2 text-xs text-mutedForeground">
            Follow-up dates use Toronto time. Won is recorded manually.
          </p>
        </div>
        {!opportunity && textarea("note", "Initial note (optional)", 5000)}
        {state.duplicates?.length ? (
          <div className="space-y-3 rounded-md border border-warning/30 bg-warning/10 p-3">
            <p className="text-sm font-semibold">Possible existing opportunities</p>
            <ul className="space-y-1 text-sm">
              {state.duplicates.map((match) => (
                <li key={match.id}>
                  <Link
                    className="text-primary underline"
                    href={`/website-inbound?view=ALL&selected=${encodeURIComponent(match.id)}`}
                  >
                    {match.label}
                  </Link>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="separate"
                checked={separate}
                onChange={(event) => setSeparate(event.target.checked)}
                className="mt-1"
              />
              This is a separate enquiry. Create another opportunity.
            </label>
          </div>
        ) : null}
        {canMutate ? (
          <button className={buttonClass} disabled={pending}>
            {pending ? "Saving…" : opportunity ? "Save opportunity" : "Add opportunity"}
          </button>
        ) : (
          <p className="text-sm text-mutedForeground">You have view-only access.</p>
        )}
      </fieldset>
      <ActionMessage state={state} />
    </form>
  );
}

export function NoteComposer({ submissionId }: { submissionId: string }) {
  const [state, action, pending] = useActionState(addOpportunityNoteAction, EMPTY_ACTION_STATE);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (state.status === "success") setNote("");
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="submissionId" value={submissionId} />
      <label className="block text-sm font-medium">
        Add a note
        <textarea
          name="note"
          required
          maxLength={5000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          className={inputClass}
          disabled={pending}
          placeholder="Call details, requirements, quote discussion, or next steps…"
        />
      </label>
      <button className={buttonClass} disabled={pending}>
        {pending ? "Adding…" : "Add note"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function ActionMessage({ state }: { state: OpportunityActionState }) {
  return state.message ? (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`rounded-md border p-3 text-sm ${state.status === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-border bg-muted/30"}`}
    >
      {state.message}
    </p>
  ) : null;
}
