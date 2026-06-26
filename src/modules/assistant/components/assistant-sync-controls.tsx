"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type SyncResult = {
  status: "success" | "partial";
  localDocumentCount: number;
  microsoftDocumentCount: number;
  microsoftMailCount: number;
  microsoftFileCount: number;
  localReason: string | null;
  microsoftReason: string | null;
};

type SyncResponse = {
  data?: SyncResult;
  error?: string;
};

const progressMessages = [
  "Starting sync",
  "Indexing app knowledge",
  "Checking Microsoft 365 settings",
  "Reading selected mailboxes",
  "Extracting customer memory",
  "Saving assistant knowledge"
];

export function AssistantKnowledgeSyncButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsedSeconds(0);
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [startedAt]);

  const progressMessage = useMemo(() => {
    if (!startedAt) {
      return null;
    }

    const index = Math.min(progressMessages.length - 1, Math.floor(elapsedSeconds / 8));
    return progressMessages[index];
  }, [elapsedSeconds, startedAt]);

  async function runSync() {
    setError(null);
    setStartedAt(Date.now());

    try {
      const response = await fetch("/api/assistant/knowledge/sync", {
        method: "POST",
        headers: {
          accept: "application/json"
        }
      });
      const payload = (await response.json().catch(() => null)) as SyncResponse | null;

      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error ?? `Knowledge sync failed with status ${response.status}.`);
      }

      const result = payload.data;
      const params = new URLSearchParams({
        sync: result.status,
        localDocs: String(result.localDocumentCount),
        microsoftDocs: String(result.microsoftDocumentCount),
        microsoftMail: String(result.microsoftMailCount),
        microsoftFiles: String(result.microsoftFileCount)
      });

      if (result.localReason) {
        params.set("localReason", result.localReason);
      }

      if (result.microsoftReason) {
        params.set("microsoftReason", result.microsoftReason);
      }

      startTransition(() => {
        router.replace(`/assistant?${params.toString()}`);
        router.refresh();
      });
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Knowledge sync failed for an unknown reason.");
    } finally {
      setStartedAt(null);
    }
  }

  const running = Boolean(startedAt) || isPending;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={runSync}
        disabled={running}
        className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? "Syncing..." : "Sync knowledge"}
      </button>
      {running ? (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-foreground">{progressMessage ?? "Syncing knowledge"}</p>
            <span className="text-xs font-medium text-primary">{elapsedSeconds}s</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
          <p className="mt-2 text-xs leading-5 text-mutedForeground">
            This can take a bit when Microsoft 365 mailboxes are included. Keep this tab open.
          </p>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-danger/25 bg-danger/10 p-3 text-xs leading-5 text-foreground">
          <p className="font-semibold">Knowledge sync failed</p>
          <p className="mt-1 text-mutedForeground">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
