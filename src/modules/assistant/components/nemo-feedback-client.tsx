"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { partitionFeedbackReview } from "@/modules/assistant/feedback-review-display";

type Feedback = {
  id: string;
  subjectId: string | null;
  reporterStatement: string;
  expectedOutcome: string | null;
  observedOutcome: string | null;
  classification: string;
  status: string;
  resolutionNotes: string | null;
  createdAt: string;
};

type Suggestion = {
  id: string;
  title: string;
  summary: string;
  rationale: string;
  status: string;
  riskLevel: string;
  feedbackCount: number;
  followUpFeedbackCount: number;
  regressionOfSuggestionId: string | null;
  generatedAt: string;
  pullRequestUrl: string | null;
  decisionNotes: string | null;
  feedbackItems: Array<{
    id: string;
    subjectId: string | null;
    reporterStatement: string;
    expectedOutcome: string | null;
    observedOutcome: string | null;
    classification: string;
    status: string;
    createdAt: string;
    evidenceRole: "APPROVED_PACKET" | "FOLLOW_UP";
  }>;
  developmentJob: {
    status: string;
    phase: string;
    progressMessage: string | null;
    pullRequestUrls: string[];
    errorMessage: string | null;
    reviewVerdict: string | null;
    reviewAttempt: number | null;
    reviewRiskLevel: string | null;
    reviewSummary: string | null;
    unresolvedFindingCount: number;
  } | null;
};

