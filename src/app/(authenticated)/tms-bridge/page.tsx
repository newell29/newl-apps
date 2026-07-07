"use client";

import { useState, useTransition } from "react";
import { PageHeader } from "@/components/page-header";
import {
  runTmsAutomationTestAction,
  type TmsAutomationResult
} from "@/modules/tms-bridge/actions";

export const dynamic = "force-dynamic";

export default function TmsBridgePage() {
  const [rawEmailInquiry, setRawEmailInquiry] = useState("");
  const [result, setResult] = useState<TmsAutomationResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAutomationTest() {
    setResult(null);
    startTransition(async () => {
      const nextResult = await runTmsAutomationTestAction(rawEmailInquiry);
      setResult(nextResult);
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="TMS Bridge"
        title="TMS Bridge Dashboard"
        description="Workspace for automated intake, triage, and routing of incoming email inquiries."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Manual automation test</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Paste an incoming freight inquiry and send it to the local OpenClaw gateway using the
              process_freight_inquiry skill.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
            Local gateway
          </span>
        </div>

        <label className="mt-5 block space-y-2 text-sm font-medium text-foreground">
          <span>Paste Raw Email Inquiry Here</span>
          <textarea
            value={rawEmailInquiry}
            onChange={(event) => setRawEmailInquiry(event.target.value)}
            rows={12}
            placeholder="Paste the full customer email inquiry here..."
            className="min-h-72 w-full rounded-md border border-border bg-background px-3 py-3 text-sm leading-6 text-foreground shadow-sm outline-none transition-colors placeholder:text-mutedForeground focus:border-accentBorder focus:ring-2 focus:ring-accentSoft"
          />
        </label>

        <div className="mt-4">
          <button
            type="button"
            onClick={runAutomationTest}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Run TMS Automation Test
          </button>
        </div>

        {isPending ? (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-warning/25 bg-warning/10 px-4 py-3 text-sm font-semibold text-warning">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-warning/30 border-t-warning" />
            OpenClaw is logging into TMS...
          </div>
        ) : null}

        {result?.ok ? (
          <div className="mt-4 rounded-md border border-success/25 bg-success/10 px-4 py-3 text-sm text-foreground">
            <p className="font-semibold text-success">Automation completed successfully.</p>
            <p className="mt-1">
              TMS File Number: <span className="font-bold">{result.tmsFileNumber}</span>
            </p>
            {result.message ? <p className="mt-2 text-mutedForeground">{result.message}</p> : null}
          </div>
        ) : null}

        {result && !result.ok ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-semibold">Automation failed.</p>
            <p className="mt-1">{result.error}</p>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard label="Inbox intake" value="Planned" />
        <StatusCard label="Automation rules" value="Planned" />
        <StatusCard label="TMS handoff" value="Planned" />
      </section>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
