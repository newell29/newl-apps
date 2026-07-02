import Link from "next/link";
import { ModuleKey } from "@prisma/client";

import {
  askAssistantAction,
  runAssistantAutomationAction,
  saveAssistantAutomationAction,
  toggleAssistantAutomationStatusAction
} from "@/modules/assistant/actions";
import {
  AssistantAskPendingBar,
  AssistantAskSubmitButton
} from "@/modules/assistant/components/assistant-ask-controls";
import { AssistantKnowledgeSyncButton } from "@/modules/assistant/components/assistant-sync-controls";
import { formatAssistantRole, getAssistantWorkspace } from "@/modules/assistant/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type AssistantPageProps = {
  searchParams?: Promise<{
    q?: string;
    thread?: string;
    sync?: string;
    localDocs?: string;
    microsoftDocs?: string;
    microsoftMail?: string;
    microsoftFiles?: string;
    localReason?: string;
    microsoftReason?: string;
  }>;
};

type AssistantWorkspace = Awaited<ReturnType<typeof getAssistantWorkspace>>;

const suggestedPrompts = [
  "Which customers or prospects need attention today?",
  "What sales opportunities are visible from current lead data?",
  "Draft a customer follow-up email using what we know.",
  "I need a rate from Charlotte NC 28273 to Dallas TX 75201 for 1 pallet 40x48x50 at 500 lbs.",
  "What problems should managers be watching for?"
];

