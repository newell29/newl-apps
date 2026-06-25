import Link from "next/link";
import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { askAssistantAction, syncAssistantKnowledgeAction } from "@/modules/assistant/actions";
import { formatAssistantRole, getAssistantWorkspace } from "@/modules/assistant/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type AssistantPageProps = {
  searchParams?: Promise<{
    q?: string;
    thread?: string;
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
  const threadId = params?.thread?.trim() || undefined;
  const workspace = await getAssistantWorkspace(context, query, threadId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company Assistant"
        title="Newl Business Intelligence"
        description="Tenant-scoped assistant foundation for customer memory, source-grounded insight, email drafting, and future tool-calling across rating, TMS, WMS, email, and OneDrive data. The interim model path is cost-effective OpenAI; the long-term target is a local model hosted on Newl-controlled server infrastructure."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Ask Newl</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              This first version answers from tenant-scoped app data and prepares the retrieval/memory boundary. Live LLM calls should sit behind a provider adapter so OpenAI can be used now and a local Newl-hosted model can take over later.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
              {formatIntent(workspace.intent)}
            </span>
            <form action={syncAssistantKnowledgeAction}>
              <button
                type="submit"
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40"
              >
                Sync knowledge
              </button>
            </form>
          </div>
        </div>

        <form className="mt-5 flex flex-col gap-3 sm:flex-row" action={askAssistantAction}>
          {workspace.activeThread ? <input type="hidden" name="threadId" value={workspace.activeThread.id} /> : null}
          <input
            name="prompt"
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

        {workspace.activeThread ? (
          <div className="mt-5 rounded-md border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Active thread</p>
                <h2 className="mt-1 text-base font-semibold text-foreground">{workspace.activeThread.title}</h2>
              </div>
              <Link href="/assistant" className="text-sm font-semibold text-primary hover:text-primaryHover">
                New thread
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {workspace.activeThread.messages.map((message) => (
                <div
                  key={message.id}
                  className={[
                    "rounded-md border p-3",
                    message.role === "USER" ? "border-primary/25 bg-background" : "border-border bg-card"
                  ].join(" ")}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                    {formatAssistantRole(message.role)}
                  </p>
                  <div className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{message.content}</div>
                </div>
              ))}
            </div>
            {workspace.activeThread.recentRuns[0]?.retrievedSources.length ? (
              <div className="mt-4 rounded-md border border-border bg-background p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Latest retrieved sources</p>
                <div className="mt-3 space-y-2">
                  {workspace.activeThread.recentRuns[0].retrievedSources.map((source) => (
                    <div key={source.id} className="text-sm leading-6">
                      <p className="font-medium text-foreground">{source.title}</p>
                      <p className="text-mutedForeground">{source.excerpt}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Assistant response preview</p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
              {workspace.answer.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        )}
      </section>

      {workspace.recentThreads.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Recent assistant threads</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Stored conversations are tenant-scoped and auditable.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {workspace.recentThreads.map((thread) => (
              <Link
                key={thread.id}
                href={`/assistant?thread=${encodeURIComponent(thread.id)}`}
                className={[
                  "rounded-md border p-4 transition-colors hover:bg-muted/40",
                  workspace.activeThread?.id === thread.id ? "border-primary/50 bg-accentSoft/40" : "border-border bg-muted/20"
                ].join(" ")}
              >
                <p className="font-semibold text-foreground">{thread.title}</p>
                <p className="mt-1 text-xs text-mutedForeground">
                  {thread.messageCount} messages
                  {thread.lastMessageAt ? `, last used ${formatDate(thread.lastMessageAt)}` : ""}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Companies" value={workspace.stats.companyCount} />
        <Metric label="Contacts" value={workspace.stats.contactCount} />
        <Metric label="Open Leads" value={workspace.stats.openLeadCount} />
        <Metric label="TradeMining Records" value={workspace.stats.importRecordCount} />
        <Metric label="Knowledge Docs" value={workspace.stats.knowledgeDocumentCount} />
        <Metric label="Memory Items" value={workspace.stats.memoryCount} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Knowledge coverage</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Indexed source counts by business record type for this tenant.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {workspace.knowledgeCoverage.map((entry) => (
              <div
                key={entry.sourceKind}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
              >
                <p className="text-sm font-medium text-foreground">{formatEnum(entry.sourceKind)}</p>
                <span className="text-sm font-semibold text-foreground">{entry.count.toLocaleString("en-US")}</span>
              </div>
            ))}
            {workspace.knowledgeCoverage.length === 0 ? (
              <p className="text-sm text-mutedForeground">
                No assistant knowledge documents have been indexed yet. Run a knowledge sync first.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Active memory</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                High-confidence customer and opportunity summaries currently available for retrieval.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {workspace.recentMemories.map((memory) => (
              <div key={memory.id} className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{memory.title}</p>
                    <p className="mt-1 text-xs text-mutedForeground">
                      {formatEnum(memory.kind)} | {memory.subjectType}
                      {memory.lastObservedAt ? ` | ${formatDate(memory.lastObservedAt)}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                    {memory.confidence}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-foreground">{memory.summary}</p>
                {memory.sourceDocument ? (
                  <p className="mt-2 text-xs text-mutedForeground">
                    Source: {memory.sourceDocument.title} ({formatEnum(memory.sourceDocument.sourceKind)})
                  </p>
                ) : null}
              </div>
            ))}
            {workspace.recentMemories.length === 0 ? (
              <p className="text-sm text-mutedForeground">
                No assistant memories are active yet. After sync, customer profiles and opportunity summaries will appear here.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Current business context</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Retrieved sources are pulled from the tenant knowledge index first, with app-data fallback while the index is still sparse.
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

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}
