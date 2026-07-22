import { ModuleKey } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getLeadScoringHistory } from "@/modules/lead-gen/score-history";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function LeadScoringHistoryPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const history = await getLeadScoringHistory(context.tenantId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Scoring History & Outcomes"
        description="Audit how company and contact scores changed, which scoring version produced them, and what happened afterward."
      />

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Score snapshots" value={history.snapshots.length} />
        <SummaryCard label="Outcome events" value={history.outcomes.length} />
        <SummaryCard
          label="Scoring versions"
          value={new Set(history.snapshots.map((snapshot) => snapshot.modelVersion)).size}
        />
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Recent score snapshots</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Snapshots are created by ingestion, company approval, Apollo sync, or an Apollo push—not by opening a page.
          </p>
        </div>
        {history.snapshots.length === 0 ? (
          <EmptyState message="No score snapshots yet. The next TradeMining ingestion or qualified workflow event will create one." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-card text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.snapshots.map((snapshot) => (
                  <tr key={snapshot.id} className="align-top">
                    <td className="px-4 py-3">
                      <Link
                        className="font-semibold text-primary hover:underline"
                        href={`/lead-gen/candidates?q=${encodeURIComponent(snapshot.company.name)}`}
                      >
                        {snapshot.company.name}
                      </Link>
                      {snapshot.explanation ? (
                        <p className="mt-1 max-w-xl text-xs text-mutedForeground">{snapshot.explanation}</p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-lg font-semibold text-foreground">{snapshot.score}</span>
                      {snapshot.scoreDelta !== null ? (
                        <span
                          className={`ml-2 text-xs font-semibold ${
                            snapshot.scoreDelta > 0
                              ? "text-emerald-700"
                              : snapshot.scoreDelta < 0
                                ? "text-red-700"
                                : "text-mutedForeground"
                          }`}
                        >
                          {snapshot.scoreDelta > 0 ? "+" : ""}
                          {snapshot.scoreDelta}
                        </span>
                      ) : null}
                      {snapshot.tier ? <p className="text-xs text-mutedForeground">{formatLabel(snapshot.tier)}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-mutedForeground">{formatLabel(snapshot.scoreType)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-mutedForeground">{formatLabel(snapshot.trigger)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="font-medium text-foreground">{snapshot.modelVersion}</p>
                      <p className="font-mono text-xs text-mutedForeground" title={snapshot.configFingerprint}>
                        Config {snapshot.configFingerprint.slice(0, 8)}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-mutedForeground">{formatDate(snapshot.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Recent outcomes</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Status changes, pipeline movement, Apollo enrollment, and reply changes are kept separately from scores.
          </p>
        </div>
        {history.outcomes.length === 0 ? (
          <EmptyState message="No outcomes have been recorded since history tracking was enabled." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-card text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Change</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Occurred</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.outcomes.map((outcome) => (
                  <tr key={outcome.id}>
                    <td className="px-4 py-3 font-semibold text-foreground">{outcome.company.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-mutedForeground">{formatLabel(outcome.outcomeType)}</td>
                    <td className="px-4 py-3 text-mutedForeground">
                      {formatChange(outcome.previousValue, outcome.currentValue)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-mutedForeground">{formatLabel(outcome.source)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-mutedForeground">{formatDate(outcome.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-4 py-8 text-center text-sm text-mutedForeground">{message}</p>;
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatChange(previousValue: string | null, currentValue: string | null) {
  if (previousValue && currentValue) {
    return `${formatLabel(previousValue)} → ${formatLabel(currentValue)}`;
  }

  return formatLabel(currentValue ?? previousValue ?? "recorded");
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto"
  }).format(value);
}