export default async function AssistantPage({ searchParams }: AssistantPageProps) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);

  const params = await searchParams;
  const query = params?.q?.trim() ?? "";
  const threadId = params?.thread?.trim() || undefined;
  const syncStatus = buildSyncStatus(params);
  const workspace = await getAssistantWorkspace(context, query, threadId, context.userId);
  const runsByMessageId = new Map(
    (workspace.activeThread?.recentRuns ?? [])
      .filter((run) => run.messageId)
      .map((run) => [run.messageId as string, run])
  );

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.55fr_0.8fr]">
        <div className="flex min-h-[720px] flex-col rounded-lg border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Company Assistant</p>
              <h1 className="mt-1 text-xl font-semibold text-foreground">Ask Newl</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-mutedForeground">
                Customer context, sales signals, rate support, and drafting in one assistant surface.
              </p>
            </div>
            <div className="p-5">
              <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
                {formatIntent(workspace.intent)}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto border-y border-border bg-muted/20 px-5 py-4">
            {workspace.activeThread ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Active thread</p>
                    <h2 className="mt-1 text-base font-semibold text-foreground">{workspace.activeThread.title}</h2>
                    {workspace.activeThread.conversationSummary ? (
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-mutedForeground">
                        {workspace.activeThread.conversationSummary}
                      </p>
                    ) : null}
                  </div>
                  <Link href="/assistant" className="text-sm font-semibold text-primary hover:text-primaryHover">
                    New thread
                  </Link>
                </div>
                <div className="space-y-3">
                  {workspace.activeThread.messages.map((message: (typeof workspace.activeThread.messages)[number]) => {
                    const run = runsByMessageId.get(message.id);

                    return (
                      <div key={message.id} className="space-y-2">
                        <div
                          className={[
                            "max-w-[85%] rounded-lg border p-3",
                            message.role === "USER"
                              ? "ml-auto border-primary/25 bg-background"
                              : "mr-auto border-border bg-card"
                          ].join(" ")}
                        >
                          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                            {formatAssistantRole(message.role)}
                          </p>
                          <div className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{message.content}</div>
                        </div>
                        {message.role === "ASSISTANT" && run?.retrievedSources?.length ? (
                          <div className="mr-auto max-w-[85%] rounded-md border border-border bg-background p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                                Grounded In
                              </p>
                              <span className="text-xs text-mutedForeground">
                                {run.retrievedSources.length} source(s)
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {run.retrievedSources.slice(0, 4).map((source) => (
                                <span
                                  key={source.id}
                                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground"
                                >
                                  {source.title}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {workspace.activeThread.recentRuns[0]?.providerFallback ? (
                  <div className="rounded-md border border-warning/25 bg-warning/10 p-3 text-sm">
                    <p className="font-medium text-foreground">Live assistant reply failed</p>
                    <p className="mt-1 text-mutedForeground">
                      This answer used the built-in fallback instead of the configured live model.
                    </p>
                    {workspace.activeThread.recentRuns[0].liveReplyError ? (
                      <p className="mt-2 text-xs text-mutedForeground">
                        Provider error: {workspace.activeThread.recentRuns[0].liveReplyError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {workspace.activeThread.recentRuns[0]?.liveReplySkipped ? (
                  <div className="rounded-md border border-border bg-background p-3 text-sm">
                    <p className="font-medium text-foreground">Live assistant reply was not attempted</p>
                    <p className="mt-1 text-mutedForeground">
                      {workspace.activeThread.recentRuns[0].liveReplySkipReason ??
                        "The assistant stayed on deterministic mode before provider execution."}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-full flex-col justify-end">
                <div className="rounded-md border border-border bg-background p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Assistant response preview</p>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                    {workspace.answer.map((line: string) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <form className="border-t border-border bg-card p-5" action={askAssistantAction}>
            {workspace.activeThread ? <input type="hidden" name="threadId" value={workspace.activeThread.id} /> : null}
            <div className="rounded-lg border-2 border-primary/20 bg-background p-3">
              <textarea
                name="prompt"
                defaultValue={query}
                placeholder="Ask about a customer, opportunity, rate, risk, or draft email"
                rows={4}
                className="w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-foreground outline-none placeholder:text-mutedForeground"
              />
              <AssistantAskPendingBar />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex flex-wrap gap-2">
                  {suggestedPrompts.slice(0, 3).map((prompt: string) => (
                    <Link
                      key={prompt}
                      href={`/assistant?q=${encodeURIComponent(prompt)}`}
                      className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-mutedForeground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {prompt}
                    </Link>
                  ))}
                </div>
                <AssistantAskSubmitButton />
              </div>
            </div>
          </form>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-foreground">Signals</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Recent manager-facing risks, opportunities, and customer memory.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Risks" value={workspace.managerSummary.counts.risks} compact />
              <Metric label="Opportunities" value={workspace.managerSummary.counts.opportunities} compact />
              <Metric label="Customers" value={workspace.managerSummary.counts.customers} compact />
              <Metric label="Services" value={workspace.managerSummary.counts.services} compact />
            </div>
            <div className="mt-4 space-y-3">
              {workspace.managerSummary.topRisks.slice(0, 2).map((signal) => (
                <SignalItem
                  key={signal.id}
                  label="Risk"
                  title={signal.title}
                  summary={signal.summary}
                  timestamp={signal.lastObservedAt}
                />
              ))}
              {workspace.managerSummary.topOpportunities.slice(0, 2).map((signal) => (
                <SignalItem
                  key={signal.id}
                  label="Opportunity"
                  title={signal.title}
                  summary={signal.summary}
                  timestamp={signal.lastObservedAt}
                />
              ))}
              {workspace.managerSummary.topRisks.length === 0 && workspace.managerSummary.topOpportunities.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/20 p-4 text-sm text-mutedForeground">
                  No Microsoft or assistant signals are indexed yet.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Business memory</h2>
                <p className="mt-1 text-sm leading-6 text-mutedForeground">
                  Recent customer, service, opportunity, and risk memory available to the assistant right now.
                </p>
              </div>
              <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                {workspace.stats.memoryCount}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {workspace.recentMemories.slice(0, 4).map((memory) => (
                <div key={memory.id} className="rounded-md border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                        {formatMemoryKind(memory.kind)}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{memory.title}</p>
                    </div>
                    <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-mutedForeground">
                      {memory.confidence}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-mutedForeground">{truncate(memory.summary, 180)}</p>
                </div>
              ))}
              {workspace.recentMemories.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/20 p-4 text-sm text-mutedForeground">
                  No memory has been indexed yet. After knowledge syncs run, the assistant will show customer and business memory here.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Workspace</h2>
                <p className="mt-1 text-sm leading-6 text-mutedForeground">
                  Keep the assistant index current and switch between active threads.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <AssistantKnowledgeSyncButton />
              <Link
                href="/assistant"
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40"
              >
                New thread
              </Link>
            </div>
            {syncStatus ? (
              <div
                className={[
                  "mt-4 rounded-md border p-3 text-sm",
                  syncStatus.status === "success"
                    ? "border-success/25 bg-success/10"
                    : "border-warning/25 bg-warning/10"
                ].join(" ")}
              >
                <p className="font-medium text-foreground">{syncStatus.title}</p>
                <p className="mt-1 text-mutedForeground">{syncStatus.summary}</p>
                {syncStatus.reasons.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs text-mutedForeground">
                    {syncStatus.reasons.map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {workspace.recentThreads.length > 0 ? (
            <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Recent threads</h2>
                  <p className="mt-1 text-sm leading-6 text-mutedForeground">Jump back into recent conversations.</p>
                </div>
                <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                  {workspace.recentThreads.length}
                </span>
              </div>
              <div className="mt-4 grid max-h-80 gap-3 overflow-y-auto pr-1">
                {workspace.recentThreads.map((thread: AssistantWorkspace["recentThreads"][number]) => (
                  <Link
                    key={thread.id}
                    href={`/assistant?thread=${encodeURIComponent(thread.id)}`}
                    className={[
                      "block rounded-md border px-3 py-2 transition-colors hover:bg-muted/40",
                      workspace.activeThread?.id === thread.id ? "border-primary/50 bg-accentSoft/40" : "border-border bg-muted/20"
                    ].join(" ")}
                  >
                    <p className="truncate text-sm font-medium text-foreground">{thread.title}</p>
                    <p className="mt-1 text-xs text-mutedForeground">
                      {thread.messageCount} messages
                      {thread.lastMessageAt ? `, ${formatDate(thread.lastMessageAt)}` : ""}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-foreground">Automation inbox</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Latest results from your personal saved agents.
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {workspace.automationInbox.slice(0, 5).map((run: AssistantWorkspace["automationInbox"][number]) => (
                <div key={run.id} className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{run.automation.name}</p>
                      <p className="mt-1 text-xs text-mutedForeground">
                        {formatEnum(run.status)}{run.startedAt ? ` | ${formatDate(run.startedAt)}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-mutedForeground">{run.sourceCount} sources</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-foreground">{truncate(run.responseText, 160)}</p>
                </div>
              ))}
              {workspace.automationInbox.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/20 p-4 text-sm text-mutedForeground">
                  No personal agent runs yet. Run one manually or wait for the first scheduled summary.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">Quick view</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Companies" value={workspace.stats.companyCount} compact />
              <Metric label="Open Leads" value={workspace.stats.openLeadCount} compact />
              <Metric label="Knowledge Docs" value={workspace.stats.knowledgeDocumentCount} compact />
              <Metric label="Memory Items" value={workspace.stats.memoryCount} compact />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">Saved agents</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Personal recurring assistant flows for summaries and repetitive work.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric
                label="Active"
                value={
                  workspace.personalAutomations.filter(
                    (item: AssistantWorkspace["personalAutomations"][number]) => item.status === "ACTIVE"
                  ).length
                }
                compact
              />
              <Metric label="Total" value={workspace.personalAutomations.length} compact />
            </div>
          </section>
        </aside>
      </section>

      <section className="space-y-4">
        <details className="rounded-lg border border-border bg-card shadow-sm">
          <summary className="cursor-pointer list-none px-5 py-4 text-base font-semibold text-foreground">
            Saved Personal Agents
          </summary>
          <div className="space-y-5 border-t border-border px-5 py-5">
            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <form action={saveAssistantAutomationAction} className="rounded-md border border-border bg-muted/20 p-4">
                <h2 className="text-base font-semibold text-foreground">Create saved agent</h2>
                <p className="mt-1 text-sm leading-6 text-mutedForeground">
                  Save a recurring prompt for your own daily summaries, Apollo review, or issue scanning.
                </p>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Name</span>
                    <input
                      name="name"
                      placeholder="Morning sales and risk summary"
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-mutedForeground focus:border-primary"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Prompt</span>
                    <textarea
                      name="automationPrompt"
                      rows={5}
                      placeholder="Every morning, summarize potential customer issues, shipment risks, and new sales opportunities I should review."
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-mutedForeground focus:border-primary"
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Cadence</span>
                      <select
                        name="scheduleType"
                        defaultValue="DAILY"
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                      >
                        <option value="DAILY">Daily</option>
                        <option value="WEEKDAYS">Weekdays</option>
                        <option value="MONDAYS">Mondays</option>
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Time</span>
                      <input
                        name="scheduleTime"
                        type="time"
                        defaultValue="08:00"
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Timezone</span>
                      <input
                        name="scheduleTimezone"
                        defaultValue="America/Toronto"
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                      />
                    </label>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
                    >
                      Save agent
                    </button>
                  </div>
                </div>
              </form>

              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Your saved agents</h2>
                  <p className="mt-1 text-sm leading-6 text-mutedForeground">
                    These are user-specific. They are not shared across the company.
                  </p>
                </div>
                {workspace.personalAutomations.map((automation: AssistantWorkspace["personalAutomations"][number]) => (
                  <div key={automation.id} className="rounded-md border border-border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{automation.name}</p>
                        <p className="mt-1 text-xs text-mutedForeground">{automation.scheduleSummary}</p>
                      </div>
                      <span
                        className={[
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          automation.status === "ACTIVE"
                            ? "bg-success/10 text-success"
                            : "border border-border bg-background text-mutedForeground"
                        ].join(" ")}
                      >
                        {formatEnum(automation.status)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-foreground">{automation.prompt}</p>
                    {automation.lastResultSummary ? (
                      <div className="mt-3 rounded-md border border-border bg-background px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Latest result</p>
                        <p className="mt-1 text-sm leading-6 text-foreground">{automation.lastResultSummary}</p>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-mutedForeground">
                      <span>{automation.lastRunAt ? `Last run ${formatDate(automation.lastRunAt)}` : "Not run yet"}</span>
                      {automation.nextRunAt ? <span>Next run {formatDate(automation.nextRunAt)}</span> : null}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <form action={runAssistantAutomationAction}>
                        <input type="hidden" name="automationId" value={automation.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40"
                        >
                          Run now
                        </button>
                      </form>
                      <form action={toggleAssistantAutomationStatusAction}>
                        <input type="hidden" name="automationId" value={automation.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40"
                        >
                          {automation.status === "ACTIVE" ? "Pause" : "Resume"}
                        </button>
                      </form>
                    </div>
                    {automation.recentRuns.length > 0 ? (
                      <div className="mt-4 space-y-2 border-t border-border pt-4">
                        {automation.recentRuns.map((run: AssistantWorkspace["personalAutomations"][number]["recentRuns"][number]) => (
                          <div key={run.id} className="rounded-md border border-border bg-background px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                                {formatEnum(run.status)} | {formatDate(run.startedAt)}
                              </p>
                              <p className="text-xs text-mutedForeground">{run.sourceCount} sources</p>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-foreground">{truncate(run.responseText, 220)}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {workspace.personalAutomations.length === 0 ? (
                  <p className="rounded-md border border-border bg-muted/20 p-4 text-sm text-mutedForeground">
                    No saved agents yet. Start with a morning opportunity summary or an Apollo cold-call recap.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </details>

        <details className="rounded-lg border border-border bg-card shadow-sm">
          <summary className="cursor-pointer list-none px-5 py-4 text-base font-semibold text-foreground">
            Knowledge and Memory
          </summary>
          <div className="grid gap-4 border-t border-border px-5 py-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div>
              <h2 className="text-base font-semibold text-foreground">Knowledge coverage</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Indexed source counts by business record type for this tenant.
              </p>
              <div className="mt-4 space-y-3">
                {workspace.knowledgeCoverage.map((entry: AssistantWorkspace["knowledgeCoverage"][number]) => (
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

            <div>
              <h2 className="text-base font-semibold text-foreground">Active memory</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                High-confidence customer and opportunity summaries currently available for retrieval.
              </p>
              <div className="mt-4 grid gap-3">
                {workspace.recentMemories.map((memory: AssistantWorkspace["recentMemories"][number]) => (
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
          </div>
        </details>

        <details className="rounded-lg border border-border bg-card shadow-sm">
          <summary className="cursor-pointer list-none px-5 py-4 text-base font-semibold text-foreground">
            Business Context and Tool Readiness
          </summary>
          <div className="space-y-4 border-t border-border px-5 py-5">
            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <div className="rounded-md border border-border bg-card p-5">
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
                      {workspace.topCompanies.map((company: AssistantWorkspace["topCompanies"][number]) => (
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
                <section className="rounded-md border border-border bg-card p-5">
                  <h2 className="text-base font-semibold text-foreground">Rate tool handoff</h2>
                  <p className="mt-1 text-sm leading-6 text-mutedForeground">
                    The assistant should collect structured rating details and then call these tenant tools.
                  </p>
                  <div className="mt-4 grid gap-3">
                    <ToolLink href="/ups-tools/rate-quote" title="UPS Shipment Rate Quote" detail="Parcel and UPS account pricing" />
                    <ToolLink href="/ltl-rate-portal" title="LTL Rate Portal" detail="7L-backed LTL lane quoting" />
                  </div>
                </section>

                <section className="rounded-md border border-border bg-card p-5">
                  <h2 className="text-base font-semibold text-foreground">Source readiness</h2>
                  <div className="mt-4 space-y-3">
                    {workspace.integrations.map((integration: AssistantWorkspace["integrations"][number]) => (
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
            </div>
            <div className="rounded-md border border-border bg-card p-5">
              <h2 className="text-base font-semibold text-foreground">Open opportunity context</h2>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {workspace.openLeads.map((lead: AssistantWorkspace["openLeads"][number]) => (
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
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: number; compact?: boolean }) {
  return (
    <div className={compact ? "rounded-md border border-border bg-muted/30 p-3" : "rounded-lg border border-border bg-card p-4 shadow-sm"}>
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className={compact ? "mt-2 text-lg font-semibold text-foreground" : "mt-2 text-2xl font-semibold text-foreground"}>
        {value.toLocaleString("en-US")}
      </p>
    </div>
  );
}

function SignalItem({
  label,
  title,
  summary,
  timestamp
}: {
  label: string;
  title: string;
  summary: string;
  timestamp: Date | null;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
        <span className="text-xs text-mutedForeground">{timestamp ? formatDate(timestamp) : "Recent"}</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">{truncate(summary, 140)}</p>
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

function buildSyncStatus(params: Awaited<AssistantPageProps["searchParams"]>) {
  const status = params?.sync;
  if (status !== "success" && status !== "partial") {
    return null;
  }

  const localDocs = readCountParam(params?.localDocs);
  const microsoftDocs = readCountParam(params?.microsoftDocs);
  const microsoftMail = readCountParam(params?.microsoftMail);
  const microsoftFiles = readCountParam(params?.microsoftFiles);
  const reasons = [
    params?.localReason ? `Local knowledge: ${params.localReason.trim()}` : null,
    params?.microsoftReason ? `Microsoft 365: ${params.microsoftReason.trim()}` : null
  ].filter((reason): reason is string => Boolean(reason));

  return {
    status,
    title: status === "success" ? "Knowledge sync complete" : "Knowledge sync partially complete",
    summary:
      `Indexed ${localDocs.toLocaleString("en-US")} app document(s), ` +
      `${microsoftDocs.toLocaleString("en-US")} Microsoft document(s), ` +
      `${microsoftMail.toLocaleString("en-US")} email(s), and ` +
      `${microsoftFiles.toLocaleString("en-US")} file(s).`,
    reasons
  };
}

function readCountParam(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatIntent(intent: string) {
  return formatEnum(intent).replace("Rate Request", "Rate Request Flow");
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatMemoryKind(value: string) {
  return formatEnum(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
