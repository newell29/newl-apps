import Link from "next/link";
import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { getAssistantWorkspace } from "@/modules/assistant/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type AssistantPageProps = {
  searchParams?: Promise<{
    q?: string;
  }>;
};

const suggestedPrompts = [
  "Which customers or prospects need attention today?",
  "What sales opportunities are visible from current lead data?",
  "Draft a customer follow-up email using what we know.",
  "I need a rate from Toronto to Dallas for 2 pallets.",
  "What problems should managers be watching for?"
];

export default async function AssistantPage({ searchParams }: AssistantPageProps) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);

  const params = await searchParams;
  const query = params?.q?.trim() ?? "";
  const workspace = await getAssistantWorkspace(context, query);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company Assistant"
        title="Newl Business Intelligence"
        description="Tenant-scoped assistant foundation for customer memory, source-grounded insight, email drafting, and future tool-calling across rating, TMS, WMS, email, and OneDrive data."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Ask Newl</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              This first version answers from tenant-scoped app data and prepares the retrieval/memory boundary. Live LLM calls, Microsoft Graph sync, and rate tool-calling can be added behind this surface.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            {formatIntent(workspace.intent)}
          </span>
        </div>

        <form className="mt-5 flex flex-col gap-3 sm:flex-row" action="/assistant">
          <input
            name="q"
            defaultValue={query}
            placeholder="Ask about customers, sales opportunities, rates, risks, or email drafts"
            className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-mutedForeground focus:border-primary"
          />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
          >
            Ask
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {suggestedPrompts.map((prompt) => (
            <Link
              key={prompt}
              href={`/assistant?q=${encodeURIComponent(prompt)}`}
              className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-mutedForeground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {prompt}
            </Link>
          ))}
        </div>

        <div className="mt-5 rounded-md border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Assistant response preview</p>
          <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
            {workspace.answer.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Companies" value={workspace.stats.companyCount} />
        <Metric label="Contacts" value={workspace.stats.contactCount} />
        <Metric label="Open Leads" value={workspace.stats.openLeadCount} />
        <Metric label="TradeMining Records" value={workspace.stats.importRecordCount} />
        <Metric label="Knowledge Docs" value={workspace.stats.knowledgeDocumentCount} />
        <Metric label="Memory Items" value={workspace.stats.memoryCount} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Current business context</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Early retrieval sources from Newl Apps. These are tenant-scoped database reads.
              </p>
            </div>
            <Link href="/lead-gen/candidates" className="text-sm font-semibold text-primary hover:text-primaryHover">
              Review leads
            </Link>
          </div>

          <div className="mt-4 overflow-hidden rounded-md border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/60 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Industry</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Signals</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {workspace.topCompanies.map((company) => (
                  <tr key={company.id} className="align-top">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {company.name}
                      <p className="mt-1 text-xs font-normal text-mutedForeground">{company.normalizedName}</p>
                    </td>
                    <td className="px-4 py-3 text-mutedForeground">{company.primaryIndustry ?? "Unknown"}</td>
                    <td className="px-4 py-3 font-semibold text-foreground">{company.priorityScore}</td>
                    <td className="px-4 py-3 text-mutedForeground">
                      {company.importRecordCount} imports, {company.contactCount} contacts, {company.leadCount} leads
                    </td>
                    <td className="px-4 py-3 text-mutedForeground">{formatEnum(company.candidateStatus)}</td>
                  </tr>
                ))}
                {workspace.topCompanies.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-sm text-mutedForeground" colSpan={5}>
                      No companies are available for assistant retrieval yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">Rate tool handoff</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              The assistant should collect structured rating details and then call these tenant tools.
            </p>
            <div className="mt-4 grid gap-3">
              <ToolLink href="/ups-tools/rate-quote" title="UPS Shipment Rate Quote" detail="Parcel and UPS account pricing" />
              <ToolLink href="/ltl-rate-portal" title="LTL Rate Portal" detail="7L-backed LTL lane quoting" />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">Source readiness</h2>
            <div className="mt-4 space-y-3">
              {workspace.integrations.map((integration) => (
                <div key={integration.provider} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{formatEnum(integration.provider)}</p>
                    <p className="text-xs text-mutedForeground">
                      {integration.configuredCount} configured, {integration.activeCount} active
                    </p>
                  </div>
                  <span
                    className={[
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      integration.activeCount > 0
                        ? "bg-success/10 text-success"
                        : "border border-border bg-card text-mutedForeground"
                    ].join(" ")}
                  >
                    {integration.activeCount > 0 ? "Active" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Open opportunity context</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {workspace.openLeads.map((lead) => (
            <div key={lead.id} className="rounded-md border border-border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{lead.company.name}</p>
                  <p className="mt-1 text-xs text-mutedForeground">{lead.company.primaryIndustry ?? "Unknown industry"}</p>
                </div>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {lead.score}
                </span>
              </div>
              <p className="mt-3 text-sm text-mutedForeground">Stage: {formatEnum(lead.stage)}</p>
              {lead.contact ? (
                <p className="mt-1 text-sm text-mutedForeground">
                  Contact: {lead.contact.fullName}
                  {lead.contact.title ? `, ${lead.contact.title}` : ""}
                </p>
              ) : null}
              {lead.notes ? <p className="mt-3 text-sm leading-6 text-foreground">{lead.notes}</p> : null}
            </div>
          ))}
          {workspace.openLeads.length === 0 ? (
            <p className="text-sm text-mutedForeground">No open leads are available for opportunity context yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value.toLocaleString("en-US")}</p>
    </div>
  );
}

function ToolLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link href={href} className="block rounded-md border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/60">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-mutedForeground">{detail}</p>
    </Link>
  );
}

function formatIntent(intent: string) {
  return formatEnum(intent).replace("Rate Request", "Rate Request Flow");
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
