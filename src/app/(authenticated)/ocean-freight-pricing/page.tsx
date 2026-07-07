import { ModuleKey, OceanEquipmentType } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { OCEAN_EQUIPMENT_LABELS, OCEAN_RATE_STATUS_LABELS } from "@/modules/ocean-freight-pricing/constants";
import { getOceanFreightPricingShell } from "@/modules/ocean-freight-pricing/queries";
import { createOceanFreightAgentAction, createOceanFreightContactAction, createOceanFreightRateAction, inactivateOceanFreightRateAction, updateOceanFreightAgentAction, updateOceanFreightRateAction } from "@/modules/ocean-freight-pricing/actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ status?: string }>;

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date) : "—";
}

export default async function OceanFreightPricingPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const params = await searchParams;
  const shell = await getOceanFreightPricingShell(context, { status: params.status });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ocean Freight Pricing" title="Ocean freight pricing portal" description="Tenant-safe manual ocean rate table, agent directory, contacts, ratings, and placeholders for future source ingestion and review workflows." />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Active rates" value={shell.summary.activeRates} />
        <SummaryCard label="Agents" value={shell.summary.agentCount} />
        <SummaryCard label="Review queue" value={shell.summary.reviewQueueCount} />
        <SummaryCard label="Sources" value={shell.summary.sourceCount} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Rates</h2>
            <p className="text-sm text-slate-600">Default view shows active, non-expired rates. Expired rows remain queryable as historical data.</p>
          </div>
          <div className="flex gap-2 text-sm">
            <a className="rounded-full border px-3 py-1" href="/ocean-freight-pricing">Active only</a>
            <a className="rounded-full border px-3 py-1" href="/ocean-freight-pricing?status=all">Include historical</a>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Lane</th><th className="px-3 py-2">Agent</th><th className="px-3 py-2">Equipment</th><th className="px-3 py-2">Rate</th><th className="px-3 py-2">Validity</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Schedule</th><th className="px-3 py-2">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shell.rates.length === 0 ? <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={8}>No manual ocean rates yet.</td></tr> : shell.rates.map((rate) => (
                <tr key={rate.id} className="align-top"><td className="px-3 py-3 font-medium text-slate-900">{rate.originPort} → {rate.destinationPort}<div className="text-xs font-normal text-slate-500">{rate.shippingLine ?? "Any line"}</div></td><td className="px-3 py-3">{rate.agent.name}<div className="text-xs text-slate-500">Rating: {rate.agent.internalRating ?? "Not rated"}</div></td><td className="px-3 py-3">{rate.equipmentLabel}</td><td className="px-3 py-3">{rate.currency} {rate.rateAmount.toString()}</td><td className="px-3 py-3">{formatDate(rate.validityStartDate)} – {formatDate(rate.validityEndDate)}</td><td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{OCEAN_RATE_STATUS_LABELS[rate.computedStatus]}</span></td><td className="px-3 py-3 text-slate-600">{rate.scheduleNotes || "Schedule not provided"}</td><td className="px-3 py-3"><details><summary className="cursor-pointer text-blue-700">Edit</summary><form action={updateOceanFreightRateAction} className="mt-2 grid gap-2"><input type="hidden" name="rateId" value={rate.id} /><input className="rounded border px-2 py-1" name="rateAmount" defaultValue={rate.rateAmount.toString()} /><input className="rounded border px-2 py-1" type="date" name="validityEndDate" defaultValue={rate.validityEndDate?.toISOString().slice(0,10)} /><input className="rounded border px-2 py-1" name="correctionNotes" placeholder="Correction notes" required /><textarea className="rounded border px-2 py-1" name="notes" defaultValue={rate.notes ?? ""} /><button className="rounded bg-slate-950 px-3 py-1 text-white">Save</button></form><form action={inactivateOceanFreightRateAction} className="mt-2 grid gap-2"><input type="hidden" name="rateId" value={rate.id} /><input className="rounded border px-2 py-1" name="inactiveReason" placeholder="Inactive reason" required /><button className="rounded bg-red-700 px-3 py-1 text-white">Mark inactive</button></form></details></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <FormCard title="Add manual rate"><form action={createOceanFreightRateAction} className="grid gap-3"><select name="agentId" className="rounded border px-3 py-2" required><option value="">Select agent</option>{shell.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><select name="agentContactId" className="rounded border px-3 py-2"><option value="">No contact</option>{shell.agents.flatMap((agent) => agent.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.fullName} — {agent.name}</option>))}</select><div className="grid gap-3 md:grid-cols-2"><input className="rounded border px-3 py-2" name="originPort" placeholder="Origin port" required /><input className="rounded border px-3 py-2" name="destinationPort" placeholder="Destination port" required /><input className="rounded border px-3 py-2" name="originCountry" placeholder="Origin country" /><input className="rounded border px-3 py-2" name="destinationCountry" placeholder="Destination country" /></div><select name="equipmentType" className="rounded border px-3 py-2" required>{Object.values(OceanEquipmentType).map((type) => <option key={type} value={type}>{OCEAN_EQUIPMENT_LABELS[type]}</option>)}</select><div className="grid gap-3 md:grid-cols-3"><input className="rounded border px-3 py-2" name="equipmentLabel" placeholder="Equipment label" /><input className="rounded border px-3 py-2" name="rateAmount" type="number" step="0.01" placeholder="Rate" required /><input className="rounded border px-3 py-2" name="currency" defaultValue="USD" required /></div><div className="grid gap-3 md:grid-cols-2"><input className="rounded border px-3 py-2" name="validityStartDate" type="date" /><input className="rounded border px-3 py-2" name="validityEndDate" type="date" /></div><input className="rounded border px-3 py-2" name="shippingLine" placeholder="Shipping line" /><textarea className="rounded border px-3 py-2" name="scheduleNotes" placeholder="Schedule notes (defaults to Schedule not provided)" /><textarea className="rounded border px-3 py-2" name="freeTimeNotes" placeholder="Free time notes" /><textarea className="rounded border px-3 py-2" name="detentionDemurrageNotes" placeholder="Detention/demurrage notes" /><button className="rounded bg-slate-950 px-4 py-2 text-white">Create manual rate</button></form></FormCard>
        <FormCard title="Add agent"><form action={createOceanFreightAgentAction} className="grid gap-3"><input className="rounded border px-3 py-2" name="agentName" placeholder="Agent company" required /><input className="rounded border px-3 py-2" name="website" placeholder="Website" /><input className="rounded border px-3 py-2" name="primaryEmailDomain" placeholder="Email domain" /><select className="rounded border px-3 py-2" name="internalRating"><option value="">No rating</option>{[1,2,3,4,5].map((r) => <option key={r} value={r}>{r}</option>)}</select><textarea className="rounded border px-3 py-2" name="reliabilityNotes" placeholder="Reliability notes" /><textarea className="rounded border px-3 py-2" name="serviceNotes" placeholder="Service notes" /><button className="rounded bg-slate-950 px-4 py-2 text-white">Create agent</button></form></FormCard>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">Agents</h2><div className="mt-3 grid gap-3">{shell.agents.length === 0 ? <p className="text-sm text-slate-500">No agents yet.</p> : shell.agents.map((agent) => <details key={agent.id} className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">{agent.name} · rating {agent.internalRating ?? "not rated"} · {agent.activeRateCount} active / {agent.historicalRateCount} total rates</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><form action={updateOceanFreightAgentAction} className="grid gap-2"><input type="hidden" name="agentId" value={agent.id} /><select className="rounded border px-2 py-1" name="internalRating" defaultValue={agent.internalRating ?? ""}><option value="">No rating</option>{[1,2,3,4,5].map((r) => <option key={r} value={r}>{r}</option>)}</select><textarea className="rounded border px-2 py-1" name="reliabilityNotes" defaultValue={agent.reliabilityNotes ?? ""} placeholder="Reliability notes" /><textarea className="rounded border px-2 py-1" name="serviceNotes" defaultValue={agent.serviceNotes ?? ""} placeholder="Service notes" /><textarea className="rounded border px-2 py-1" name="internalNotes" defaultValue={agent.internalNotes ?? ""} placeholder="Internal notes" /><button className="rounded bg-slate-950 px-3 py-1 text-white">Update rating/notes</button></form><form action={createOceanFreightContactAction} className="grid gap-2"><input type="hidden" name="agentId" value={agent.id} /><input className="rounded border px-2 py-1" name="fullName" placeholder="Contact name" required /><input className="rounded border px-2 py-1" name="email" type="email" placeholder="Email" required /><input className="rounded border px-2 py-1" name="phone" placeholder="Phone" /><input className="rounded border px-2 py-1" name="title" placeholder="Title" /><button className="rounded bg-slate-950 px-3 py-1 text-white">Add contact</button></form></div><ul className="mt-3 text-sm text-slate-600">{agent.contacts.map((contact) => <li key={contact.id}>{contact.fullName} · {contact.email} {contact.phone ? `· ${contact.phone}` : ""}</li>)}</ul></details>)}</div></section>

      <section className="grid gap-4 md:grid-cols-3"><PlaceholderTab title="Review Queue" detail="Candidate approval/rejection is intentionally deferred to PR 5; this PR only shows the staging placeholder." /><PlaceholderTab title="Sources" detail="Microsoft Graph source email and attachment ingestion is intentionally deferred to PR 3/4." /><PlaceholderTab title="Jobs" detail="Ocean ingestion/extraction job controls and history are intentionally deferred to PR 3." /></section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div></div>; }
function FormCard({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="mb-3 text-lg font-semibold text-slate-950">{title}</h2>{children}</section>; }
function PlaceholderTab({ title, detail }: { title: string; detail: string }) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4"><h3 className="font-semibold text-slate-900">{title}</h3><p className="mt-2 text-sm text-slate-600">{detail}</p></div>; }
