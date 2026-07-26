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
            <h2 className="font-semibold text-foreground">Hunter remains dry-run only</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              The Mac mini can now discover and classify public opportunity signals before Hunter ranks
              who it would pursue and why. It still does not enrich contacts, write to Apollo, enroll
              cadences, or send messages.
            </p>
          </div>
          <span className="rounded-full border border-warning/30 bg-card px-3 py-1 text-xs font-semibold text-warning">
            {policy.killSwitch ? "Kill switch active" : policy.mode.replace("_", " ")}
          </span>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">External signal scout</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              When enabled, Hunter searches recent public expansion, facility, retail-rollout,
              manufacturing, and leadership news, then classifies a bounded evidence set on the Mac
              mini with structured output. The local default is Qwen 3 30B Instruct.
            </p>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
            {data.latestSignalScoutRun
              ? `${data.latestSignalScoutRun.status} ${data.latestSignalScoutRun.startedAt.toLocaleString("en-US")}`
              : "Not run yet"}
          </span>
        </div>
        {data.latestSignalScoutRun ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="Candidates" value={jobOutputNumber(data.latestSignalScoutRun.output, "candidateCount")} />
            <Metric label="Accepted" value={jobOutputNumber(data.latestSignalScoutRun.output, "acceptedCount")} />
            <Metric
              label="Below threshold"
              value={jobOutputNumber(data.latestSignalScoutRun.output, "belowThresholdCount")}
            />
            <Metric label="Rejected" value={jobOutputNumber(data.latestSignalScoutRun.output, "rejectedCount")} />
            <Metric label="Model" value={jobOutputModel(data.latestSignalScoutRun.output)} />
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Company deep research</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Hunter researches the policy-sized daily company queue through identity, fresh-event,
              first-party careers, and distribution-footprint passes. Local Qwen synthesizes the
              evidence, deterministic rules block unsafe candidates, and Kimi scores only the
              survivors. Every query, source, excerpt, model version, token count, and gate result is
              retained. This stage still cannot contact Apollo or change a pipeline stage.
            </p>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
            {data.latestCompanyResearchRun
              ? `${data.latestCompanyResearchRun.status} ${data.latestCompanyResearchRun.startedAt.toLocaleString("en-US")}`
              : "Not run yet"}
          </span>
        </div>
        {data.latestCompanyResearchRun ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Metric
              label="Researched"
              value={jobOutputNumber(data.latestCompanyResearchRun.output, "researchedCount")}
            />
            <Metric
              label="Accepted"
              value={jobOutputNumber(data.latestCompanyResearchRun.output, "acceptedCount")}
            />
            <Metric
              label="Blocked"
              value={jobOutputNumber(data.latestCompanyResearchRun.output, "blockedCount")}
            />
            <Metric
              label="Evidence"
              value={jobOutputNumber(data.latestCompanyResearchRun.output, "evidenceCount")}
            />
            <Metric
              label="Missing"
              value={jobOutputNumber(data.latestCompanyResearchRun.output, "missingCompanyCount")}
            />
            <Metric
              label="Models"
              value={jobOutputResearchModels(data.latestCompanyResearchRun.output)}
            />
          </div>
        ) : null}
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
              <ResearchEvidencePanel value={signal.evidence} />
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

function jobOutputNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? String(field) : "—";
}

function jobOutputModel(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const model = (value as Record<string, unknown>).model;
  if (!model || typeof model !== "object" || Array.isArray(model)) return "—";
  const name = (model as Record<string, unknown>).name;
  return typeof name === "string" ? name : "—";
}

function jobOutputResearchModels(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const models = (value as Record<string, unknown>).models;
  if (!models || typeof models !== "object" || Array.isArray(models)) return "—";
  const synthesis = (models as Record<string, unknown>).synthesis;
  const scoring = (models as Record<string, unknown>).scoring;
  const name = (model: unknown) =>
    model && typeof model === "object" && !Array.isArray(model)
      ? (model as Record<string, unknown>).name
      : null;
  const names = [name(synthesis), name(scoring)].filter((item): item is string => typeof item === "string");
  return names.length ? names.join(" + ") : "—";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function ResearchEvidencePanel({ value }: { value: unknown }) {
  const research = researchRecord(value);
  if (!research) return null;
  const evidence = Array.isArray(research.evidence)
    ? research.evidence.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  const gate = researchRecord(research.deterministicGate);
  const scoring = researchRecord(research.scoring);
  const models = researchRecord(research.models);
  const synthesisModel = researchRecord(models?.synthesis);
  const scoringModel = researchRecord(models?.scoring);
  const blockers = gate && Array.isArray(gate.blockers)
    ? gate.blockers.filter((item): item is string => typeof item === "string")
    : [];

  return (
    <details className="mt-3 rounded-md border border-border bg-card p-3">
      <summary className="cursor-pointer text-xs font-semibold text-primary">
        Show research ledger ({evidence.length} evidence records)
      </summary>
      <div className="mt-3 grid gap-3 text-xs">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-border bg-muted px-2 py-1">
            Gate: {gate?.passed === true ? "passed" : "blocked"}
          </span>
          <span className="rounded-full border border-border bg-muted px-2 py-1">
            Final score: {typeof research.finalScore === "number" ? research.finalScore : "—"}
          </span>
          <span className="rounded-full border border-border bg-muted px-2 py-1">
            Models: {typeof synthesisModel?.name === "string" ? synthesisModel.name : "—"} +{" "}
            {typeof scoringModel?.name === "string" ? scoringModel.name : "—"}
          </span>
          <span className="rounded-full border border-border bg-muted px-2 py-1">
            Kimi tokens: {modelTokenTotal(scoringModel)}
          </span>
        </div>
        {typeof scoring?.rationale === "string" ? (
          <p className="leading-5 text-mutedForeground">{scoring.rationale}</p>
        ) : null}
        {blockers.length ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
            <p className="font-semibold text-foreground">Deterministic blockers</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-mutedForeground">
              {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="grid gap-2">
          {evidence.map((item, index) => {
            const url = typeof item.url === "string" && item.url.startsWith("https://") ? item.url : null;
            return (
              <article key={`${url ?? "evidence"}-${index}`} className="rounded-md border border-border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {typeof item.pass === "string" ? formatEnum(item.pass) : "Evidence"}
                  </span>
                  {typeof item.sourceType === "string" ? (
                    <span className="rounded-full border border-border bg-card px-2 py-0.5">
                      {formatEnum(item.sourceType)}
                    </span>
                  ) : null}
                </div>
                {typeof item.query === "string" ? (
                  <p className="mt-2 break-words font-mono text-[11px] text-mutedForeground">
                    Query: {item.query}
                  </p>
                ) : null}
                <p className="mt-2 font-medium text-foreground">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
                      {typeof item.title === "string" ? item.title : url}
                    </a>
                  ) : typeof item.title === "string" ? item.title : "Evidence source"}
                </p>
                {typeof item.excerpt === "string" ? (
                  <p className="mt-1 leading-5 text-mutedForeground">{item.excerpt}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function researchRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if ("research" in record) {
    const nested = record.research;
    return nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : null;
  }
  return record;
}

function modelTokenTotal(value: Record<string, unknown> | null) {
  if (!value) return "—";
  const input = typeof value.inputTokens === "number" ? value.inputTokens : 0;
  const output = typeof value.outputTokens === "number" ? value.outputTokens : 0;
  return input || output ? String(input + output) : "—";
}
