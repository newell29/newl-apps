import {
  HunterAutomationMode,
  HunterServiceLine,
  HunterSignalType,
  ModuleKey,
  PlatformRole
} from "@prisma/client";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import {
  addHunterOpportunitySignalAction,
  runHunterDryPlanAction,
  saveHunterPolicyAction
} from "@/modules/lead-gen/hunter-actions";
import { getHunterControlPlane } from "@/modules/lead-gen/hunter-queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";

export default async function HunterPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const data = await getHunterControlPlane(context);
  const policy = data.policy;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Hunter"
        description="Build a small, evidence-backed prospecting plan from TradeMining and external opportunity signals before any contact research or outreach is authorized."
      />

      <section className="rounded-lg border border-warning/25 bg-warning/10 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-foreground">Phase 1 is dry-run only</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Hunter ranks who it would pursue and why. It does not enrich contacts, write to Apollo,
              enroll cadences, or send messages.
            </p>
          </div>
          <span className="rounded-full border border-warning/30 bg-card px-3 py-1 text-xs font-semibold text-warning">
            {policy.killSwitch ? "Kill switch active" : policy.mode.replace("_", " ")}
          </span>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="border-b border-border pb-4">
            <h2 className="text-base font-semibold text-foreground">Planning policy</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              Daily mix: 60% warehousing, 30% ocean/air, 10% trucking. Empty buckets are backfilled by
              the next-highest qualified opportunity.
            </p>
          </div>

          {context.role === PlatformRole.ADMIN ? (
            <form action={saveHunterPolicyAction} className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Mode">
                  <select name="mode" defaultValue={policy.mode} className={inputClass}>
                    <option value={HunterAutomationMode.DRY_RUN}>Dry run</option>
                    <option value={HunterAutomationMode.OFF}>Off</option>
                  </select>
                </Field>
                <Field label="Daily company limit">
                  <input
                    name="dailyCompanyLimit"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={policy.dailyCompanyLimit}
                    className={inputClass}
                  />
                </Field>
                <Field label="Max contacts per company">
                  <input
                    name="maxContactsPerCompany"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={policy.maxContactsPerCompany}
                    className={inputClass}
                  />
                </Field>
                <Field label="Schedule timezone">
                  <input
                    name="scheduleTimezone"
                    defaultValue={policy.scheduleTimezone}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <PercentField name="warehousingPercent" label="Warehousing %" value={policy.warehousingPercent} />
                <PercentField name="oceanAirPercent" label="Ocean / air %" value={policy.oceanAirPercent} />
                <PercentField name="truckingPercent" label="Trucking %" value={policy.truckingPercent} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <PercentField
                  name="minimumPriorityScore"
                  label="Minimum priority score"
                  value={policy.minimumPriorityScore}
                />
                <PercentField
                  name="minimumSignalConfidence"
                  label="Minimum signal confidence"
                  value={policy.minimumSignalConfidence}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input name="killSwitch" type="checkbox" defaultChecked={policy.killSwitch} />
                Stop all Hunter planning runs
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
                  Save policy
                </button>
                {!data.policyIsStored ? (
                  <span className="text-xs text-mutedForeground">Showing safe defaults until first save.</span>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="mt-4 text-sm text-mutedForeground">Only tenant admins can change Hunter policy.</p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="border-b border-border pb-4">
            <h2 className="text-base font-semibold text-foreground">Add an external signal</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Capture expansions, store rollouts, facilities, hiring, leadership changes, leases, or
              other evidence. This is intentionally independent of TradeMining.
            </p>
          </div>
          <form action={addHunterOpportunitySignalAction} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company">
                <input name="companyName" required maxLength={200} className={inputClass} />
              </Field>
              <Field label="Signal type">
                <select name="signalType" defaultValue={HunterSignalType.EXPANSION} className={inputClass}>
                  {Object.values(HunterSignalType)
                    .filter((value) => value !== HunterSignalType.TRADEMINING)
                    .map((value) => (
                      <option key={value} value={value}>
                        {formatEnum(value)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Service line">
                <select name="serviceLine" defaultValue={HunterServiceLine.WAREHOUSING} className={inputClass}>
                  {Object.values(HunterServiceLine).map((value) => (
                    <option key={value} value={value}>
                      {formatEnum(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Confidence (0-100)">
                <input name="confidence" type="number" min={0} max={100} defaultValue={70} className={inputClass} />
              </Field>
            </div>
            <Field label="Opportunity title">
              <input name="title" required maxLength={300} className={inputClass} />
            </Field>
            <Field label="Why this may create demand">
              <textarea name="summary" required maxLength={2000} rows={4} className={inputClass} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Geography">
                <input name="geography" maxLength={200} placeholder="Charlotte, NC" className={inputClass} />
              </Field>
              <Field label="Source name">
                <input name="sourceName" maxLength={200} placeholder="Company newsroom" className={inputClass} />
              </Field>
            </div>
            <Field label="Source URL">
              <input name="sourceUrl" type="url" maxLength={2000} className={inputClass} />
            </Field>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
              Save signal
            </button>
          </form>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Latest prospecting plan</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              {data.latestRun
                ? `${data.latestRun.status} at ${data.latestRun.startedAt.toLocaleString("en-US")}`
                : "No dry-run plan has been generated yet."}
            </p>
          </div>
          <form action={runHunterDryPlanAction}>
            <button
              disabled={policy.killSwitch || policy.mode === HunterAutomationMode.OFF}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate dry-run plan
            </button>
          </form>
        </div>

        {data.latestRun?.hunterProspectingDecisions.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-3 py-3">Rank</th>
                  <th className="px-3 py-3">Company</th>
                  <th className="px-3 py-3">Service</th>
                  <th className="px-3 py-3">Score</th>
                  <th className="px-3 py-3">Opportunity</th>
                  <th className="px-3 py-3">Evidence</th>
                  <th className="px-3 py-3">Recommended buyer</th>
                </tr>
              </thead>
              <tbody>
                {data.latestRun.hunterProspectingDecisions.map((decision) => (
                  <tr key={decision.id} className="border-b border-border align-top">
                    <td className="px-3 py-4 font-semibold text-primary">#{decision.rank}</td>
                    <td className="px-3 py-4 font-semibold text-foreground">{decision.companyName}</td>
                    <td className="px-3 py-4">{formatEnum(decision.serviceLine)}</td>
                    <td className="px-3 py-4">
                      {decision.priorityScore} <span className="text-xs text-mutedForeground">({decision.confidence}% confidence)</span>
                    </td>
                    <td className="max-w-sm px-3 py-4">
                      <p className="font-medium text-foreground">{decision.opportunityType}</p>
                      <p className="mt-1 text-xs leading-5 text-mutedForeground">{decision.rationale}</p>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {jsonStringArray(decision.sourceTypes).map((source) => (
                          <span key={source} className="rounded-full border border-border bg-muted px-2 py-1 text-xs">
                            {formatEnum(source)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-4 text-xs leading-5 text-mutedForeground">
                      {decision.recommendedPersona}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-mutedForeground">
            A successful empty plan means no companies cleared the current score, confidence, suppression,
            and active-conversation gates.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Signal inbox</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              {data.signals.length} recent signals · {data.activeSuppressionCount} active suppressions ·{" "}
              {data.decisionCount} total dry-run selections
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          {data.signals.map((signal) => (
            <article key={signal.id} className="rounded-md border border-border bg-muted p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">{signal.companyName}</h3>
                  <p className="mt-1 text-sm text-foreground">{signal.title}</p>
                  <p className="mt-1 max-w-4xl text-xs leading-5 text-mutedForeground">{signal.summary}</p>
                </div>
                <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold">
                  {signal.confidence}% · {formatEnum(signal.serviceLine)}
                </span>
              </div>
              <p className="mt-2 text-xs text-mutedForeground">
                {formatEnum(signal.signalType)} · observed {signal.observedAt.toLocaleString("en-US")}
                {signal.geography ? ` · ${signal.geography}` : ""}
                {signal.sourceUrl ? (
                  <>
                    {" · "}
                    <a className="text-primary underline" href={signal.sourceUrl} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </>
                ) : null}
              </p>
            </article>
          ))}
          {data.signals.length === 0 ? (
            <p className="text-sm text-mutedForeground">
              No external signals yet. TradeMining evidence can still produce a plan.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-foreground">
      {label}
      {children}
    </label>
  );
}

function PercentField({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <Field label={label}>
      <input name={name} type="number" min={0} max={100} defaultValue={value} className={inputClass} />
    </Field>
  );
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
