import { ModuleKey, type OceanFreightAgent, type OceanFreightAgentBranch, type OceanFreightAgentContact, type Prisma } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { OceanFreightSuggestInput } from "@/modules/ocean-freight-pricing/components/suggest-input";
import {
  createOceanFreightBranchAction,
  createOceanFreightAgentAction,
  createOceanFreightContactAction,
  deleteOceanFreightBranchAction,
  deleteOceanFreightContactAction,
  updateOceanFreightBranchAction,
  updateOceanFreightAgentAction,
  updateOceanFreightContactAction
} from "@/modules/ocean-freight-pricing/actions";
import {
  getOceanFreightAgentsShell,
  type OceanFreightAgentFilters
} from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<OceanFreightAgentFilters>;

type AgentWithContacts = OceanFreightAgent & {
  branches: OceanFreightAgentBranch[];
  contacts: OceanFreightAgentContact[];
};

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date) : "Never";
}

function formatJsonList(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join(", ");
}

function formatBranchLocation(branch: OceanFreightAgentBranch) {
  return [branch.city, branch.region, branch.country, branch.port].filter(Boolean).join(", ");
}

export default async function OceanFreightAgentsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const filters = await searchParams;
  const shell = await getOceanFreightAgentsShell(context, filters);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ocean Freight Pricing"
        title="Agents"
        description="Search, filter, rate, and maintain overseas agent companies and contacts used by the ocean rate table."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Agents</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              {shell.agents.length} agent{shell.agents.length === 1 ? "" : "s"} match the current filters.
            </p>
          </div>
          <a
            href="/ocean-freight-pricing"
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            View rates
          </a>
        </div>

        <AgentControls filters={filters} />
        <AgentsTable agents={shell.agents} />
      </section>
    </div>
  );
}

function AgentControls({ filters }: { filters: OceanFreightAgentFilters }) {
  return (
    <div className="mt-5 rounded-md border border-border bg-muted/30 p-4">
      <form className="grid gap-3" method="get">
        <div className="grid gap-3 md:grid-cols-[1.3fr,0.9fr,0.9fr,0.7fr,0.7fr]">
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            name="agentSearch"
            defaultValue={filters.agentSearch ?? ""}
            placeholder="Search agent, contact, domain, phone, or notes"
          />
          <OceanFreightSuggestInput
            name="agentCountry"
            defaultValue={filters.agentCountry}
            suggestionField="countries"
            placeholder="Agent country"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            name="branchLocation"
            defaultValue={filters.branchLocation ?? ""}
            placeholder="Branch city, country, or port"
          />
          <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="agentRating" defaultValue={filters.agentRating ?? ""}>
            <option value="">Any rating</option>
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>
                {rating} star
              </option>
            ))}
          </select>
          <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="activeOnly" defaultValue={filters.activeOnly ?? ""}>
            <option value="">All agents</option>
            <option value="true">Has active rates</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
            Apply filters
          </button>
          <a className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted" href="/ocean-freight-pricing/agents">
            Reset
          </a>
        </div>
      </form>

      <details className="group mt-4 rounded-md border border-border bg-background">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <span className="text-sm font-semibold text-foreground">Add agent</span>
          <span className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors group-open:bg-muted group-open:text-foreground">
            <span className="group-open:hidden">Create agent</span>
            <span className="hidden group-open:inline">Close</span>
          </span>
        </summary>
        <form action={createOceanFreightAgentAction} className="grid gap-3 border-t border-border p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <input className="rounded-md border border-border px-3 py-2" name="agentName" placeholder="Agent company" required />
            <input className="rounded-md border border-border px-3 py-2" name="website" placeholder="Website" />
            <input className="rounded-md border border-border px-3 py-2" name="primaryEmailDomain" placeholder="Email domain" />
            <OceanFreightSuggestInput
              name="primaryCountry"
              suggestionField="countries"
              placeholder="Primary country"
              className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-[0.7fr,1fr,1fr]">
            <select className="rounded-md border border-border px-3 py-2" name="internalRating">
              <option value="">No rating</option>
              {[1, 2, 3, 4, 5].map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
            <textarea className="rounded-md border border-border px-3 py-2" name="countriesServed" placeholder="Countries served (comma-separated)" />
            <textarea className="rounded-md border border-border px-3 py-2" name="portsServed" placeholder="Ports served (comma-separated)" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <textarea className="rounded-md border border-border px-3 py-2" name="reliabilityNotes" placeholder="Reliability notes" />
            <textarea className="rounded-md border border-border px-3 py-2" name="serviceNotes" placeholder="Service notes" />
            <textarea className="rounded-md border border-border px-3 py-2" name="internalNotes" placeholder="Internal notes" />
          </div>
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
            Create agent
          </button>
        </form>
      </details>
    </div>
  );
}

