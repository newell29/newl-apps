"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

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
  generatedAt: string;
};

export function NemoFeedbackClient({ isAdmin }: { isAdmin: boolean }) {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, { title: string; ruleText: string }>>({});

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

  async function reviewFeedback(feedbackId: string, status: "CONFIRMED" | "REJECTED") {
    setBusy(true);
    const response = await fetch(`/api/assistant/operational-feedback/${feedbackId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "review", status })
    });
    setMessage(response.ok ? `Feedback marked ${status.toLowerCase()}.` : "The feedback decision could not be saved.");
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
      body: JSON.stringify({ status })
    });
    setMessage(
      response.ok
        ? status === "APPROVED"
          ? "Suggestion approved for a separate, reviewed development task. No code was started."
          : "Suggestion rejected."
        : "The suggestion decision could not be saved."
    );
    await load();
    setBusy(false);
  }

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
            <div><h2 className="text-lg font-semibold text-foreground">Feedback review</h2><p className="text-sm text-mutedForeground">{isAdmin ? "All tenant feedback" : "Your submitted feedback"}</p></div>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold">{feedback.length}</span>
          </div>
          <div className="mt-4 space-y-3">
            {feedback.length === 0 ? <p className="text-sm text-mutedForeground">No feedback has been submitted.</p> : feedback.map((item) => (
              <article key={item.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{item.subjectId || "General workflow"}</p><span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">{item.status}</span></div>
                <p className="mt-2 text-sm leading-6 text-foreground">{item.reporterStatement}</p>
                <p className="mt-2 text-xs text-mutedForeground">Observed: {item.observedOutcome || "not supplied"} · Expected: {item.expectedOutcome || "not supplied"} · {new Date(item.createdAt).toLocaleString()}</p>
                {isAdmin && ["REPORTED", "INVESTIGATING"].includes(item.status) ? <div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => void reviewFeedback(item.id, "CONFIRMED")} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground">Confirm</button><button disabled={busy} onClick={() => void reviewFeedback(item.id, "REJECTED")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">Reject</button></div> : null}
                {isAdmin && item.status === "CONFIRMED" ? <div className="mt-4 space-y-2 border-t border-border pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Optional approved memory</p><input value={lessonDrafts[item.id]?.title ?? ""} onChange={(event) => setLessonDrafts((current) => ({ ...current, [item.id]: { title: event.target.value, ruleText: current[item.id]?.ruleText ?? "" } }))} className="w-full rounded-md border border-border px-3 py-2 text-sm" placeholder="Lesson title" /><textarea value={lessonDrafts[item.id]?.ruleText ?? ""} onChange={(event) => setLessonDrafts((current) => ({ ...current, [item.id]: { title: current[item.id]?.title ?? "", ruleText: event.target.value } }))} className="w-full rounded-md border border-border px-3 py-2 text-sm" rows={3} placeholder="Exact approved rule Nemo may use" /><button disabled={busy} onClick={() => void promoteLesson(item.id)} className="rounded-md border border-primary px-3 py-1.5 text-xs font-semibold text-primary">Approve as Nemo lesson</button></div> : null}
              </article>
            ))}
          </div>
        </section>

        {isAdmin ? <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-foreground">Development suggestions</h2><p className="mt-1 text-sm text-mutedForeground">Approval is a decision only; Codex work starts separately.</p></div><button disabled={busy} onClick={() => void generateSuggestions()} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Refresh queue</button></div><div className="mt-4 space-y-3">{suggestions.length === 0 ? <p className="text-sm text-mutedForeground">No development suggestions yet.</p> : suggestions.map((item) => <article key={item.id} className="rounded-md border border-border bg-background p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{item.title}</p><span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">{item.status}</span></div><p className="mt-2 text-sm text-foreground">{item.summary}</p><p className="mt-2 text-xs text-mutedForeground">{item.feedbackCount} feedback item(s) · {item.riskLevel} risk</p>{item.status === "AWAITING_APPROVAL" ? <div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => void decideSuggestion(item.id, "APPROVED")} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground">Approve suggestion</button><button disabled={busy} onClick={() => void decideSuggestion(item.id, "REJECTED")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">Reject</button></div> : null}</article>)}</div></section> : null}
      </div>
    </div>
  );
}
