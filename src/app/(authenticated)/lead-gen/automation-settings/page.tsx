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
  queueCurrentHunterOutreachHandoffAction,
  replayHunterLunaComparisonAction,
  runHunterDryPlanAction,
  saveHunterPolicyAction
} from "@/modules/lead-gen/hunter-actions";
import { getHunterControlPlane } from "@/modules/lead-gen/hunter-queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function AutomationSettingsPage({
  searchParams
}: {
  searchParams: Promise<{
    handoff?: string;
    count?: string;
    lunaReplay?: string;
    lunaCount?: string;
  }>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const query = await searchParams;
  const data = await getHunterControlPlane(context);
  const policy = data.policy;
  const handoffMessage = formatHandoffMessage(query.handoff, query.count);
  const lunaReplayMessage = formatLunaReplayMessage(
    query.lunaReplay,
    query.lunaCount
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin & Quality"
        title="Automation Settings"
        description="Control Hunter's daily limits, service mix, safety mode, and manual evidence inputs without mixing configuration into the sales team's daily work."
      />

      <section className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
        <p className="font-semibold text-foreground">
          {policy.killSwitch ? "Hunter is stopped by the kill switch." : `Hunter is operating in ${formatEnum(policy.mode)} mode.`}
        </p>
        <p className="mt-1 text-mutedForeground">
          These controls plan and research opportunities. They do not authorize customer communication.
        </p>
      </section>
      {handoffMessage ? (
        <section className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-foreground">
          {handoffMessage}
        </section>
      ) : null}
      {lunaReplayMessage ? (
        <section className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-foreground">
          {lunaReplayMessage}
        </section>
      ) : null}
      {data.latestSuccessfulCompanyResearchRun ? (
        <LunaComparison
          runId={data.latestSuccessfulCompanyResearchRun.id}
          summary={data.latestLunaShadowSummary}
          results={data.latestLunaShadow?.results ?? []}
        />
      ) : null}
      {data.latestOutreachHandoff ? (
        <LatestContactDiscoveryRun
          run={data.latestOutreachHandoff}
          timeZone={policy.scheduleTimezone}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="font-semibold text-foreground">Planning policy</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Target mix: 60% warehousing, 30% ocean / air, and 10% trucking. Empty buckets are backfilled by the next qualified opportunity.
          </p>
          {context.role === PlatformRole.ADMIN ? (
            <form action={saveHunterPolicyAction} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Mode">
                  <select name="mode" defaultValue={policy.mode} className={inputClass}>
                    <option value={HunterAutomationMode.ASSISTED}>Assisted</option>
                    <option value={HunterAutomationMode.DRY_RUN}>Dry run</option>
                    <option value={HunterAutomationMode.OFF}>Off</option>
                  </select>
                </Field>
                <Field label="Daily company limit">
                  <input name="dailyCompanyLimit" type="number" min={1} max={100} defaultValue={policy.dailyCompanyLimit} className={inputClass} />
                </Field>
                <Field label="Max contacts per company">
                  <input name="maxContactsPerCompany" type="number" min={1} max={3} defaultValue={Math.min(3, policy.maxContactsPerCompany)} className={inputClass} />
                </Field>
                <Field label="Schedule timezone">
                  <input name="scheduleTimezone" defaultValue={policy.scheduleTimezone} className={inputClass} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField name="warehousingPercent" label="Warehousing %" value={policy.warehousingPercent} />
                <NumberField name="oceanAirPercent" label="Ocean / air %" value={policy.oceanAirPercent} />
                <NumberField name="truckingPercent" label="Trucking %" value={policy.truckingPercent} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField name="minimumPriorityScore" label="Minimum priority score" value={policy.minimumPriorityScore} />
                <NumberField name="minimumSignalConfidence" label="Minimum signal confidence" value={policy.minimumSignalConfidence} />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input name="killSwitch" type="checkbox" defaultChecked={policy.killSwitch} />
                Stop all Hunter planning runs
              </label>
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
                Save policy
              </button>
              {!data.policyIsStored ? <p className="text-xs text-mutedForeground">Safe defaults are active until the first save.</p> : null}
              <p className="text-xs text-mutedForeground">
                Assisted mode automatically finds and ranks Apollo contacts and creates QA-checked outreach plans after research. One human approval then enrolls the contact in Apollo automatically.
              </p>
              <div className="border-t border-border pt-4">
                <button
                  formAction={queueCurrentHunterOutreachHandoffAction}
                  disabled={policy.killSwitch || policy.mode !== HunterAutomationMode.ASSISTED}
                  className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Recheck contacts for eligible opportunities
                </button>
                <p className="mt-2 text-xs text-mutedForeground">
                  Reruns organization-scoped Apollo employee searches for current Hot and Qualified companies with
                  completed Qwen synthesis and Kimi scoring, repeats AI contact review, and creates or refreshes plans
                  for selected contacts. Failed plans receive one automatic QA-guided rewrite in the same run. This
                  does not rerun Brave searches, Qwen research, or Kimi scoring, and it never sends outreach without
                  plan approval.
                </p>
              </div>
            </form>
          ) : (
            <p className="mt-4 text-sm text-mutedForeground">Only tenant admins can change this policy.</p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="font-semibold text-foreground">Add external evidence</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Add an expansion, facility, hiring, lease, leadership, or retail-rollout signal that Hunter should investigate independently of TradeMining.
          </p>
          <form action={addHunterOpportunitySignalAction} className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company"><input name="companyName" required maxLength={200} className={inputClass} /></Field>
              <Field label="Signal type">
                <select name="signalType" defaultValue={HunterSignalType.EXPANSION} className={inputClass}>
                  {Object.values(HunterSignalType).filter((value) => value !== HunterSignalType.TRADEMINING).map((value) => (
                    <option key={value} value={value}>{formatEnum(value)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Service line">
                <select name="serviceLine" defaultValue={HunterServiceLine.WAREHOUSING} className={inputClass}>
                  {Object.values(HunterServiceLine).map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
                </select>
              </Field>
              <NumberField name="confidence" label="Confidence (0-100)" value={70} />
            </div>
            <Field label="Opportunity title"><input name="title" required maxLength={300} className={inputClass} /></Field>
            <Field label="Why this may create demand"><textarea name="summary" required maxLength={2000} rows={4} className={inputClass} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Geography"><input name="geography" maxLength={200} placeholder="Charlotte, NC" className={inputClass} /></Field>
              <Field label="Source name"><input name="sourceName" maxLength={200} placeholder="Company newsroom" className={inputClass} /></Field>
            </div>
            <Field label="Source URL"><input name="sourceUrl" type="url" maxLength={2000} className={inputClass} /></Field>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">Save evidence</button>
          </form>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Manual dry-run control</h2>
            <p className="mt-1 text-sm text-mutedForeground">Generate a planning run for validation without waiting for the schedule.</p>
          </div>
          <form action={runHunterDryPlanAction}>
            <button
              disabled={policy.killSwitch || policy.mode === HunterAutomationMode.OFF}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:opacity-50"
            >
              Generate dry-run plan
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function LunaComparison({
  runId,
  summary,
  results
}: {
  runId: string;
  summary: Awaited<ReturnType<typeof getHunterControlPlane>>["latestLunaShadowSummary"];
  results: NonNullable<
    Awaited<ReturnType<typeof getHunterControlPlane>>["latestLunaShadow"]
  >["results"];
}) {
  return (
    <details className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <summary className="cursor-pointer font-semibold text-foreground">
        Luna primary vs Qwen shadow research comparison
        {summary
          ? ` · ${summary.evaluatedCompanyCount}/${summary.expectedCompanyCount} evaluated`
          : " · not completed"}
      </summary>
      <p className="mt-2 text-sm leading-6 text-mutedForeground">
        Luna is the authoritative evidence-synthesis model. Qwen independently reviews the same saved Brave
        evidence as a temporary, non-blocking shadow and cannot change classifications or authorize outreach.
        Replay is an audit comparison against saved evidence; it does not repeat Brave retrieval or rewrite a
        completed opportunity.
      </p>
      {summary ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RunMetric label="Status" value={summary.status} />
          <RunMetric
            label="Categorical agreement"
            value={summary.categoricalAgreementPercent === null
              ? "Not comparable"
              : `${summary.categoricalAgreementPercent}%`}
          />
          <RunMetric
            label="Trigger agreement"
            value={`${summary.triggerEvidenceAgreementCount}/${summary.evaluatedCompanyCount}`}
          />
          <RunMetric
            label="Tokens"
            value={summary.inputTokens + summary.outputTokens}
          />
        </div>
      ) : null}
      {results.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {results.map((result) => (
            <div
              key={result.companyId}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <span className="font-semibold text-foreground">{result.companyKey}</span>
              <span className="ml-2 text-mutedForeground">
                {result.comparison
                  ? `${result.comparison.agreementPercent}% agreement` +
                    (result.comparison.disagreedFields.length
                      ? ` · differs on ${result.comparison.disagreedFields.join(", ")}`
                      : " · no categorical differences")
                  : "Qwen result was unavailable for comparison"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <form action={replayHunterLunaComparisonAction} className="mt-4">
        <input type="hidden" name="runId" value={runId} />
        <button className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground">
          Replay Luna audit from saved evidence
        </button>
      </form>
    </details>
  );
}

function LatestContactDiscoveryRun({
  run,
  timeZone
}: {
  run: NonNullable<
    Awaited<ReturnType<typeof getHunterControlPlane>>["latestOutreachHandoff"]
  >;
  timeZone: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted px-5 py-4">
        <div>
          <h2 className="font-semibold text-foreground">
            Latest contact discovery run
          </h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Started {formatRunDate(run.startedAt, timeZone)}. Every queued company
            passed the saved Qwen synthesis, Kimi scoring, deterministic research,
            and current Hunter selection gates. Evaluated contacts are the bounded
            Apollo candidates sent through buyer-role review; only contacts with a
            generated plan appear in Outreach Queue.
          </p>
        </div>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground">
          {formatEnum(run.status)}
        </span>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-7">
        <RunMetric label="Companies queued" value={run.companiesQueued} />
        <RunMetric label="Companies processed" value={run.companiesProcessed} />
        <RunMetric label="Apollo people found" value={run.apolloContactsFound} />
        <RunMetric label="Buyer-role candidates" value={run.contactsRanked} />
        <RunMetric label="Contacts evaluated" value={run.contactsEvaluated} />
        <RunMetric label="New plans created" value={run.plansCreated} />
        <RunMetric label="Actionable plans" value={run.actionablePlans} />
      </div>
      {run.errorMessage ? (
        <p className="border-t border-danger/20 bg-danger/5 px-5 py-3 text-sm text-danger">
          {run.errorMessage}
        </p>
      ) : null}
      {run.results.length > 0 ? (
        <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
          {run.results.map((result, index) => (
            <article
              key={`${result.companyName}-${index}`}
              className="rounded-md border border-border bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold text-foreground">
                  {result.companyName}
                </h3>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-mutedForeground">
                  {formatHandoffResultState(result.state)}
                </span>
              </div>
              <p className="mt-2 text-sm text-mutedForeground">
                {result.apolloContactsFound} found in Apollo ·{" "}
                {result.contactsRanked} buyer-role candidate
                {result.contactsRanked === 1 ? "" : "s"} ·{" "}
                {result.contactsEvaluated} evaluated · {result.actionablePlans} actionable plan
                {result.actionablePlans === 1 ? "" : "s"} ({result.plansCreated} new,{" "}
                {result.existingPlansFound} already current)
                {result.qaFailedPlans > 0
                  ? ` · ${result.qaFailedPlans} failed QA`
                  : ""}
              </p>
              <p className="mt-2 text-sm text-foreground">{result.message}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="border-t border-border px-5 py-4 text-sm text-mutedForeground">
          The run has not recorded a company result yet.
        </p>
      )}
    </section>
  );
}

function RunMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatLunaReplayMessage(
  state: string | undefined,
  countValue: string | undefined
) {
  if (!state) return null;
  const count = Number(countValue);
  if (state === "completed" || state === "cached") {
    return `Luna replayed the saved evidence for ${
      Number.isInteger(count) ? count : "the selected"
    } compan${count === 1 ? "y" : "ies"}. No Brave search was repeated.`;
  }
  return "The Luna comparison replay finished with an error. Review Health & Logs before retrying.";
}

function formatHandoffMessage(state: string | undefined, countValue: string | undefined) {
  const count = Number(countValue);
  if (state === "queued") {
    return `${Number.isInteger(count) && count > 0 ? count : "Eligible"} compan${count === 1 ? "y was" : "ies were"} queued for contact discovery and outreach-plan preparation.`;
  }
  if (state === "already_queued") return "The current eligible-opportunity handoff is already queued.";
  if (state === "nothing_eligible") return "No current Hot or Qualified opportunity cleared the outreach handoff.";
  if (state === "research_required") return "Complete Hunter company research before finding contacts.";
  if (state === "configuration_required") return "Apollo or outreach-model configuration must be completed first.";
  if (state === "disabled") return "Enable Assisted mode and turn off the kill switch before finding contacts.";
  if (state === "plan_failed") return "Hunter could not refresh the current opportunity plan.";
  return null;
}

const inputClass = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-foreground">{label}{children}</label>;
}

function NumberField({ name, label, value }: { name: string; label: string; value: number }) {
  return <Field label={label}><input name={name} type="number" min={0} max={100} defaultValue={value} className={inputClass} /></Field>;
}

function formatEnum(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatHandoffResultState(value: string) {
  return formatEnum(value)
    .replace("Plans Generated", "Plans created")
    .replace("Contact Review Required", "No contact selected")
    .replace("No Qualifying Contacts", "No qualifying contact")
    .replace("Review Required", "Apollo review required");
}

function formatRunDate(value: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(value);
  } catch {
    return value.toLocaleString("en-US");
  }
}
