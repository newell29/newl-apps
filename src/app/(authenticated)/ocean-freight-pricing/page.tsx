import { ModuleKey, OceanEquipmentType, type OceanFreightAgent, type OceanFreightAgentContact } from "@prisma/client";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { OceanFreightSuggestInput } from "@/modules/ocean-freight-pricing/components/suggest-input";
import { OCEAN_EQUIPMENT_LABELS, OCEAN_RATE_STATUS_LABELS } from "@/modules/ocean-freight-pricing/constants";
import {
  createOceanFreightRateAction,
  inactivateOceanFreightRateAction,
  updateOceanFreightRateAction
} from "@/modules/ocean-freight-pricing/actions";
import {
  getOceanFreightPricingShell,
  type OceanFreightPricingFilters
} from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<OceanFreightPricingFilters>;

type AgentWithContacts = OceanFreightAgent & {
  contacts: OceanFreightAgentContact[];
};

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date) : "Open";
}

function formatDateInput(date: Date | null) {
  return date?.toISOString().slice(0, 10) ?? "";
}

function formatMoney(value: { toString(): string }, currency: string) {
  return `${currency} ${Number(value.toString()).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function compactLocation(port: string, country?: string | null, region?: string | null) {
  return [port, region, country].filter(Boolean).join(", ");
}

export default async function OceanFreightPricingPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const params = await searchParams;
  const shell = await getOceanFreightPricingShell(context, params);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ocean Freight Pricing"
        title="Ocean freight pricing portal"
        description="Tenant-safe ocean rate table, agent directory, contacts, ratings, and future source ingestion and review workflows."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Active rates" value={shell.summary.activeRates} />
        <SummaryCard label="Agents" value={shell.summary.agentCount} />
        <SummaryCard label="Review queue" value={shell.summary.reviewQueueCount} />
        <SummaryCard label="Sources" value={shell.summary.sourceCount} />
      </div>

      <RatesTab agents={shell.agents} filters={params} rates={shell.rates} />
    </div>
  );
}

function RatesTab({
  agents,
  filters,
  rates
}: {
  agents: AgentWithContacts[];
  filters: OceanFreightPricingFilters;
  rates: Awaited<ReturnType<typeof getOceanFreightPricingShell>>["rates"];
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Rates</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Default view shows active, non-expired rates. Use filters to search every visible column or include historical rates.
            </p>
          </div>
          <a
            href="/ocean-freight-pricing/agents"
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Manage agents
          </a>
        </div>

        <RateFilters agents={agents} filters={filters} />

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1180px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-3">Agent</th>
                <th className="px-3 py-3">Origin</th>
                <th className="px-3 py-3">Destination</th>
                <th className="px-3 py-3">Equipment type</th>
                <th className="px-3 py-3 text-right">Rate</th>
                <th className="px-3 py-3">Carrier</th>
                <th className="px-3 py-3">Validity</th>
                <th className="px-3 py-3">Schedule</th>
                <th className="px-3 py-3">Agent rating</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rates.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-mutedForeground" colSpan={10}>
                    No ocean rates match the current filters.
                  </td>
                </tr>
              ) : (
                rates.map((rate) => (
                  <tr key={rate.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-foreground">{rate.agent.name}</div>
                      {rate.agentContact ? (
                        <div className="mt-1 text-xs text-mutedForeground">{rate.agentContact.fullName}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      {compactLocation(rate.originPort, rate.originCountry, rate.originRegion)}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      {compactLocation(rate.destinationPort, rate.destinationCountry, rate.destinationRegion)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{OCEAN_EQUIPMENT_LABELS[rate.equipmentType]}</div>
                      <div className="mt-1 text-xs text-mutedForeground">{rate.equipmentLabel}</div>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-foreground">
                      {formatMoney(rate.rateAmount, rate.currency)}
                    </td>
                    <td className="px-3 py-3 text-foreground">{rate.shippingLine || "Any carrier"}</td>
                    <td className="px-3 py-3">
                      <div className="text-foreground">
                        {formatDate(rate.validityStartDate)} to {formatDate(rate.validityEndDate)}
                      </div>
                      <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-mutedForeground">
                        {OCEAN_RATE_STATUS_LABELS[rate.computedStatus]}
                      </span>
                    </td>
                    <td className="max-w-[220px] px-3 py-3 text-mutedForeground">
                      {rate.scheduleNotes || "Schedule not provided"}
                    </td>
                    <td className="px-3 py-3">
                      <RatingPill rating={rate.agent.internalRating} />
                    </td>
                    <td className="px-3 py-3">
                      <details className="min-w-[220px]">
                        <summary className="cursor-pointer text-sm font-semibold text-primary">Edit</summary>
                        <form action={updateOceanFreightRateAction} className="mt-3 grid gap-2">
                          <input type="hidden" name="rateId" value={rate.id} />
                          <label className="grid gap-1 text-xs font-medium text-mutedForeground">
                            Rate
                            <input className="rounded-md border border-border px-2 py-1 text-sm text-foreground" name="rateAmount" defaultValue={rate.rateAmount.toString()} />
                          </label>
                          <label className="grid gap-1 text-xs font-medium text-mutedForeground">
                            Validity end
                            <input className="rounded-md border border-border px-2 py-1 text-sm text-foreground" type="date" name="validityEndDate" defaultValue={formatDateInput(rate.validityEndDate)} />
                          </label>
                          <input className="rounded-md border border-border px-2 py-1 text-sm" name="correctionNotes" placeholder="Correction notes" required />
                          <textarea className="rounded-md border border-border px-2 py-1 text-sm" name="notes" defaultValue={rate.notes ?? ""} placeholder="Rate notes" />
                          <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primaryForeground">
                            Save rate
                          </button>
                        </form>
                        <form action={inactivateOceanFreightRateAction} className="mt-3 grid gap-2 border-t border-border pt-3">
                          <input type="hidden" name="rateId" value={rate.id} />
                          <input className="rounded-md border border-border px-2 py-1 text-sm" name="inactiveReason" placeholder="Inactive reason" required />
                          <button className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white">
                            Mark inactive
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <CollapsibleFormCard title="Add manual rate" actionLabel="Create manual rate">
        <form action={createOceanFreightRateAction} className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <select name="agentId" className="rounded-md border border-border px-3 py-2" required>
              <option value="">Select agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select name="agentContactId" className="rounded-md border border-border px-3 py-2">
              <option value="">No contact</option>
              {agents.flatMap((agent) =>
                agent.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.fullName} - {agent.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <OceanFreightSuggestInput
              name="originPort"
              suggestionField="ports"
              placeholder="Origin port"
              required
              className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
            <OceanFreightSuggestInput
              name="destinationPort"
              suggestionField="ports"
              placeholder="Destination port"
              required
              className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
            <OceanFreightSuggestInput
              name="originCountry"
              suggestionField="countries"
              placeholder="Origin country"
              className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
            <OceanFreightSuggestInput
              name="destinationCountry"
              suggestionField="countries"
              placeholder="Destination country"
              className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <select name="equipmentType" className="rounded-md border border-border px-3 py-2" required>
              {Object.values(OceanEquipmentType).map((type) => (
                <option key={type} value={type}>
                  {OCEAN_EQUIPMENT_LABELS[type]}
                </option>
              ))}
            </select>
            <input className="rounded-md border border-border px-3 py-2" name="equipmentLabel" placeholder="Equipment label" />
            <input className="rounded-md border border-border px-3 py-2" name="shippingLine" placeholder="Carrier / shipping line" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input className="rounded-md border border-border px-3 py-2" name="rateAmount" type="number" step="0.01" placeholder="Rate" required />
            <input className="rounded-md border border-border px-3 py-2" name="currency" defaultValue="USD" required />
            <input className="rounded-md border border-border px-3 py-2" name="transitTimeDays" type="number" min="0" placeholder="Transit days" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-md border border-border px-3 py-2" name="validityStartDate" type="date" />
            <input className="rounded-md border border-border px-3 py-2" name="validityEndDate" type="date" />
          </div>
          <textarea className="rounded-md border border-border px-3 py-2" name="scheduleNotes" placeholder="Schedule notes (defaults to Schedule not provided)" />
          <textarea className="rounded-md border border-border px-3 py-2" name="freeTimeNotes" placeholder="Free time notes" />
          <textarea className="rounded-md border border-border px-3 py-2" name="detentionDemurrageNotes" placeholder="Detention/demurrage notes" />
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
            Create manual rate
          </button>
        </form>
      </CollapsibleFormCard>
    </div>
  );
}

function RateFilters({ agents, filters }: { agents: AgentWithContacts[]; filters: OceanFreightPricingFilters }) {
  return (
    <form className="mt-5 grid gap-3 rounded-md border border-border bg-muted/30 p-4" method="get">
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
        <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="agentId" defaultValue={filters.agentId ?? ""}>
          <option value="">All agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <OceanFreightSuggestInput
          name="origin"
          defaultValue={filters.origin}
          suggestionField="ports"
          placeholder="Origin port"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <OceanFreightSuggestInput
          name="originCountry"
          defaultValue={filters.originCountry}
          suggestionField="countries"
          placeholder="Origin country"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <OceanFreightSuggestInput
          name="destination"
          defaultValue={filters.destination}
          suggestionField="ports"
          placeholder="Destination port"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <OceanFreightSuggestInput
          name="destinationCountry"
          defaultValue={filters.destinationCountry}
          suggestionField="countries"
          placeholder="Destination country"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="equipmentType" defaultValue={filters.equipmentType ?? ""}>
          <option value="">All equipment</option>
          {Object.values(OceanEquipmentType).map((type) => (
            <option key={type} value={type}>
              {OCEAN_EQUIPMENT_LABELS[type]}
            </option>
          ))}
        </select>
        <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="rateMin" defaultValue={filters.rateMin ?? ""} placeholder="Min rate" />
        <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="rateMax" defaultValue={filters.rateMax ?? ""} placeholder="Max rate" />
        <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="carrier" defaultValue={filters.carrier ?? ""} placeholder="Carrier" />
        <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="validityFrom" defaultValue={filters.validityFrom ?? ""} type="date" />
        <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="validityTo" defaultValue={filters.validityTo ?? ""} type="date" />
        <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="schedule" defaultValue={filters.schedule ?? ""} placeholder="Schedule" />
        <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="agentRating" defaultValue={filters.agentRating ?? ""}>
          <option value="">Any rating</option>
          {[1, 2, 3, 4, 5].map((rating) => (
            <option key={rating} value={rating}>
              {rating} star
            </option>
          ))}
        </select>
        <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="status" defaultValue={filters.status ?? "active"}>
          <option value="active">Active only</option>
          <option value="all">Include historical</option>
          <option value="expired">Expired only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
          Apply filters
        </button>
        <a className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted" href="/ocean-freight-pricing">
          Reset
        </a>
      </div>
    </form>
  );
}

function RatingPill({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
      {rating ? `${rating}/5` : "Not rated"}
    </span>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-sm font-medium text-mutedForeground">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function CollapsibleFormCard({ title, actionLabel, children }: { title: string; actionLabel: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-5 marker:hidden">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <span className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors group-open:bg-muted group-open:text-foreground">
          <span className="group-open:hidden">{actionLabel}</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>
      <div className="border-t border-border p-5 pt-4">{children}</div>
    </details>
  );
}
