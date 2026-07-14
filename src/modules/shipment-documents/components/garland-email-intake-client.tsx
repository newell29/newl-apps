"use client";

import { useEffect, useRef, useState } from "react";

type GarlandEmailIntakeAttachment = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  intakeStatus: string | null;
  pageCount: number | null;
  createdAt: string;
};

type GarlandEmailIntakeEmail = {
  id: string;
  mailboxAddress: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string;
  webLink: string | null;
  classification: string;
  classificationReason: string | null;
  candidateScore: number;
  hasPdfAttachment: boolean;
  expectedOrderCount: number | null;
  expectedPageCount: number | null;
  expectedPsStart: string | null;
  expectedPsEnd: string | null;
  attachments: GarlandEmailIntakeAttachment[];
};

type GarlandEmailIntakeGroup = {
  id: string;
  batchKey: string;
  classification: string;
  emailCount: number;
  duplicateCount: number;
  hasPdfAttachment: boolean;
  expectedOrderCount: number | null;
  expectedPageCount: number | null;
  expectedPsStart: string | null;
  expectedPsEnd: string | null;
  primaryEmail: GarlandEmailIntakeEmail;
  emails: GarlandEmailIntakeEmail[];
};

type GarlandEmailIntakeResponse = {
  groups?: GarlandEmailIntakeGroup[];
  emails?: GarlandEmailIntakeEmail[];
  totalCount?: number;
  rawEmailCount?: number;
  latestRun?: {
    id: string;
    mailboxAddress: string;
    status: string;
    messageCount: number;
    candidateMessageCount: number;
    storedEmailCount: number;
    createdEmailCount: number;
    updatedEmailCount: number;
    attachmentCount: number;
    storedAttachmentCount: number;
    duplicateAttachmentCount: number;
    errorMessage: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  sync?: {
    runId: string;
    status: string;
    mailboxAddress: string;
    messageCount: number;
    candidateMessageCount: number;
    storedEmailCount: number;
    createdEmailCount: number;
    updatedEmailCount: number;
    attachmentCount: number;
    storedAttachmentCount: number;
    duplicateAttachmentCount: number;
    attachmentErrors: number;
    failures: Array<{ mailbox: string; reason: string }>;
  };
  error?: string;
};

const AUTO_SYNC_STALE_MINUTES = 10;

export function GarlandEmailIntakeClient() {
  const [emailIntake, setEmailIntake] = useState<GarlandEmailIntakeResponse>({ groups: [], emails: [], totalCount: 0, rawEmailCount: 0 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading Garland email intake...");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const autoSyncStartedRef = useRef(false);

  useEffect(() => {
    if (autoSyncStartedRef.current) return;
    autoSyncStartedRef.current = true;

    void loadAndMaybeAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAndMaybeAutoSync() {
    const latest = await fetchEmailIntake("");
    if (!latest) return;

    if (shouldAutoSync(latest.latestRun)) {
      await syncGarlandEmailIntake(true);
    } else {
      setStatus("Email intake is current. New batches are grouped by PS range so duplicate follow-ups stay together.");
    }
  }

  async function fetchEmailIntake(searchValue = search) {
    setError(null);
    setIsLoading(true);

    try {
      const params = new URLSearchParams();
      if (searchValue.trim()) {
        params.set("search", searchValue.trim());
      }
      params.set("limit", "75");
      const response = await fetch(`/api/shipment-documents/teamship-review/email-intake?${params.toString()}`);
      const json = (await response.json().catch(() => null)) as GarlandEmailIntakeResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to load Garland email intake.");
      }

      setEmailIntake(json);
      setStatus(`Showing ${json.totalCount ?? 0} grouped Garland batch candidate(s) from ${json.rawEmailCount ?? 0} source email(s).`);
      return json;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to load Garland email intake.";
      setError(message);
      setStatus("Email intake could not be loaded.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function syncGarlandEmailIntake(isAutomatic = false) {
    setError(null);
    setIsSyncing(true);
    setStatus(isAutomatic ? "Auto-scanning warehouse mailbox for new Garland PDFs..." : "Scanning warehouse mailbox for Garland PDFs...");

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/email-intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lookbackDays: 7, maxMessagesPerMailbox: 100 })
      });
      const json = (await response.json().catch(() => null)) as GarlandEmailIntakeResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to sync Garland email intake.");
      }

      setEmailIntake(json);
      setStatus(
        json.sync
          ? `Scan complete: ${json.sync.candidateMessageCount} candidate email(s), ${json.totalCount ?? 0} grouped batch(es), ${json.sync.storedAttachmentCount} attachment record(s), ${json.sync.duplicateAttachmentCount} duplicate attachment(s).`
          : "Garland email scan finished."
      );
      return json;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to sync Garland email intake.";
      setError(message);
      setStatus("Garland email intake sync stopped.");
      return null;
    } finally {
      setIsSyncing(false);
    }
  }

  const groups = emailIntake.groups ?? [];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Garland email intake</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Newl Apps scans the configured Microsoft 365 mailbox for Garland PDF batches, groups follow-ups by PS range,
              and keeps duplicate email threads together before they become review work.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              {emailIntake.totalCount ?? 0} grouped batches
            </span>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold uppercase tracking-wide text-mutedForeground">
              {emailIntake.rawEmailCount ?? 0} source emails
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr,auto,auto]">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void fetchEmailIntake();
              }
            }}
            placeholder="Search subject, sender, PS range, or attachment"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void fetchEmailIntake()}
            disabled={isLoading || isSyncing}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Searching..." : "Search intake"}
          </button>
          <button
            type="button"
            onClick={() => void syncGarlandEmailIntake(false)}
            disabled={isLoading || isSyncing}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSyncing ? "Scanning..." : "Scan now"}
          </button>
        </div>

        <div className="mt-4 rounded-md border border-border bg-muted/25 px-4 py-3 text-sm text-mutedForeground">
          <p className="font-medium text-foreground">{status}</p>
          {emailIntake.latestRun ? (
            <p className="mt-1 text-xs">
              Last scan: {emailIntake.latestRun.status.toLowerCase()} · {formatDateTime(emailIntake.latestRun.startedAt)} ·{" "}
              {emailIntake.latestRun.candidateMessageCount} candidate email(s) · {emailIntake.latestRun.storedAttachmentCount} attachment record(s)
              {emailIntake.latestRun.errorMessage ? ` · ${emailIntake.latestRun.errorMessage}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs">No mailbox scan has been recorded yet. This page auto-scans when opened.</p>
          )}
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {error}
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {groups.length > 0 ? (
          <div className="divide-y divide-border">
            {groups.map((group) => (
              <EmailIntakeGroupRow key={group.id} group={group} />
            ))}
          </div>
        ) : (
          <div className="bg-muted/30 px-5 py-8 text-sm text-mutedForeground">
            {isLoading || isSyncing
              ? "Checking the mailbox for Garland batches..."
              : "No Garland email batches have been detected for the current search."}
          </div>
        )}
      </section>
    </div>
  );
}

function EmailIntakeGroupRow({ group }: { group: GarlandEmailIntakeGroup }) {
  const email = group.primaryEmail;
  const attachments = group.emails.flatMap((sourceEmail) => sourceEmail.attachments);

  return (
    <details className="group bg-background" open={group.hasPdfAttachment}>
      <summary className="grid cursor-pointer gap-4 px-5 py-4 transition-colors hover:bg-muted/40 lg:grid-cols-[minmax(0,1.4fr),minmax(220px,0.75fr),minmax(260px,0.9fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={emailBadgeClass(group.classification)}>
              {formatEmailClassification(group.classification)}
            </span>
            {group.duplicateCount > 0 ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                {group.duplicateCount} follow-up{group.duplicateCount === 1 ? "" : "s"} grouped
              </span>
            ) : null}
            <span className="text-xs font-semibold text-mutedForeground">Score {email.candidateScore}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-foreground">{email.subject}</p>
          <p className="mt-1 text-xs text-mutedForeground">
            {email.fromName || email.fromAddress || "Unknown sender"} · {formatDateTime(email.receivedAt)}
          </p>
        </div>
        <div className="text-sm text-foreground">
          <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">Expected batch</p>
          <p className="mt-1 font-semibold">
            {group.expectedPsStart && group.expectedPsEnd ? `${group.expectedPsStart} -> ${group.expectedPsEnd}` : "No PS range parsed"}
          </p>
          <p className="mt-1 text-xs text-mutedForeground">
            {group.expectedOrderCount ?? "?"} order(s) · {group.expectedPageCount ?? "?"} page(s)
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">Attachments</p>
          {attachments.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.slice(0, 4).map((attachment) => (
                <span key={attachment.id} className="rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground">
                  {attachment.fileName}
                </span>
              ))}
              {attachments.length > 4 ? (
                <span className="rounded-full bg-muted px-2 py-1 text-xs text-mutedForeground">+{attachments.length - 4} more</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-mutedForeground">No attachment metadata stored yet.</p>
          )}
        </div>
      </summary>

      <div className="border-t border-border bg-muted/20 px-5 py-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {group.emails.map((sourceEmail) => (
            <div key={sourceEmail.id} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-foreground">{sourceEmail.fromName || sourceEmail.fromAddress || "Unknown sender"}</p>
                <span className="text-xs text-mutedForeground">{formatDateTime(sourceEmail.receivedAt)}</span>
              </div>
              <p className="mt-1 text-xs text-mutedForeground">{sourceEmail.subject}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {sourceEmail.webLink ? (
                  <a href={sourceEmail.webLink} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:text-primaryHover">
                    Open email
                  </a>
                ) : null}
                <span className="text-xs text-mutedForeground">
                  {sourceEmail.attachments.length} attachment{sourceEmail.attachments.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function shouldAutoSync(latestRun: GarlandEmailIntakeResponse["latestRun"]) {
  if (!latestRun?.startedAt) return true;
  const startedAtMs = new Date(latestRun.startedAt).getTime();
  if (Number.isNaN(startedAtMs)) return true;
  return Date.now() - startedAtMs > AUTO_SYNC_STALE_MINUTES * 60 * 1000;
}

function isErrorResponse(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value && typeof (value as { error?: unknown }).error === "string");
}

function formatEmailClassification(value: string) {
  return value
    .replace(/^GARLAND_/, "")
    .replace(/_/g, " ")
    .toLowerCase();
}

function emailBadgeClass(classification: string) {
  const base = "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide";
  if (classification === "GARLAND_DOCUMENT_BATCH") return `${base} bg-emerald-100 text-emerald-700`;
  if (classification === "GARLAND_DOCUMENT_CORRECTION") return `${base} bg-amber-100 text-amber-700`;
  if (classification === "GARLAND_FOLLOW_UP") return `${base} bg-sky-100 text-sky-700`;
  return `${base} bg-muted text-mutedForeground`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