function AgentsTable({ agents }: { agents: AgentWithContacts[] }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="min-w-[1480px] divide-y divide-border text-sm">
        <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            <th className="px-3 py-3">Agent</th>
            <th className="px-3 py-3">Country</th>
            <th className="px-3 py-3">Branches</th>
            <th className="px-3 py-3">Contacts</th>
            <th className="px-3 py-3">Email domain</th>
            <th className="px-3 py-3">Rating</th>
            <th className="px-3 py-3 text-right">Active rates</th>
            <th className="px-3 py-3 text-right">Total rates</th>
            <th className="px-3 py-3">Last rate</th>
            <th className="px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.length === 0 ? (
            <tr>
              <td className="px-3 py-8 text-center text-mutedForeground" colSpan={10}>
                No agents match the current filters.
              </td>
            </tr>
          ) : (
            agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentWithContacts }) {
  const primaryContact = agent.contacts[0];
  const primaryBranch = agent.branches[0];

  return (
    <tr className="align-top hover:bg-muted/30">
      <td className="px-3 py-3">
        <div className="font-semibold text-foreground">{agent.name}</div>
        {agent.website ? <div className="mt-1 text-xs text-mutedForeground">{agent.website}</div> : null}
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-foreground">{agent.primaryCountry || primaryBranch?.country || "-"}</div>
        {formatJsonList(agent.countriesServed) ? (
          <div className="mt-1 max-w-[220px] text-xs text-mutedForeground">{formatJsonList(agent.countriesServed)}</div>
        ) : null}
      </td>
      <td className="px-3 py-3">
        {primaryBranch ? (
          <div>
            <div className="font-medium text-foreground">{primaryBranch.name}</div>
            <div className="mt-1 text-xs text-mutedForeground">{formatBranchLocation(primaryBranch)}</div>
            <div className="mt-1 text-xs text-mutedForeground">
              {agent.branches.length} branch{agent.branches.length === 1 ? "" : "es"}
            </div>
          </div>
        ) : (
          <span className="text-mutedForeground">No branches</span>
        )}
      </td>
      <td className="px-3 py-3">
        {primaryContact ? (
          <div>
            <div className="font-medium text-foreground">{primaryContact.fullName}</div>
            <div className="mt-1 text-xs text-mutedForeground">
              {agent.contacts.length} contact{agent.contacts.length === 1 ? "" : "s"}
            </div>
          </div>
        ) : (
          <span className="text-mutedForeground">No contacts</span>
        )}
      </td>
      <td className="px-3 py-3 text-mutedForeground">{agent.primaryEmailDomain || "-"}</td>
      <td className="px-3 py-3">
        <RatingPill rating={agent.internalRating} />
      </td>
      <td className="px-3 py-3 text-right font-semibold text-foreground">{agent.activeRateCount}</td>
      <td className="px-3 py-3 text-right text-mutedForeground">{agent.historicalRateCount}</td>
      <td className="px-3 py-3 text-mutedForeground">{formatDate(agent.lastRateReceivedAt)}</td>
      <td className="px-3 py-3">
        <details className="min-w-[1120px]">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Edit</summary>
          <AgentEditor agent={agent} />
        </details>
      </td>
    </tr>
  );
}