export function NemoFeedbackClient({ isAdmin }: { isAdmin: boolean }) {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false);
  const [resolveConfirmId, setResolveConfirmId] = useState<string | null>(null);
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, { title: string; ruleText: string }>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<
    Record<string, { observedOutcome: string; expectedOutcome: string }>
  >({});
  const [suggestionNotes, setSuggestionNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const feedbackResponse = await fetch("/api/assistant/operational-feedback?status=ALL", { cache: "no-store" });
    const feedbackBody = await feedbackResponse.json().catch(() => ({}));
    if (feedbackResponse.ok) setFeedback(feedbackBody.data ?? []);
    if (isAdmin) {
      const suggestionResponse = await fetch("/api/assistant/development-suggestions", { cache: "no-store" });
      const suggestionBody = await suggestionResponse.json().catch(() => ({}));
      if (suggestionResponse.ok) setSuggestions(suggestionBody.data ?? []);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/assistant/operational-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        subjectType: "GARLAND_CHECK",
        subjectId: data.get("subjectId"),
        reporterStatement: data.get("reporterStatement"),
        expectedOutcome: data.get("expectedOutcome"),
        observedOutcome: data.get("observedOutcome"),
        classification: "CHECK_RESULT"
      })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Feedback saved for review. It has not changed Nemo's rules." : body.error ?? "Feedback could not be saved.");
    if (response.ok) {
      event.currentTarget.reset();
      await load();
    }
    setBusy(false);
  }

  function feedbackOutcomes(item: Feedback) {
    return feedbackDrafts[item.id] ?? {
      observedOutcome: item.observedOutcome ?? "",
      expectedOutcome: item.expectedOutcome ?? ""
    };
  }

  function setFeedbackOutcome(
    item: Feedback,
    field: "observedOutcome" | "expectedOutcome",
    value: string
  ) {
    setFeedbackDrafts((current) => ({
      ...current,
      [item.id]: {
        ...(current[item.id] ?? {
          observedOutcome: item.observedOutcome ?? "",
          expectedOutcome: item.expectedOutcome ?? ""
        }),
        [field]: value
      }
    }));
  }

  async function saveFeedbackOutcomes(item: Feedback) {
    const draft = feedbackOutcomes(item);
    setBusy(true);
    const response = await fetch(`/api/assistant/operational-feedback/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update_review_fields",
        ...draft
      })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "The review results were corrected." : body.error ?? "The review results could not be saved.");
    if (response.ok) {
      setFeedbackDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
    await load();
    setBusy(false);
  }

  async function reviewFeedback(item: Feedback, status: "CONFIRMED" | "REJECTED") {
    const draft = feedbackOutcomes(item);
    setBusy(true);
    const response = await fetch(`/api/assistant/operational-feedback/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "review", status, ...draft })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? `Feedback marked ${status.toLowerCase()}.`
        : body.error ?? "The feedback decision could not be saved."
    );
    await load();
    setBusy(false);
  }

  async function promoteLesson(feedbackId: string) {
    const draft = lessonDrafts[feedbackId];
    if (!draft?.title.trim() || !draft.ruleText.trim()) {
      setMessage("Enter a lesson title and approved rule first.");
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/assistant/operational-feedback/${feedbackId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve_lesson", ...draft, confidence: 100 })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "The lesson is now approved understanding for Nemo." : body.error ?? "The lesson could not be approved.");
    await load();
    setBusy(false);
  }

  async function generateSuggestions() {
    setBusy(true);
    const response = await fetch("/api/assistant/development-suggestions", { method: "POST" });
    setMessage(response.ok ? "The approval queue is up to date. No development was started." : "The suggestion queue could not be updated.");
    await load();
    setBusy(false);
  }

  async function decideSuggestion(id: string, status: "APPROVED" | "REJECTED") {
    setBusy(true);
    const response = await fetch(`/api/assistant/development-suggestions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status,
        decisionNotes: suggestionNotes[id]?.trim() || null
      })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? status === "APPROVED"
          ? `Suggestion approved. Rivet job ${String(body.data?.developmentJob?.id ?? "")} is queued for the local Codex worker.`
          : "Suggestion rejected."
        : body.error ?? "The suggestion decision could not be saved."
    );
    await load();
    setBusy(false);
  }

  async function retrySuggestion(id: string) {
    setBusy(true);
    const response = await fetch(`/api/assistant/development-suggestions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "retry" })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? `Rivet job ${String(body.data?.developmentJob?.id ?? "")} was queued again.`
        : body.error ?? "The Rivet job could not be retried."
    );
    await load();
    setBusy(false);
  }

  async function resolveSuggestion(id: string) {
    setBusy(true);
    const response = await fetch(`/api/assistant/development-suggestions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resolve_deployed" })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? "The deployed fix was recorded. Older feedback was resolved; later reports will reopen this issue as a regression."
        : body.error ?? "The deployed fix could not be recorded."
    );
    setResolveConfirmId(null);
    await load();
    setBusy(false);
  }

  const activeSuggestions = suggestions.filter((item) =>
    !["REJECTED", "RESOLVED", "SUPERSEDED"].includes(item.status)
  );
  const archivedSuggestionCount = suggestions.length - activeSuggestions.length;
  const { active: activeFeedback, archived: archivedFeedback } = partitionFeedbackReview(feedback);
  const visibleFeedback = showFeedbackHistory ? [...activeFeedback, ...archivedFeedback] : activeFeedback;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={submitFeedback} className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Report a result</h2>
          <p className="mt-1 text-sm text-mutedForeground">Tell us what happened and what should have happened.</p>
        </div>
        <label className="block text-sm font-medium text-foreground">
          PS or SR number
          <input name="subjectId" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" placeholder="PS123456 or SR812345" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-foreground">
            Nemo reported
            <select name="observedOutcome" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2">
              <option value="">Choose</option><option>PASS</option><option>FAIL</option><option>MISSING</option><option>PENDING</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-foreground">
            Expected result
            <select name="expectedOutcome" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2">
              <option value="">Choose</option><option>PASS</option><option>FAIL</option><option>MISSING</option><option>PENDING</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium text-foreground">
          What should we know?
          <textarea required name="reporterStatement" rows={5} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
        </label>
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:opacity-50">Save feedback</button>
        {message ? <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground">{message}</p> : null}
      </form>

      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-foreground">Feedback review</h2><p className="text-sm text-mutedForeground">{isAdmin ? "Pending tenant feedback" : "Your pending feedback"}</p></div>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold">{activeFeedback.length}</span>
          </div>
          {archivedFeedback.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
              <p className="text-xs text-mutedForeground">
                {archivedFeedback.length} confirmed, rejected, or resolved finding(s) are hidden.
              </p>
              <button
                type="button"
                onClick={() => setShowFeedbackHistory((current) => !current)}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold"
              >
                {showFeedbackHistory ? "Hide history" : "Show history"}
              </button>
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {visibleFeedback.length === 0 ? <p className="text-sm text-mutedForeground">No feedback is waiting for review.</p> : visibleFeedback.map((item) => (
              <article key={item.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{item.subjectId || "General workflow"}</p><span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">{item.status}</span></div>
                <details className="mt-2" open={item.reporterStatement.length <= 320}>
                  <summary className="cursor-pointer text-sm font-semibold text-primary">
                    {item.reporterStatement.length > 320 ? "Show full feedback message" : "Feedback message"}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {item.reporterStatement}
                  </p>
                </details>
                {isAdmin && ["REPORTED", "INVESTIGATING"].includes(item.status) ? (
                  <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                      Correct the result before confirming
                    </p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-medium text-foreground">
                        Nemo reported
                        <select
                          value={feedbackOutcomes(item).observedOutcome}
                          onChange={(event) => setFeedbackOutcome(item, "observedOutcome", event.target.value)}
                          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
                        >
                          <option value="">Choose</option>
                          <option>PASS</option>
                          <option>FAIL</option>
                          <option>MISSING</option>
                          <option>PENDING</option>
                        </select>
                      </label>
                      <label className="text-xs font-medium text-foreground">
                        Expected result
                        <select
                          value={feedbackOutcomes(item).expectedOutcome}
                          onChange={(event) => setFeedbackOutcome(item, "expectedOutcome", event.target.value)}
                          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
                        >
                          <option value="">Choose</option>
                          <option>PASS</option>
                          <option>FAIL</option>
                          <option>MISSING</option>
                          <option>PENDING</option>
                        </select>
                      </label>
                    </div>
                    {feedbackOutcomes(item).observedOutcome &&
                    feedbackOutcomes(item).observedOutcome === feedbackOutcomes(item).expectedOutcome ? (
                      <p className="mt-2 text-xs font-semibold text-destructive">
                        These results are the same. Correct one before confirming this as a development issue.
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        disabled={busy}
                        onClick={() => void saveFeedbackOutcomes(item)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                      >
                        Save result changes
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void reviewFeedback(item, "CONFIRMED")}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground"
                      >
                        Confirm
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void reviewFeedback(item, "REJECTED")}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-mutedForeground">
                    Observed: {item.observedOutcome || "not supplied"} · Expected: {item.expectedOutcome || "not supplied"} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                )}
                {isAdmin && item.status === "CONFIRMED" ? <div className="mt-4 space-y-2 border-t border-border pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Optional approved memory</p><input value={lessonDrafts[item.id]?.title ?? ""} onChange={(event) => setLessonDrafts((current) => ({ ...current, [item.id]: { title: event.target.value, ruleText: current[item.id]?.ruleText ?? "" } }))} className="w-full rounded-md border border-border px-3 py-2 text-sm" placeholder="Lesson title" /><textarea value={lessonDrafts[item.id]?.ruleText ?? ""} onChange={(event) => setLessonDrafts((current) => ({ ...current, [item.id]: { title: current[item.id]?.title ?? "", ruleText: event.target.value } }))} className="w-full rounded-md border border-border px-3 py-2 text-sm" rows={3} placeholder="Exact approved rule Nemo may use" /><button disabled={busy} onClick={() => void promoteLesson(item.id)} className="rounded-md border border-primary px-3 py-1.5 text-xs font-semibold text-primary">Approve as Nemo lesson</button></div> : null}
              </article>
            ))}
          </div>
        </section>

        {isAdmin ? (
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Development suggestions</h2>
                <p className="mt-1 text-sm text-mutedForeground">
                  Similar feedback is grouped first. Rivet builds a draft PR, independently reviews the exact commit, and only marks a passing result ready for you.
                </p>
              </div>
              <button disabled={busy} onClick={() => void generateSuggestions()} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">
                Refresh queue
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {archivedSuggestionCount > 0 ? (
                <p className="text-xs text-mutedForeground">
                  {archivedSuggestionCount} resolved, rejected, or superseded suggestion(s) are hidden from the active queue.
                </p>
              ) : null}
              {activeSuggestions.length === 0 ? (
                <p className="text-sm text-mutedForeground">No development suggestions yet.</p>
              ) : activeSuggestions.map((item) => (
                <article key={item.id} className="rounded-md border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">{item.title}</p>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">
                      {item.developmentJob?.phase ?? item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-foreground">
                    {item.summary.length > 360 ? `${item.summary.slice(0, 360).trim()}…` : item.summary}
                  </p>
                  <p className="mt-2 text-xs text-mutedForeground">{item.feedbackCount} similar feedback item(s) · {item.riskLevel} risk</p>
                  {item.feedbackItems.length > 0 ? (
                    <details className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-primary">
                        Review all {item.feedbackItems.length} full feedback message(s)
                      </summary>
                      <div className="mt-3 space-y-3">
                        {item.feedbackItems.map((feedbackItem) => (
                          <div key={`${feedbackItem.evidenceRole}-${feedbackItem.id}`} className="rounded-md border border-border bg-background p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-foreground">
                                {feedbackItem.subjectId || "General workflow"}
                              </p>
                              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold">
                                {feedbackItem.evidenceRole === "FOLLOW_UP" ? "FOLLOW-UP" : feedbackItem.status}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                              {feedbackItem.reporterStatement}
                            </p>
                            <p className="mt-2 text-xs text-mutedForeground">
                              Observed: {feedbackItem.observedOutcome || "not supplied"} · Expected: {feedbackItem.expectedOutcome || "not supplied"} · {new Date(feedbackItem.createdAt).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {item.followUpFeedbackCount > 0 ? (
                    <p className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs text-foreground">
                      {item.followUpFeedbackCount} later report(s) are attached as follow-up evidence. They did not change the already-approved Rivet packet.
                    </p>
                  ) : null}
                  {item.regressionOfSuggestionId ? (
                    <p className="mt-2 text-xs font-semibold text-destructive">
                      Post-deployment regression of issue family {item.regressionOfSuggestionId}.
                    </p>
                  ) : null}
                  {item.developmentJob?.progressMessage ? (
                    <p className="mt-2 text-xs text-mutedForeground">{item.developmentJob.progressMessage}</p>
                  ) : null}
                  {item.developmentJob?.reviewVerdict ? (
                    <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground">
                      <p className="font-semibold">
                        Independent Codex review: {item.developmentJob.reviewVerdict}
                        {item.developmentJob.reviewRiskLevel ? ` · ${item.developmentJob.reviewRiskLevel} risk` : ""}
                        {item.developmentJob.reviewAttempt ? ` · round ${item.developmentJob.reviewAttempt}` : ""}
                      </p>
                      {item.developmentJob.reviewSummary ? <p className="mt-1">{item.developmentJob.reviewSummary}</p> : null}
                      {item.developmentJob.unresolvedFindingCount > 0 ? (
                        <p className="mt-1 font-semibold">{item.developmentJob.unresolvedFindingCount} unresolved finding(s)</p>
                      ) : null}
                    </div>
                  ) : null}
                  {item.developmentJob?.pullRequestUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 block text-sm font-semibold text-primary underline">
                      Review Rivet pull request
                    </a>
                  ))}
                  {item.developmentJob?.errorMessage ? (
                    <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      {item.developmentJob.errorMessage}
                    </p>
                  ) : null}
                  {item.status === "AWAITING_APPROVAL" ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                        Additional comments for Rivet
                        <textarea
                          value={suggestionNotes[item.id] ?? ""}
                          onChange={(event) => setSuggestionNotes((current) => ({
                            ...current,
                            [item.id]: event.target.value
                          }))}
                          rows={4}
                          maxLength={4000}
                          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
                          placeholder="Add corrections, source-document context, or exact behaviour Rivet must preserve."
                        />
                      </label>
                      <p className="mt-1 text-xs text-mutedForeground">
                        These comments are stored with the approval and included in Rivet&apos;s approved development packet.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button disabled={busy} onClick={() => void decideSuggestion(item.id, "APPROVED")} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground">
                          Approve &amp; start Rivet
                        </button>
                        <button disabled={busy} onClick={() => void decideSuggestion(item.id, "REJECTED")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {item.decisionNotes ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                        Approval comments sent to Rivet
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{item.decisionNotes}</p>
                    </div>
                  ) : null}
                  {item.developmentJob?.status === "ERROR" ? (
                    <button disabled={busy} onClick={() => void retrySuggestion(item.id)} className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
                      Retry Rivet
                    </button>
                  ) : null}
                  {item.status === "APPROVED" && item.pullRequestUrl && ["READY_FOR_ALEX", "PR_OPEN"].includes(item.developmentJob?.phase ?? "") ? (
                    resolveConfirmId === item.id ? (
                      <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                        <p className="text-xs text-foreground">
                          Confirm only after this exact reviewed pull request is merged and deployed to production.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button disabled={busy} onClick={() => void resolveSuggestion(item.id)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground">
                            Confirm fixed in production
                          </button>
                          <button disabled={busy} onClick={() => setResolveConfirmId(null)} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button disabled={busy} onClick={() => setResolveConfirmId(item.id)} className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
                        Mark merged and deployed
                      </button>
                    )
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
