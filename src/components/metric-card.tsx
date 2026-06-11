export function MetricCard({ label, value, caption }: { label: string; value: number; caption?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="h-1 bg-primary" />
      <div className="p-5">
        <p className="text-sm font-medium text-mutedForeground">{label}</p>
        <p className="mt-3 text-3xl font-semibold text-primary">{value.toLocaleString("en-US")}</p>
        {caption ? <p className="mt-2 text-xs font-medium uppercase tracking-wide text-mutedForeground">{caption}</p> : null}
      </div>
    </div>
  );
}