function AgentEditor({ agent }: { agent: AgentWithContacts }) {
  return (
    <div className="mt-3 space-y-5 rounded-md border border-border bg-background p-5">
      <section className="rounded-md border border-border bg-muted/10 p-4">
        <h3 className="text-base font-semibold text-foreground">Agent profile</h3>
        <form action={updateOceanFreightAgentAction} className="mt-4 grid gap-4">
          <input type="hidden" name="agentId" value={agent.id} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input className="rounded-md border border-border px-3 py-2.5" name="agentName" defaultValue={agent.name} placeholder="Agent company" required />
            <input className="rounded-md border border-border px-3 py-2.5" name="website" defaultValue={agent.website ?? ""} placeholder="Website" />
            <input className="rounded-md border border-border px-3 py-2.5" name="primaryEmailDomain" defaultValue={agent.primaryEmailDomain ?? ""} placeholder="Email domain" />
            <OceanFreightSuggestInput
              name="primaryCountry"
              defaultValue={agent.primaryCountry ?? ""}
              suggestionField="countries"
              placeholder="Primary country"
              className="w-full rounded-md border border-border px-3 py-2.5 text-sm text-foreground"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-[0.55fr,1fr,1fr]">
            <select className="rounded-md border border-border px-3 py-2.5" name="internalRating" defaultValue={agent.internalRating ?? ""}>
              <option value="">No rating</option>
              {[1, 2, 3, 4, 5].map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
            <textarea className="min-h-24 rounded-md border border-border px-3 py-2.5" name="countriesServed" defaultValue={formatJsonList(agent.countriesServed)} placeholder="Countries served (comma-separated)" />
            <textarea className="min-h-24 rounded-md border border-border px-3 py-2.5" name="portsServed" defaultValue={formatJsonList(agent.portsServed)} placeholder="Ports served (comma-separated)" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <textarea className="min-h-28 rounded-md border border-border px-3 py-2.5" name="reliabilityNotes" defaultValue={agent.reliabilityNotes ?? ""} placeholder="Reliability notes" />
            <textarea className="min-h-28 rounded-md border border-border px-3 py-2.5" name="serviceNotes" defaultValue={agent.serviceNotes ?? ""} placeholder="Service notes" />
            <textarea className="min-h-28 rounded-md border border-border px-3 py-2.5" name="internalNotes" defaultValue={agent.internalNotes ?? ""} placeholder="Internal notes" />
          </div>
          <button className="w-fit rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primaryForeground">
            Update agent
          </button>
        </form>
      </section>

      <section className="rounded-md border border-border bg-muted/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">Branches</h3>
          <span className="text-sm text-mutedForeground">
            {agent.branches.length} branch{agent.branches.length === 1 ? "" : "es"}
          </span>
        </div>

        <details className="group mt-4 rounded-md border border-border bg-background">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
            <span className="text-sm font-semibold text-foreground">Add branch</span>
            <span className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors group-open:bg-muted group-open:text-foreground">
              <span className="group-open:hidden">Create branch</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </summary>
          <form action={createOceanFreightBranchAction} className="grid gap-3 border-t border-border p-4">
            <input type="hidden" name="agentId" value={agent.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <input className="rounded-md border border-border px-3 py-2.5" name="branchName" placeholder="Branch name, e.g. Shanghai office" required />
              <OceanFreightSuggestInput
                name="country"
                suggestionField="countries"
                placeholder="Country"
                required
                className="w-full rounded-md border border-border px-3 py-2.5 text-sm text-foreground"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input className="rounded-md border border-border px-3 py-2.5" name="region" placeholder="Region/state" />
              <input className="rounded-md border border-border px-3 py-2.5" name="city" placeholder="City" />
              <OceanFreightSuggestInput
                name="port"
                suggestionField="ports"
                placeholder="Port"
                className="w-full rounded-md border border-border px-3 py-2.5 text-sm text-foreground"
              />
            </div>
            <input className="rounded-md border border-border px-3 py-2.5" name="address" placeholder="Address" />
            <textarea className="min-h-24 rounded-md border border-border px-3 py-2.5" name="notes" placeholder="Branch notes" />
            <button className="w-fit rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primaryForeground">
              Add branch
            </button>
          </form>
        </details>

        <div className="mt-4 grid gap-4">
          {agent.branches.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-mutedForeground">No branches for this agent yet.</p>
          ) : (
            agent.branches.map((branch) => <BranchEditor key={branch.id} branch={branch} />)
          )}
        </div>
      </section>

      <section className="rounded-md border border-border bg-muted/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">Contacts</h3>
          <span className="text-sm text-mutedForeground">
            {agent.contacts.length} contact{agent.contacts.length === 1 ? "" : "s"}
          </span>
        </div>

        <details className="group mt-4 rounded-md border border-border bg-background">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
            <span className="text-sm font-semibold text-foreground">Add contact</span>
            <span className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors group-open:bg-muted group-open:text-foreground">
              <span className="group-open:hidden">Create contact</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </summary>
          <form action={createOceanFreightContactAction} className="grid gap-3 border-t border-border p-4">
            <input type="hidden" name="agentId" value={agent.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <input className="rounded-md border border-border px-3 py-2.5" name="fullName" placeholder="Contact name" required />
              <input className="rounded-md border border-border px-3 py-2.5" name="email" type="email" placeholder="Email" required />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input className="rounded-md border border-border px-3 py-2.5" name="phone" placeholder="Phone" />
              <input className="rounded-md border border-border px-3 py-2.5" name="title" placeholder="Title" />
            </div>
            <textarea className="min-h-24 rounded-md border border-border px-3 py-2.5" name="notes" placeholder="Contact notes" />
            <button className="w-fit rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primaryForeground">
              Add contact
            </button>
          </form>
        </details>

        <div className="mt-4 grid gap-4">
          {agent.contacts.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-mutedForeground">No contacts for this agent yet.</p>
          ) : (
            agent.contacts.map((contact) => <ContactEditor key={contact.id} contact={contact} />)
          )}
        </div>
      </section>
    </div>
  );
}

function BranchEditor({ branch }: { branch: OceanFreightAgentBranch }) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <form action={updateOceanFreightBranchAction} className="grid gap-3">
        <input type="hidden" name="branchId" value={branch.id} />
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="branchName" defaultValue={branch.name} placeholder="Branch name" required />
          <OceanFreightSuggestInput
            name="country"
            defaultValue={branch.country}
            suggestionField="countries"
            placeholder="Country"
            required
            className="w-full rounded-md border border-border px-3 py-2.5 text-sm text-foreground"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="region" defaultValue={branch.region ?? ""} placeholder="Region/state" />
          <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="city" defaultValue={branch.city ?? ""} placeholder="City" />
          <OceanFreightSuggestInput
            name="port"
            defaultValue={branch.port ?? ""}
            suggestionField="ports"
            placeholder="Port"
            className="w-full rounded-md border border-border px-3 py-2.5 text-sm text-foreground"
          />
        </div>
        <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="address" defaultValue={branch.address ?? ""} placeholder="Address" />
        <textarea className="min-h-24 rounded-md border border-border px-3 py-2.5 text-sm" name="notes" defaultValue={branch.notes ?? ""} placeholder="Branch notes" />
        <button className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
          Save branch
        </button>
      </form>
      <form action={deleteOceanFreightBranchAction} className="mt-2">
        <input type="hidden" name="branchId" value={branch.id} />
        <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50">
          Delete branch
        </button>
      </form>
    </div>
  );
}

function ContactEditor({ contact }: { contact: OceanFreightAgentContact }) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <form action={updateOceanFreightContactAction} className="grid gap-3">
        <input type="hidden" name="contactId" value={contact.id} />
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="fullName" defaultValue={contact.fullName} placeholder="Name" required />
          <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="email" type="email" defaultValue={contact.email} placeholder="Email" required />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="phone" defaultValue={contact.phone ?? ""} placeholder="Phone" />
          <input className="rounded-md border border-border px-3 py-2.5 text-sm" name="title" defaultValue={contact.title ?? ""} placeholder="Title" />
        </div>
        <textarea className="min-h-24 rounded-md border border-border px-3 py-2.5 text-sm" name="notes" defaultValue={contact.notes ?? ""} placeholder="Contact notes" />
        <button className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
          Save contact
        </button>
      </form>
      <form action={deleteOceanFreightContactAction} className="mt-2">
        <input type="hidden" name="contactId" value={contact.id} />
        <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50">
          Delete contact
        </button>
      </form>
    </div>
  );
}

function RatingPill({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
      {rating ? `${rating}/5` : "Not rated"}
    </span>
  );
}
