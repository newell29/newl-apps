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

export default async function AutomationSettingsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const data = await getHunterControlPlane(context);
  const policy = data.policy;

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
                    <option value={HunterAutomationMode.DRY_RUN}>Dry run</option>
                    <option value={HunterAutomationMode.OFF}>Off</option>
                  </select>
                </Field>
                <Field label="Daily company limit">
                  <input name="dailyCompanyLimit" type="number" min={1} max={100} defaultValue={policy.dailyCompanyLimit} className={inputClass} />
                </Field>
                <Field label="Max contacts per company">
                  <input name="maxContactsPerCompany" type="number" min={1} max={10} defaultValue={policy.maxContactsPerCompany} className={inputClass} />
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
