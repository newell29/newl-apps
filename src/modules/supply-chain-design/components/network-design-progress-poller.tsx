"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SupplyChainDesignNetworkDesignProgressPoller({
  projectId,
  batchId,
  initialStatus,
  initialRated,
  initialProcessed: _initialProcessed,
  initialIssues: _initialIssues,
  total,
  initialStage,
  title
}: {
  projectId: string;
  batchId: string;
  initialStatus: string;
  initialRated: number;
  initialProcessed: number;
  initialIssues: number;
  total: number;
  initialStage?: string;
  title?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [rated, setRated] = useState(initialRated);
  const [processed, setProcessed] = useState(_initialProcessed);
  const [issues, setIssues] = useState(_initialIssues);
  const [requestTotal, setRequestTotal] = useState(total);
  const [stage, setStage] = useState(initialStage ?? (initialStatus === "QUEUED" ? "Preparing LTL requests" : "Requesting 7L rates"));
  const inFlight = useRef(false);
  const refreshed = useRef(false);
  const wasActive = useRef(initialStatus === "QUEUED" || initialStatus === "RUNNING");
  const isActive = status === "QUEUED" || status === "RUNNING";
  const progress = requestTotal > 0 ? Math.min(100, Math.round((processed / requestTotal) * 100)) : 0;

  useEffect(() => {
    if (!isActive) return;
    const poll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch(`/supply-chain-design/${projectId}/ltl-rate-batches/${batchId}/status`, {
          cache: "no-store"
        });
        if (response.ok) {
          const data = (await response.json()) as {
            status?: string;
            processed?: number;
            rated?: number;
            issues?: number;
            total?: number;
            stage?: string;
          };
          if (typeof data.status === "string") setStatus(data.status);
          if (typeof data.processed === "number") setProcessed((current) => Math.max(current, data.processed ?? 0));
          if (typeof data.rated === "number") setRated((current) => Math.max(current, data.rated ?? 0));
          if (typeof data.issues === "number") setIssues((current) => Math.max(current, data.issues ?? 0));
          if (typeof data.total === "number") setRequestTotal((current) => Math.max(current, data.total ?? 0));
          if (typeof data.stage === "string") setStage(data.stage);
          if ((data.status === "SUCCESS" || data.status === "ERROR") && !refreshed.current) {
            refreshed.current = true;
            router.refresh();
          }
        }
      } finally {
        inFlight.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer);
  }, [batchId, isActive, projectId, router]);

  useEffect(() => {
    if (wasActive.current && !isActive && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
    wasActive.current = isActive;
  }, [isActive, router]);

  if (!isActive) return null;

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-background p-3">
      {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
      <p className="text-sm text-foreground">{stage}</p>
      <div className="h-3 overflow-hidden rounded-full border border-border bg-muted" aria-label={`Network Design progress ${progress}%`}>
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mutedForeground">
        <span>{processed} of {requestTotal} requests completed ({progress}%)</span>
        <span>Rated {rated}</span>
        {issues > 0 ? <span>Issues {issues}</span> : null}
      </div>
    </div>
  );
}
