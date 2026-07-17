import Link from "next/link";
import { ModuleKey } from "@prisma/client";

import { askAssistantAction } from "@/modules/assistant/actions";
import {
  AssistantAskPendingBar,
  AssistantAskSubmitButton,
} from "@/modules/assistant/components/assistant-ask-controls";
import {
  formatAssistantRole,
  getAssistantWorkspace,
} from "@/modules/assistant/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type AssistantPageProps = {
  searchParams?: Promise<{
    q?: string;
    thread?: string;
  }>;
};

type AssistantWorkspace = Awaited<ReturnType<typeof getAssistantWorkspace>>;

const suggestedPrompts = [
  "Which customers or prospects need attention today?",
  "What sales opportunities are visible from current lead data?",
  "Draft a customer follow-up email using what we know.",
  "I need a rate from Charlotte NC 28273 to Dallas TX 75201 for 1 pallet 40x48x50 at 500 lbs.",
  "What problems should managers be watching for?",
];

export default async function AssistantPage({
  searchParams,
}: AssistantPageProps) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);

  const params = await searchParams;
  const query = params?.q?.trim() ?? "";
  const threadId = params?.thread?.trim() || undefined;
  const workspace = await getAssistantWorkspace(
    context,
    query,
    threadId,
    context.userId,
  );
  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.55fr_0.8fr]">
        <div className="flex min-h-[720px] flex-col rounded-lg border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                Company Assistant
              </p>
              <h1 className="mt-1 text-xl font-semibold text-foreground">
                Ask Newl
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-mutedForeground">
                Ask questions, review conversation history, and keep the
                workspace focused on the chat.
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
                    <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                      Active thread
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-foreground">
                      {workspace.activeThread.title}
                    </h2>
                    {workspace.activeThread.conversationSummary ? (
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-mutedForeground">
                        {workspace.activeThread.conversationSummary}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href="/assistant"
                    className="text-sm font-semibold text-primary hover:text-primaryHover"
                  >
                    New thread
                  </Link>
                </div>
                <div className="space-y-3">
                  {workspace.activeThread.messages.map(
                    (
                      message: (typeof workspace.activeThread.messages)[number],
                    ) => (
                      <div key={message.id} className="space-y-2">
                        <div
                          className={[
                            "max-w-[85%] rounded-lg border p-3",
                            message.role === "USER"
                              ? "ml-auto border-primary/25 bg-background"
                              : "mr-auto border-border bg-card",
                          ].join(" ")}
                        >
                          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                            {formatAssistantRole(message.role)}
                          </p>
                          <div className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">
                            {message.content}
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
                {workspace.activeThread.recentRuns[0]?.providerFallback ? (
                  <div className="rounded-md border border-warning/25 bg-warning/10 p-3 text-sm">
                    <p className="font-medium text-foreground">
                      Live assistant reply failed
                    </p>
                    <p className="mt-1 text-mutedForeground">
                      This answer used the built-in fallback instead of the
                      configured live model.
                    </p>
                    {workspace.activeThread.recentRuns[0].liveReplyError ? (
                      <p className="mt-2 text-xs text-mutedForeground">
                        Provider error:{" "}
                        {workspace.activeThread.recentRuns[0].liveReplyError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {workspace.activeThread.recentRuns[0]?.liveReplySkipped ? (
                  <div className="rounded-md border border-border bg-background p-3 text-sm">
                    <p className="font-medium text-foreground">
                      Live assistant reply was not attempted
                    </p>
                    <p className="mt-1 text-mutedForeground">
                      {workspace.activeThread.recentRuns[0]
                        .liveReplySkipReason ??
                        "The assistant stayed on deterministic mode before provider execution."}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-full flex-col justify-end">
                <div className="rounded-md border border-border bg-background p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                    Assistant response preview
                  </p>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                    {workspace.answer.map((line: string) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <form
            className="border-t border-border bg-card p-5"
            action={askAssistantAction}
          >
            {workspace.activeThread ? (
              <input
                type="hidden"
                name="threadId"
                value={workspace.activeThread.id}
              />
            ) : null}
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Chat history
                </h2>
                <p className="mt-1 text-sm leading-6 text-mutedForeground">
                  Jump back into recent conversations.
                </p>
              </div>
              <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                {workspace.recentThreads.length}
              </span>
            </div>
            <div className="mt-4 grid max-h-[620px] gap-2 overflow-y-auto pr-1">
              {workspace.recentThreads.map(
                (thread: AssistantWorkspace["recentThreads"][number]) => (
                  <Link
                    key={thread.id}
                    href={`/assistant?thread=${encodeURIComponent(thread.id)}`}
                    className={[
                      "block rounded-md border px-3 py-2 transition-colors hover:bg-muted/40",
                      workspace.activeThread?.id === thread.id
                        ? "border-primary/50 bg-accentSoft/40"
                        : "border-border bg-muted/20",
                    ].join(" ")}
                  >
                    <p className="truncate text-sm font-medium text-foreground">
                      {thread.title}
                    </p>
                    <p className="mt-1 text-xs text-mutedForeground">
                      {thread.messageCount} messages
                      {thread.lastMessageAt
                        ? `, ${formatDate(thread.lastMessageAt)}`
                        : ""}
                    </p>
                  </Link>
                ),
              )}
              {workspace.recentThreads.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/20 p-4 text-sm text-mutedForeground">
                  No chat history yet. Start by asking a question.
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
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

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
