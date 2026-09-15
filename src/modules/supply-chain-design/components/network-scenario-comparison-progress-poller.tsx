"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  resumeSupplyChainDesignNetworkScenarioComparisonAction,
  startSupplyChainDesignNetworkScenarioComparisonRateBatchAction
} from "@/modules/supply-chain-design/actions";

export function SupplyChainDesignNetworkScenarioComparisonProgressPoller({
  projectId,
  comparisonRunId,
  batchId,
  initialStatus,
  initialRated,
  initialProcessed,
  initialIssues,
  total
}: {
  projectId: string;
  comparisonRunId: string;
  batchId: string;
  initialStatus: string;
  initialRated: number;
  initialProcessed: number;
  initialIssues: number;
  total: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [rated, setRated] = useState(initialRated);
  const [processed, setProcessed] = useState(initialProcessed);
  const [issues, setIssues] = useState(initialIssues);
  const [requestTotal, setRequestTotal] = useState(total);
  const [stage, setStage] = useState(initialStatus === "QUEUED" ? "Preparing LTL requests" : "Requesting 7L rates");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const startInFlight = useRef(false);
  const started = useRef(initialStatus !== "QUEUED");
  const resumeInFlight = useRef(false);
  const resumed = useRef(false);
  const isActive = status === "QUEUED" || status === "RUNNING";
  const progress = requestTotal > 0 ? Math.min(100, Math.round((processed / requestTotal) * 100)) : 0;

  useEffect(() => {
    const resume = async () => {
      if (resumeInFlight.current || resumed.current) return;
      resumeInFlight.current = true;
      setStage("Reconciling rated lanes");
      try {
        const result = await resumeSupplyChainDesignNetworkScenarioComparisonAction({ projectId, comparisonRunId });
        setMessage(result.message);
        resumed.current = true;
        router.refresh();
      } finally {
        resumeInFlight.current = false;
      }
    };
    const startQueuedBatch = async () => {
      if (startInFlight.current || started.current) return;
      startInFlight.current = true;
      try {
        const result = await startSupplyChainDesignNetworkScenarioComparisonRateBatchAction({ projectId, comparisonRunId, batchId });
        setMessage(result.message);
        started.current = true;
        router.refresh();
      } finally {
        startInFlight.current = false;
      }
    };

    const poll = async () => {
      if (inFlight.current || resumed.current) return;
      inFlight.current = true;
      try {
        const response = await fetch(`/supply-chain-design/${projectId}/ltl-rate-batches/${batchId}/status`, {
          cache: "no-store"
        });
        if (!response.ok) return;
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
        if (data.status === "QUEUED") {
          await startQueuedBatch();
        }
        if (data.status === "SUCCESS" || data.status === "ERROR") {
          await resume();
        }
      } finally {
        inFlight.current = false;
      }
    };

    void poll();
    if (!isActive) return;
    const timer = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer);
  }, [batchId, comparisonRunId, isActive, projectId, router]);

  if (!isActive && !resumeInFlight.current && !message) return null;

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-background p-3">
      <p className="text-sm font-semibold text-foreground">Network Scenario Comparison progress</p>
      <p className="text-sm text-foreground">{stage}</p>
      <div className="h-3 overflow-hidden rounded-full border border-border bg-muted" aria-label={`Network Scenario Comparison progress ${progress}%`}>
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mutedForeground">
        <span>{processed} of {requestTotal} requests completed ({progress}%)</span>
        <span>Rated {rated}</span>
        {issues > 0 ? <span>Issues {issues}</span> : null}
      </div>
      {message ? <p className="text-xs text-mutedForeground">{message}</p> : null}
    </div>
  );
}
